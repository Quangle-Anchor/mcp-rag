"""
cli.py — CLI wrapper for RAG Production System.

Usage:
  python cli.py --sync                                  # Sync documents
  python cli.py --sync --namespace my-ns                # Sync with explicit namespace
  python cli.py --scan-code folder_name                 # Scan source code folder
  python cli.py --query "search query here"             # Retrieve context from Qdrant
  python cli.py --serve                                 # Start API server
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from dotenv import load_dotenv

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
load_dotenv()

from loguru import logger
from config import get_settings


def _run_sync(namespace_arg: str | None = None, folder_name: str | None = None) -> None:
    settings = get_settings()
    from core.ingestion.embeddings import get_embeddings
    from core.ingestion.loader import fetch_project_context_documents
    from core.retrieval.bm25_index import build_and_persist_bm25
    from db.vector_db import get_vector_store, clear_namespace

    chosen_namespace = namespace_arg or folder_name or settings.default_namespace

    logger.info("🔄  SYNC — Document Chunking + Qdrant Upload (folder='{}', namespace='{}')", folder_name, chosen_namespace)
    all_chunks = fetch_project_context_documents(folder_name=folder_name, namespace=chosen_namespace)
    if not all_chunks:
        logger.warning("No documents found.")
        return

    # Clear existing data in namespace
    clear_namespace(chosen_namespace)

    # Upload to Qdrant (batched with retry, matching celery_tasks pattern)
    vs = get_vector_store(namespace=chosen_namespace)
    batch_size = 20
    uploaded = 0
    for start in range(0, len(all_chunks), batch_size):
        batch = all_chunks[start: start + batch_size]
        for attempt in range(3):
            try:
                vs.add_documents(batch)
                uploaded += len(batch)
                break
            except Exception as exc:
                if attempt < 2:
                    import time
                    wait = 2 ** attempt * 5
                    logger.warning("[RETRY] Batch {}/{} failed ({}). Waiting {}s...",
                                   start // batch_size + 1,
                                   (len(all_chunks) + batch_size - 1) // batch_size,
                                   type(exc).__name__, wait)
                    time.sleep(wait)
                else:
                    logger.error("[ERROR] Batch permanently failed: {}", exc)

    build_and_persist_bm25(all_chunks, namespace=chosen_namespace)
    logger.info("✅  SYNC COMPLETE: {} chunks → namespace '{}'", uploaded, chosen_namespace)


async def run_query(query: str, namespace_arg: str | None = None) -> None:
    from core.retrieval.retriever import retrieve_chunks, format_context_blocks

    chunks, err = await retrieve_chunks(query=query, namespace=namespace_arg)
    if err and not chunks:
        print(f"\nNO CONTEXT FOUND:\n{err}\n")
        return

    print(f"\nRETRIEVAL RESULTS — {len(chunks)} chunks\n{format_context_blocks(chunks)}")


def _run_scan_code(folder_name: str, namespace_arg: str | None = None) -> None:
    from core.ingestion.code_loader import resolve_sibling_folder, scan_source_code
    from core.retrieval.bm25_index import build_and_persist_bm25
    from db.vector_db import get_vector_store, clear_namespace

    namespace = namespace_arg or folder_name
    logger.info("🔍  CODE SCAN — Source Code Chunking + Qdrant Upload")

    folder_path = resolve_sibling_folder(folder_name)
    all_chunks, _ = scan_source_code(folder_path, project_name=folder_name)
    if not all_chunks:
        logger.warning("No source files found in '{}'.", folder_name)
        return

    # Clear existing data in namespace
    clear_namespace(namespace)

    # Upload to Qdrant (batched with retry)
    vs = get_vector_store(namespace=namespace)
    batch_size = 20
    uploaded = 0
    for start in range(0, len(all_chunks), batch_size):
        batch = all_chunks[start: start + batch_size]
        for attempt in range(3):
            try:
                vs.add_documents(batch)
                uploaded += len(batch)
                break
            except Exception as exc:
                if attempt < 2:
                    import time
                    wait = 2 ** attempt * 5
                    logger.warning("[RETRY] Batch {}/{} failed ({}). Waiting {}s...",
                                   start // batch_size + 1,
                                   (len(all_chunks) + batch_size - 1) // batch_size,
                                   type(exc).__name__, wait)
                    time.sleep(wait)
                else:
                    logger.error("[ERROR] Batch permanently failed: {}", exc)

    build_and_persist_bm25(all_chunks, namespace=namespace)
    logger.info("✅  CODE SCAN COMPLETE: {} chunks → namespace '{}'", uploaded, namespace)


def main() -> None:
    parser = argparse.ArgumentParser(description="CLI for RAG Production System")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--sync", nargs="?", const=True, default=False, metavar="FOLDER", help="Sync documents (optional folder name)")
    group.add_argument("--scan-code", type=str, metavar="FOLDER", help="Scan source code folder")
    group.add_argument("--query", type=str, help="Search query")
    group.add_argument("--serve", action="store_true", help="Start API server")
    parser.add_argument("--namespace", type=str, required=True, help="Namespace (maps to Qdrant collection) — REQUIRED")

    args = parser.parse_args()

    if args.sync:
        folder = args.sync if isinstance(args.sync, str) else None
        _run_sync(namespace_arg=args.namespace, folder_name=folder)
    elif args.scan_code:
        _run_scan_code(args.scan_code, namespace_arg=args.namespace)
    elif args.query:
        asyncio.run(run_query(args.query, args.namespace))
    elif args.serve:
        import uvicorn
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    main()
