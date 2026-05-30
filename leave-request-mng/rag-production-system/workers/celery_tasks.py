"""
workers/celery_tasks.py — Background tasks for document ingestion and full re-sync.

Two tasks matching rag_system.py operations:

  ingest_document_task   — Single file: load → classify → chunk → embed → upsert
  sync_all_documents_task — Full re-sync: delete namespace → re-index all Output dirs
                            (mirrors sync_mendix_context() from rag_system.py)

Key implementation details preserved from rag_system.py:
  - Batched upload: BATCH_SIZE = 20 chunks per Pinecone call
  - Retry per batch: 3 attempts, exponential backoff 5 s / 10 s
  - Namespace delete before full re-sync
  - Rate-limited CustomGeminiEmbeddings (1.5 s sleep between embeds)
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

BATCH_SIZE = 20  # mirrors rag_system.py BATCH_SIZE


# ── Shared helper: batched Pinecone upsert ────────────────────────────────────

def _batched_upsert(chunks, original_filename: str) -> int:
    """
    Embed and upsert chunks in batches of BATCH_SIZE.
    Mirrors the batched upload loop in sync_mendix_context().

    Returns the number of successfully uploaded chunks.
    """
    import time
    from langchain_pinecone import PineconeVectorStore

    from core.ingestion.embeddings import get_embeddings

    os.environ.setdefault("PINECONE_API_KEY", settings.pinecone_api_key)

    vs = PineconeVectorStore(
        index_name=settings.pinecone_index_name,
        embedding=get_embeddings(),
        namespace=settings.pinecone_namespace,
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
      2. Classify (filename-first → LLM fallback)
      3. Chunk with MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter
      4. Batched embed + upsert into Pinecone
    """
    from core.ingestion.loader import fetch_project_context_documents
    from core.ingestion.classifier import classify_document
    from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
    from langchain_core.documents import Document

    logger.info("[TASK] ingest_document_task | file={}", original_filename)
    self.update_state(state="STARTED", meta={"filename": original_filename})

    try:
        path = Path(file_path)
        content = path.read_text(encoding="utf-8", errors="ignore")
        file_name = path.name

        doc_type, doc_layer, method = classify_document(file_name, content)
        logger.info("[CLASSIFY] {} → type={}, layer={}, via={}", file_name, doc_type, doc_layer, method)

        headers = [("#", "Header 1"), ("##", "Header 2"), ("###", "Header 3"), ("####", "Header 4")]
        md_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers)
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )
        md_splits = md_splitter.split_text(content)
        chunks = text_splitter.split_documents(md_splits) if md_splits else text_splitter.create_documents([content])

        for chunk in chunks:
            chunk.metadata.update({"source": file_path, "file_name": file_name, "doc_type": doc_type, "layer": doc_layer})
            header_ctx = " > ".join(chunk.metadata.get(f"Header {i}", "") for i in range(1, 5) if chunk.metadata.get(f"Header {i}"))
            prefix = f"[FILE: {file_name} | TYPE: {doc_type} | LAYER: {doc_layer}]"
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


# ── Task 2: Full re-sync (mirrors sync_mendix_context) ───────────────────────

@celery_app.task(
    name="workers.sync_all_documents",
    bind=True,
    max_retries=1,
    soft_time_limit=3600,
    time_limit=3660,
)
def sync_all_documents_task(self) -> dict:
    """
    Full re-sync of all Output directory documents into Pinecone.

    Mirrors sync_mendix_context() from rag_system.py:
      1. Fetch all chunks via fetch_project_context_documents()
      2. Delete entire namespace
      3. Batch-upload all chunks
    """
    import os
    from pinecone import Pinecone

    logger.info("[SYNC] Starting full re-index...")
    self.update_state(state="STARTED", meta={"stage": "loading"})

    from core.ingestion.loader import fetch_project_context_documents
    all_chunks = fetch_project_context_documents()
    total = len(all_chunks)
    logger.info("[SYNC] {} chunks discovered, deleting namespace...", total)

    # Delete namespace (mirrors index.delete(delete_all=True, namespace=…))
    pc = Pinecone(api_key=settings.pinecone_api_key)
    index = pc.Index(settings.pinecone_index_name)
    try:
        index.delete(delete_all=True, namespace=settings.pinecone_namespace)
        logger.info("[SYNC] Namespace '{}' cleared.", settings.pinecone_namespace)
    except Exception as exc:
        logger.warning("[SYNC] Namespace delete failed (may not exist): {}", exc)

    self.update_state(state="STARTED", meta={"stage": "uploading", "total": total})
    uploaded = _batched_upsert(all_chunks, "full_sync")

    result = {
        "chunks_synced": uploaded,
        "total_chunks": total,
        "message": f"Successfully synced {uploaded}/{total} documentation chunks to Pinecone.",
    }
    logger.info("[SYNC DONE] {}", result["message"])
    return result


# ── Task 3: Tool Specification sync ───────────────────────────────────────────

@celery_app.task(
    name="workers.sync_tool_documents",
    bind=True,
    max_retries=1,
    soft_time_limit=3600,
    time_limit=3660,
)
def sync_tool_documents_task(self, tool_docs_dir: str, namespace: str | None = None) -> dict:
    """
    Sync Tool Specification markdown files into Pinecone using the 3-layer
    tool_loader pipeline (chunk_tool_directory).

    Pipeline:
      1. chunk_tool_directory(tool_docs_dir) — Layer 1/2/3 chunking
      2. Delete Pinecone namespace (clean slate)
      3. Batch-embed + upsert (20 chunks/batch, exponential retry)

    Args:
        tool_docs_dir: Directory containing tool-spec .md files.
        namespace:     Pinecone namespace to target. Defaults to settings value.
    """
    import os
    from pinecone import Pinecone

    from core.ingestion.tool_loader import chunk_tool_directory

    target_namespace = namespace or settings.pinecone_namespace

    logger.info("[TOOL_SYNC] Starting tool-spec sync | dir='{}' | namespace='{}'",
                tool_docs_dir, target_namespace)
    self.update_state(state="STARTED", meta={"stage": "chunking", "dir": tool_docs_dir})

    try:
        all_chunks = chunk_tool_directory(tool_docs_dir)
    except FileNotFoundError as exc:
        logger.error("[TOOL_SYNC] Directory error: {}", exc)
        raise

    total = len(all_chunks)
    logger.info("[TOOL_SYNC] {} chunks discovered — clearing namespace '{}'...",
                total, target_namespace)

    # Delete namespace (clean slate — same pattern as sync_all_documents_task)
    os.environ.setdefault("PINECONE_API_KEY", settings.pinecone_api_key)
    pc = Pinecone(api_key=settings.pinecone_api_key)
    index = pc.Index(settings.pinecone_index_name)
    try:
        index.delete(delete_all=True, namespace=target_namespace)
        logger.info("[TOOL_SYNC] Namespace '{}' cleared.", target_namespace)
    except Exception as exc:
        logger.warning("[TOOL_SYNC] Namespace delete failed (may be empty / new): {}", exc)

    self.update_state(state="STARTED", meta={"stage": "uploading", "total": total})
    uploaded = _batched_upsert(all_chunks, f"tool_sync:{tool_docs_dir}")

    result = {
        "chunks_synced": uploaded,
        "total_chunks":  total,
        "namespace":     target_namespace,
        "message": (
            f"Tool-spec sync complete: {uploaded}/{total} chunks "
            f"uploaded to namespace '{target_namespace}'."
        ),
    }
    logger.info("[TOOL_SYNC DONE] {}", result["message"])
    return result
