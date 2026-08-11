"""
workers/celery_tasks.py — Background tasks for document ingestion and full re-sync.

Two tasks:
  ingest_document_task   — Single file: load → chunk → embed → upsert
  sync_all_documents_task — Full re-sync: delete namespace → re-index all docs
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from celery import Celery
from loguru import logger

from config import get_settings

settings = get_settings()

# ── Celery App ────────────────────────────────────────────────────────────────

celery_app = Celery(
    "rag_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=3600,
)

BATCH_SIZE = 20


# ── Shared helper: batched Pinecone upsert ────────────────────────────────────

def _batched_upsert(chunks, original_filename: str, namespace: str | None = None) -> int:
    """
    Embed and upsert chunks in batches of BATCH_SIZE.

    Returns the number of successfully uploaded chunks.
    """
    import time
    from langchain_pinecone import PineconeVectorStore

    from core.ingestion.embeddings import get_embeddings

    os.environ.setdefault("PINECONE_API_KEY", settings.pinecone_api_key)

    target_ns = namespace or settings.pinecone_namespace

    vs = PineconeVectorStore(
        index_name=settings.pinecone_index_name,
        embedding=get_embeddings(),
        namespace=target_ns,
    )

    total = len(chunks)
    uploaded = 0
    total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_start in range(0, total, BATCH_SIZE):
        batch = chunks[batch_start: batch_start + BATCH_SIZE]
        batch_num = batch_start // BATCH_SIZE + 1
        logger.info(
            "[UPLOAD] Batch {}/{} ({}-{}/{}) | file={}",
            batch_num, total_batches,
            batch_start + 1, min(batch_start + BATCH_SIZE, total), total,
            original_filename,
        )
        max_retries = 3
        for attempt in range(max_retries):
            try:
                vs.add_documents(batch)
                uploaded += len(batch)
                break
            except Exception as exc:
                if attempt < max_retries - 1:
                    wait = 2 ** attempt * 5  # 5 s, 10 s
                    logger.warning(
                        "[RETRY] Batch {} failed ({}). Waiting {}s before retry {}/{}...",
                        batch_num, type(exc).__name__, wait, attempt + 2, max_retries,
                    )
                    time.sleep(wait)
                else:
                    logger.error("[ERROR] Batch {} permanently failed: {}", batch_num, exc)

    return uploaded


# ── Task 1: Single document ingestion ─────────────────────────────────────────

@celery_app.task(
    name="workers.ingest_document",
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    soft_time_limit=600,
    time_limit=660,
)
def ingest_document_task(self, file_path: str, original_filename: str) -> dict:
    """
    Ingest a single uploaded file:
      1. Load file content (plain read — supports .md, .yaml, .txt)
      2. Chunk with MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter
      3. Batched embed + upsert into Pinecone
    """
    from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
    from langchain_core.documents import Document

    logger.info("[TASK] ingest_document_task | file={}", original_filename)
    self.update_state(state="STARTED", meta={"filename": original_filename})

    try:
        path = Path(file_path)
        content = path.read_text(encoding="utf-8", errors="ignore")
        file_name = path.name

        headers = [("#", "Header 1"), ("##", "Header 2"), ("###", "Header 3"), ("####", "Header 4")]
        md_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers)
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )
        md_splits = md_splitter.split_text(content)
        chunks = text_splitter.split_documents(md_splits) if md_splits else text_splitter.create_documents([content])

        for chunk in chunks:
            chunk.metadata.update({"source": file_path, "file_name": file_name})
            header_ctx = " > ".join(chunk.metadata.get(f"Header {i}", "") for i in range(1, 5) if chunk.metadata.get(f"Header {i}"))
            prefix = f"[FILE: {file_name}]"
            if header_ctx:
                prefix += f"\n[SECTION: {header_ctx}]"
            chunk.page_content = prefix + "\n" + chunk.page_content

        uploaded = _batched_upsert(chunks, original_filename)
        path.unlink(missing_ok=True)

        result = {"chunks_created": uploaded, "filename": original_filename}
        logger.info("[TASK DONE] {} chunks | file={}", uploaded, original_filename)
        return result

    except Exception as exc:
        logger.exception("[TASK FAIL] file={}", original_filename)
        raise self.retry(exc=exc) from exc


# ── Task 2: Full re-sync ─────────────────────────────────────────────────────

@celery_app.task(
    name="workers.sync_all_documents",
    bind=True,
    max_retries=1,
    soft_time_limit=3600,
    time_limit=3660,
)
def sync_all_documents_task(self, namespace: str | None = None) -> dict:
    """
    Full re-sync of all documents into Pinecone.

      1. Fetch all chunks via fetch_project_context_documents()
      2. Delete entire namespace
      3. Batch-upload all chunks
    """
    import os
    from pinecone import Pinecone

    target_ns = namespace or settings.pinecone_namespace

    logger.info("[SYNC] Starting full re-index to namespace '{}'...", target_ns)
    self.update_state(state="STARTED", meta={"stage": "loading"})

    from core.ingestion.loader import fetch_project_context_documents
    all_chunks = fetch_project_context_documents()
    total = len(all_chunks)
    logger.info("[SYNC] {} chunks discovered, deleting namespace '{}'...", total, target_ns)

    # Delete namespace
    pc = Pinecone(api_key=settings.pinecone_api_key)
    index = pc.Index(settings.pinecone_index_name)
    try:
        index.delete(delete_all=True, namespace=target_ns)
        logger.info("[SYNC] Namespace '{}' cleared.", target_ns)
    except Exception as exc:
        logger.warning("[SYNC] Namespace delete failed (may not exist): {}", exc)

    self.update_state(state="STARTED", meta={"stage": "uploading", "total": total})
    uploaded = _batched_upsert(all_chunks, "full_sync", namespace=target_ns)

    # Build BM25 index for hybrid search
    logger.info("[SYNC] Building BM25 keyword index...")
    from core.retrieval.bm25_index import build_and_persist_bm25
    build_and_persist_bm25(all_chunks)

    result = {
        "chunks_synced": uploaded,
        "total_chunks": total,
        "namespace": target_ns,
        "message": f"Successfully synced {uploaded}/{total} chunks to namespace '{target_ns}' + BM25 index.",
    }
    logger.info("[SYNC DONE] {}", result["message"])
    return result
