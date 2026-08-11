"""
api/ingest_router.py — Document sync and upload endpoints.

  POST /api/v1/sync        — Triggers full document re-sync as a Celery task.
                             *** Requires explicit user confirmation ***
  POST /api/v1/upload-doc  — Upload a single file for ingestion.
  GET  /api/v1/upload-doc/status/{task_id} — Poll task status.
"""
from __future__ import annotations

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

ALLOWED_EXTENSIONS = {".md", ".yaml", ".txt", ".pdf", ".docx"}
MAX_FILE_SIZE_MB = 50
UPLOAD_DIR = Path("data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ── Sync ──────────────────────────────────────────────────────────────────────

@router.post(
    "/sync",
    response_model=dict,
    status_code=status.HTTP_202_ACCEPTED,
    summary="[ADMIN] Re-index documentation into Pinecone",
)
async def trigger_sync(
    confirmed: bool = Body(
        ..., embed=True,
        description="Must be true — explicit user consent required",
    ),
    namespace: str | None = Body(
        None, embed=True,
        description="Pinecone namespace to sync into. Defaults to settings value.",
    ),
) -> dict:
    """
    **ADMIN — USER CONSENT REQUIRED**

    Re-indexes all documentation into Pinecone (delete namespace + re-upload).
    The caller MUST pass `confirmed: true` in the request body.
    """
    if not confirmed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Sync refused. You must explicitly pass 'confirmed: true' to confirm "
                "that you want to reset and re-sync the entire Pinecone namespace."
            ),
        )

    resolved_ns = namespace or settings.pinecone_namespace
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
    summary="Upload a single document for ingestion into Pinecone",
)
async def upload_document(file: UploadFile = File(...)) -> DocumentUploadResponse:
    """
    Accepts a file, validates it, saves it, and dispatches a Celery task
    to chunk → embed → store in Pinecone.
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
