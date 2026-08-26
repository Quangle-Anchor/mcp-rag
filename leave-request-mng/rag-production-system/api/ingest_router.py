"""
api/ingest_router.py — Document sync and upload endpoints.

  POST /api/v1/sync        — Triggers full document re-sync as a Celery task.
                             *** Requires explicit user confirmation ***
  POST /api/v1/sync-direct — Direct (no Celery) sync: blocks until done.
  GET  /api/v1/docs/list   — List discovered document files + stats.
  POST /api/v1/upload-doc  — Upload a single file for ingestion.
  GET  /api/v1/upload-doc/status/{task_id} — Poll task status.
"""
from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, UploadFile, File, status
from loguru import logger

from config import get_settings
from models.pydantic_schemas import (
    DocumentUploadResponse,
    IngestionStatus,
    IngestionStatusResponse,
    SyncResponse,
)
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    pass

from workers.celery_tasks import (
    celery_app,
    ingest_document_task,
    sync_all_documents_task,
)

router = APIRouter()
settings = get_settings()

ALLOWED_EXTENSIONS = {".md", ".yaml", ".txt", ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".webp"}
MAX_FILE_SIZE_MB = 50
UPLOAD_DIR = Path("data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ── List discovered documents ─────────────────────────────────────────────────

@router.get(
    "/docs/list",
    summary="List all discovered document files",
)
async def list_documents() -> dict:
    """Return discovered doc directories and files (no chunking, fast)."""
    import glob as _glob
    from core.ingestion.loader import _find_doc_dirs, _is_excluded

    script_dir = str(Path(__file__).resolve().parent.parent)
    try:
        doc_dirs = _find_doc_dirs(script_dir)
    except Exception:
        doc_dirs = []

    files: list[dict] = []
    patterns: list[str] = []
    for doc_dir in doc_dirs:
        patterns.append(os.path.join(doc_dir, "**", "*.md"))
        patterns.append(os.path.join(doc_dir, "**", "*.yaml"))

    for pattern in patterns:
        for fp in _glob.glob(pattern, recursive=True):
            if not os.path.isfile(fp) or _is_excluded(fp):
                continue
            stat = os.stat(fp)
            files.append({
                "name": os.path.basename(fp),
                "path": fp,
                "size_bytes": stat.st_size,
                "ext": os.path.splitext(fp)[1].lower(),
            })

    return {
        "directories": doc_dirs,
        "files": files,
        "total_files": len(files),
    }


# ── Direct Sync (no Celery) ──────────────────────────────────────────────────

@router.post(
    "/sync-direct",
    summary="[ADMIN] Direct re-index — no Celery required",
)
async def sync_direct(
    confirmed: bool = Body(
        ..., embed=True,
        description="Must be true — explicit user consent required",
    ),
    namespace: str | None = Body(
        None, embed=True,
        description="Namespace to sync into (maps to Qdrant collection).",
    ),
    folder_name: str | None = Body(
        None, embed=True,
        description="Optional source folder name to sync documents from.",
    ),
) -> dict:
    """
    Synchronous full re-index: load → chunk → delete namespace → upload.
    Blocks until completion. Use when Celery/Redis is not available.
    """
    if not confirmed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sync refused. Pass 'confirmed: true' to proceed.",
        )

    t0 = time.perf_counter()
    target_ns = namespace or folder_name or settings.default_namespace

    logger.info("[SYNC-DIRECT] Starting full re-index → folder='{}' | namespace='{}'", folder_name, target_ns)

    # 1. Discover + chunk
    from core.ingestion.loader import fetch_project_context_documents
    try:
        all_chunks = fetch_project_context_documents(folder_name=folder_name, namespace=target_ns)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not all_chunks:
        return {"namespace": target_ns, "chunks_synced": 0, "message": "No documents found."}

    # 2. Clear namespace (delete + recreate Qdrant collection)
    from db.vector_db import get_vector_store, clear_namespace

    os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)
    clear_namespace(target_ns)

    # 3. Upload
    vs = get_vector_store(namespace=target_ns)

    batch_size = 20
    uploaded = 0
    for start in range(0, len(all_chunks), batch_size):
        batch = all_chunks[start: start + batch_size]
        try:
            vs.add_documents(batch)
            uploaded += len(batch)
        except Exception as exc:
            logger.error("[SYNC-DIRECT] Batch upload error: {}", exc)

    # 4. BM25
    from core.retrieval.bm25_index import build_and_persist_bm25
    build_and_persist_bm25(all_chunks, namespace=target_ns)

    elapsed = round((time.perf_counter() - t0) * 1000, 2)
    logger.info("[SYNC-DIRECT] DONE — {} chunks → '{}' in {:.1f}s", uploaded, target_ns, elapsed / 1000)

    return {
        "namespace": target_ns,
        "chunks_synced": uploaded,
        "total_chunks": len(all_chunks),
        "elapsed_ms": elapsed,
        "message": f"Synced {uploaded} chunks → namespace '{target_ns}' in {elapsed / 1000:.1f}s.",
    }


