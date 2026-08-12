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
from core.ingestion.embeddings import get_embeddings
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


@router.post(
    "/scan",
    response_model=CodeScanResponse,
    status_code=status.HTTP_200_OK,
    summary="Scan a source code folder, chunk with language-aware separators, and index into Pinecone",
)
async def scan_code(request: CodeScanRequest) -> CodeScanResponse:
    """
    Scan a source code folder (sibling to this RAG project), chunk all
    recognized source files with language-specific separators, and upload
    the resulting chunks to Pinecone.

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

    # ── Upload to Pinecone ────────────────────────────────────────────────────
    import os
    os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)
    os.environ.setdefault("PINECONE_API_KEY", settings.pinecone_api_key)

    from pinecone import Pinecone
    from langchain_pinecone import PineconeVectorStore

    pc = Pinecone(api_key=settings.pinecone_api_key)
    index = pc.Index(settings.pinecone_index_name)

    # Clear the namespace first
    try:
        index.delete(delete_all=True, namespace=namespace)
        logger.info("[CODE SCAN] Namespace '{}' cleared.", namespace)
    except Exception:
        pass

    vs = PineconeVectorStore(
        index_name=settings.pinecone_index_name,
        embedding=get_embeddings(),
        namespace=namespace,
    )

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
    bm25_idx = build_and_persist_bm25(all_chunks, namespace=request.namespace)

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
