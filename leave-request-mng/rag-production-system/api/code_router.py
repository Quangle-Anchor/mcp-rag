"""
api/code_router.py — Source code scanning & indexing endpoints.

  POST /api/v1/code/scan     — Scan a sibling source code folder, chunk, and index
  GET  /api/v1/code/folders  — List available sibling folders
"""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from config import get_settings
from core.ingestion.code_loader import (
    list_sibling_folders,
    resolve_sibling_folder,
    scan_source_code,
)
from core.retrieval.bm25_index import build_and_persist_bm25
from models.pydantic_schemas import CodeScanRequest, CodeScanResponse

router = APIRouter()
settings = get_settings()


@router.get(
    "/folders",
    response_model=list[str],
    summary="List available sibling source code folders",
)
async def list_folders() -> list[str]:
    """Return names of all sibling directories of this RAG project."""
    return list_sibling_folders()


@router.get(
    "/folders/details",
    summary="List sibling folders with rich metadata, file counts, and language breakdowns",
)
async def list_folders_details() -> list[dict]:
    """Return detailed metadata for all sibling directories."""
    import os
    from pathlib import Path
    from core.ingestion.code_loader import (
        EXTENSION_MAP,
        _is_excluded,
        _detect_language,
        MAX_FILE_SIZE_BYTES,
    )

    rag_root = Path(__file__).resolve().parent.parent
    parent = rag_root.parent
    results = []

    doc_extensions = {".md", ".yaml", ".yml", ".txt"}

    for d in sorted(parent.iterdir()):
        if not d.is_dir() or d.name == rag_root.name or d.name.startswith("."):
            continue

        folder_name = d.name
        folder_path = str(d)
        total_files = 0
        doc_files_count = 0
        code_files_count = 0
        languages_detected: set[str] = set()
        file_previews = []

        for root, dirs, files in os.walk(folder_path):
            dirs[:] = [sub for sub in dirs if not sub.startswith(".") and sub not in {"node_modules", ".git", ".venv", "__pycache__", "dist", "build"}]
            for fname in sorted(files):
                fpath = os.path.join(root, fname)
                if _is_excluded(fpath):
                    continue

                total_files += 1
                ext = Path(fname).suffix.lower()
                lang_label, _ = _detect_language(fpath)

                is_doc = ext in doc_extensions
                is_code = lang_label != "unknown" and not is_doc

                if is_doc:
                    doc_files_count += 1
                    languages_detected.add(f"doc:{ext}")
                elif is_code:
                    code_files_count += 1
                    languages_detected.add(lang_label)

                try:
                    fsize = os.path.getsize(fpath)
                except OSError:
                    fsize = 0

                if len(file_previews) < 30:
                    file_previews.append({
                        "name": fname,
                        "rel_path": os.path.relpath(fpath, folder_path),
                        "size_bytes": fsize,
                        "ext": ext,
                        "lang": lang_label if lang_label != "unknown" else ("doc" if is_doc else "other"),
                        "is_doc": is_doc,
                        "is_code": is_code,
                    })

        results.append({
            "name": folder_name,
            "path": folder_path,
            "total_files": total_files,
            "doc_files_count": doc_files_count,
            "code_files_count": code_files_count,
            "languages": sorted(languages_detected),
            "files": file_previews,
        })

    return results


@router.post(
    "/scan",
    response_model=CodeScanResponse,
    status_code=status.HTTP_200_OK,
    summary="Scan a source code folder, chunk with language-aware separators, and index into Qdrant",
)
async def scan_code(request: CodeScanRequest) -> CodeScanResponse:
    """
    Scan a source code folder (sibling to this RAG project), chunk all
    recognized source files with language-specific separators, and upload
    the resulting chunks to Qdrant.

    The folder is resolved relative to the RAG project's parent directory.
    """
    t0 = time.perf_counter()
    namespace = request.namespace or request.folder_name

    # ── Resolve folder path ───────────────────────────────────────────────────
    try:
        folder_path = resolve_sibling_folder(request.folder_name)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    logger.info(
        "[CODE SCAN] folder='{}' → path='{}' | namespace='{}'",
        request.folder_name, folder_path, namespace,
    )

    # ── Scan and chunk ────────────────────────────────────────────────────────
    try:
        all_chunks, lang_stats = scan_source_code(folder_path, project_name=request.folder_name)
    except Exception as exc:
        logger.exception("[CODE SCAN] Failed to scan '{}'", request.folder_name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Scan failed: {exc}",
        ) from exc

    if not all_chunks:
        return CodeScanResponse(
            folder_name=request.folder_name,
            namespace=namespace,
            files_scanned=0,
            chunks_created=0,
            languages=[],
            message=f"No recognized source files found in '{request.folder_name}'.",
        )

    # ── Upload to Qdrant ─────────────────────────────────────────────────────
    import os
    from db.vector_db import get_vector_store, clear_namespace

    os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)

    # Clear the namespace first
    try:
        clear_namespace(namespace)
        logger.info("[CODE SCAN] Namespace '{}' cleared.", namespace)
    except Exception:
        pass

    vs = get_vector_store(namespace=namespace)

    # Batched upsert
    batch_size = 20
    uploaded = 0
    for start in range(0, len(all_chunks), batch_size):
        batch = all_chunks[start: start + batch_size]
        try:
            vs.add_documents(batch)
            uploaded += len(batch)
        except Exception as exc:
            logger.error("[CODE SCAN] Batch upload error: {}", exc)

    # Build BM25 index
    bm25_idx = build_and_persist_bm25(all_chunks, namespace=namespace)

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    files_scanned = sum(lang_stats.values())
    languages = sorted(lang_stats.keys())

    logger.info(
        "[CODE SCAN] DONE — {} files, {} chunks, {} languages, {:.1f}s",
        files_scanned, uploaded, len(languages), elapsed_ms / 1000,
    )

    return CodeScanResponse(
        folder_name=request.folder_name,
        namespace=namespace,
        files_scanned=files_scanned,
        chunks_created=uploaded,
        languages=languages,
        message=f"Scanned {files_scanned} files → {uploaded} chunks in {elapsed_ms / 1000:.1f}s.",
    )
