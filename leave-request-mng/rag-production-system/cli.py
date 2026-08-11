"""
cli.py — CLI wrapper for RAG Production System.

Usage:
  python cli.py --sync                                  # Sync documents (interactive namespace picker)
  python cli.py --sync --namespace my-ns                # Sync with explicit namespace
  python cli.py --query "search query here"             # Retrieve Pinecone context (no LLM)
  python cli.py --query "search query" --namespace ns   # Query specific namespace
  python cli.py --serve                                 # Start API server
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

# Ensure imports from correct directory
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

# Windows terminal encoding fix — force UTF-8 output
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv

# Load .env from project dir or parent
_env_paths = [_HERE / ".env", _HERE.parent / ".env"]
for _ep in _env_paths:
    if _ep.exists():
        load_dotenv(_ep)
        break

from loguru import logger


# ── Namespace picker helper ───────────────────────────────────────────────────

def _pick_namespace(pc, index_name: str, default_namespace: str) -> str:
    """
    Interactive prompt: list existing Pinecone namespaces and let the user
    choose one to reuse OR enter a new name to create a fresh namespace.
    Returns the chosen namespace string.
    """
    print("\n" + "=" * 60)
    print("📦  NAMESPACE SELECTION")
    print("=" * 60)

    existing: list[str] = []
    try:
        index = pc.Index(index_name)
        stats = index.describe_index_stats()
        existing = sorted(stats.get("namespaces", {}).keys())
    except Exception as exc:
        logger.warning("Could not fetch existing namespaces: {}", exc)

    if existing:
        print(f"  Found {len(existing)} existing namespace(s) in index '{index_name}':")
        for i, ns in enumerate(existing, 1):
            marker = "  (default)" if ns == default_namespace else ""
            print(f"    [{i}] {ns}{marker}")
        print("    [N] Create a NEW namespace\n")

        while True:
            raw = input(
                f"  Enter number to reuse, or 'N' to create new "
                f"[default: {default_namespace!r}]: "
            ).strip()
            if raw == "":
                chosen = default_namespace
                print(f"  → Using default namespace: {chosen!r}")
                break
            elif raw.upper() == "N":
                chosen = input("  Enter new namespace name: ").strip()
                if not chosen:
                    print("  ❌ Namespace name cannot be empty. Try again.")
                    continue
                print(f"  → Creating new namespace: {chosen!r}")
                break
            elif raw.isdigit() and 1 <= int(raw) <= len(existing):
                chosen = existing[int(raw) - 1]
                print(f"  → Reusing existing namespace: {chosen!r}")
                break
            else:
                print(f"  ❌ Invalid choice '{raw}'. Try again.")
    else:
        print(f"  No existing namespaces found in index '{index_name}'.")
        raw = input(f"  Enter namespace name [default: {default_namespace!r}]: ").strip()
        chosen = raw if raw else default_namespace
        print(f"  → Using namespace: {chosen!r}")

    print("=" * 60 + "\n")
    return chosen


def _batched_upsert_cli(
    chunks: list,
    vs,
    label: str,
    batch_size: int = 20,
) -> int:
    """Shared batched-upload loop for sync."""
    import time
    total = len(chunks)
    total_batches = (total + batch_size - 1) // batch_size
    uploaded = 0
    for batch_start in range(0, total, batch_size):
        batch = chunks[batch_start: batch_start + batch_size]
        batch_num = batch_start // batch_size + 1
        logger.info(
            "  [UPLOAD] Batch {}/{} ({}-{}/{}) | {}",
            batch_num, total_batches,
            batch_start + 1, min(batch_start + batch_size, total), total,
            label,
        )
        for attempt in range(3):
            try:
                vs.add_documents(batch)
                uploaded += len(batch)
                break
            except Exception as exc:
                if attempt < 2:
                    wait = 2 ** attempt * 5
                    logger.warning("  [RETRY] Batch {} failed. Waiting {}s...", batch_num, wait)
                    time.sleep(wait)
                else:
                    logger.error("  [ERROR] Batch {} permanently failed: {}", batch_num, exc)
    return uploaded


# ── Sync Documents ────────────────────────────────────────────────────────────

def _run_sync(namespace_arg: str | None = None) -> None:
    """
    Sync documents to Pinecone.
    Discovers document directories, chunks files, and uploads to Pinecone.
    """
    import os as _os
    from config import get_settings
    settings = get_settings()

    _os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)
    _os.environ.setdefault("PINECONE_API_KEY", settings.pinecone_api_key)

    from pinecone import Pinecone
    from langchain_pinecone import PineconeVectorStore
    from core.ingestion.embeddings import get_embeddings

    pc = Pinecone(api_key=settings.pinecone_api_key)
    chosen_namespace = namespace_arg or _pick_namespace(
        pc, settings.pinecone_index_name, settings.pinecone_namespace
    )

    logger.info("=" * 60)
    logger.info("🔄  SYNC — Document Chunking + Pinecone Upload")
    logger.info("  Index:     {}", settings.pinecone_index_name)
    logger.info("  Namespace: {}", chosen_namespace)
    logger.info("=" * 60)

    from core.ingestion.loader import fetch_project_context_documents
    logger.info("Step 1/3 — Discovering and chunking documents...")
    try:
        all_chunks = fetch_project_context_documents()
    except FileNotFoundError as exc:
        print(str(exc))
        sys.exit(1)

    total = len(all_chunks)
    if total == 0:
        logger.warning("No documents found. Make sure document directories exist.")
        return
    logger.info("  Found {} chunks.", total)

    index = pc.Index(settings.pinecone_index_name)
    logger.info("Step 2/3 — Clearing namespace '{}'...", chosen_namespace)
    try:
        index.delete(delete_all=True, namespace=chosen_namespace)
        logger.info("  Namespace '{}' cleared.", chosen_namespace)
    except Exception as exc:
        logger.warning("  Namespace delete failed (may be new/empty): {}", exc)

    logger.info("Step 3/3 — Uploading {} chunks...", total)
    vs = PineconeVectorStore(
        index_name=settings.pinecone_index_name,
        embedding=get_embeddings(),
        namespace=chosen_namespace,
    )
    uploaded = _batched_upsert_cli(all_chunks, vs, "sync")

    logger.info("=" * 60)
    logger.info("✅  SYNC COMPLETE: {}/{} chunks → namespace '{}'.",
                uploaded, total, chosen_namespace)
    logger.info("=" * 60)


# ── Query ─────────────────────────────────────────────────────────────────────

async def run_query(query: str, namespace_arg: str | None = None) -> None:
    """
    Retrieve chunks from Pinecone and display results.
    """
    from core.retrieval.retriever import retrieve_chunks, format_context_blocks

    logger.info("Query: '{}'", query)

    chunks, err = await retrieve_chunks(
        query=query,
        namespace=namespace_arg,
    )

    if err and not chunks:
        print("\n" + "=" * 60)
        print("NO CONTEXT FOUND:")
        print(err)
        print("=" * 60 + "\n")
        return

    print("\n" + "=" * 60)
    print(f"RETRIEVAL RESULTS — {len(chunks)} chunks")
    print("=" * 60)
    print(format_context_blocks(chunks))
    print("=" * 60)
    print("Showing raw Pinecone context only.")
    print("=" * 60 + "\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="CLI for RAG Production System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Sync documents (interactive namespace picker)
  python cli.py --sync
  python cli.py --sync --namespace documents

  # Query (retrieve raw Pinecone context, no LLM generation)
  python cli.py --query "search for something"
  python cli.py --query "search" --namespace my-namespace

  # Start API server
  python cli.py --serve
        """,
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--sync",
        action="store_true",
        help="Sync documents to Pinecone",
    )
    group.add_argument(
        "--query",
        type=str,
        help="Retrieve Pinecone context for a question (no LLM generation)",
    )
    group.add_argument(
        "--serve",
        action="store_true",
        help="Start the FastAPI server",
    )

    parser.add_argument(
        "--namespace", type=str, default=None,
        help="[--sync/--query] Pinecone namespace to use (skips interactive picker for sync)",
    )

    args = parser.parse_args()

    if args.sync:
        _run_sync(namespace_arg=args.namespace)
    elif args.query:
        asyncio.run(run_query(args.query, args.namespace))
    elif args.serve:
        import uvicorn
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    main()