# ── Sync (Celery) ────────────────────────────────────────────────────────────

@router.post(
    "/sync",
    response_model=dict,
    status_code=status.HTTP_202_ACCEPTED,
    summary="[ADMIN] Re-index documentation into Qdrant (requires Celery)",
)
async def trigger_sync(
    confirmed: bool = Body(
        ..., embed=True,
        description="Must be true — explicit user consent required",
    ),
    namespace: str | None = Body(
        None, embed=True,
        description="Namespace to sync into. Defaults to settings value.",
    ),
) -> dict:
    """
    **ADMIN — USER CONSENT REQUIRED**

    Re-indexes all documentation into Qdrant (delete namespace + re-upload).
    The caller MUST pass `confirmed: true` in the request body.
    """
    if not confirmed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Sync refused. You must explicitly pass 'confirmed: true' to confirm "
                "that you want to reset and re-sync the entire namespace."
            ),
        )

    resolved_ns = namespace or settings.default_namespace
    task: Any = sync_all_documents_task.delay(resolved_ns)  # type: ignore[attr-defined]
    logger.info("[SYNC] Re-index task dispatched | namespace='{}' | task_id={}", resolved_ns, task.id)
    return {
        "task_id":   task.id,
        "namespace": resolved_ns,
        "status":    "queued",
        "message":   f"Re-index queued for namespace '{resolved_ns}'. Poll /api/v1/upload-doc/status/{{task_id}}.",
    }


# ── Single File Upload ────────────────────────────────────────────────────────

@router.post(
    "/upload-doc",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a single document for ingestion into Qdrant",
)
async def upload_document(file: UploadFile = File(...)) -> DocumentUploadResponse:
    """
    Accepts a file, validates it, saves it, and dispatches a Celery task
    to chunk → embed → store in Qdrant.
    """
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{suffix}'. Allowed: {ALLOWED_EXTENSIONS}",
        )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {MAX_FILE_SIZE_MB} MB limit.",
        )

    safe_name = f"{uuid.uuid4().hex}_{Path(file.filename or 'upload').name}"
    dest_path = UPLOAD_DIR / safe_name
    dest_path.write_bytes(content)
    logger.info("File saved | path={} | size={} bytes", dest_path, len(content))

    try:
        task: Any = ingest_document_task.delay(str(dest_path), file.filename)  # type: ignore[attr-defined]
    except Exception as exc:
        dest_path.unlink(missing_ok=True)
        logger.exception("Failed to dispatch ingestion task")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Worker unavailable. Please try again later.",
        ) from exc

    logger.info("Ingestion task dispatched | task_id={}", task.id)
    return DocumentUploadResponse(
        task_id=task.id,
        filename=file.filename or safe_name,
        status=IngestionStatus.queued,
    )


# ── Task Status Polling ───────────────────────────────────────────────────────

@router.get(
    "/upload-doc/status/{task_id}",
    response_model=IngestionStatusResponse,
    summary="Poll the status of a background ingestion or sync task",
)
async def get_task_status(task_id: str) -> IngestionStatusResponse:
    result = celery_app.AsyncResult(task_id)
    state_map = {
        "PENDING": IngestionStatus.queued,
        "STARTED": IngestionStatus.processing,
        "SUCCESS": IngestionStatus.completed,
        "FAILURE": IngestionStatus.failed,
    }
    return IngestionStatusResponse(
        task_id=task_id,
        status=state_map.get(result.state, IngestionStatus.processing),
        chunks_created=result.result.get("chunks_created") if result.state == "SUCCESS" else None,
        error=str(result.result) if result.state == "FAILURE" else None,
    )
