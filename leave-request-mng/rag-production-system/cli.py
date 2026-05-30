"""
cli.py — CLI wrapper cho RAG Production System.
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\activate.bat
Usage:
  python cli.py --sync doc                              # Sync requirement docs  (5-layer pipeline)
  python cli.py --sync tool                             # Sync tool-spec markdown (3-layer pipeline)
  python cli.py --sync doc  --namespace my-ns           # Override namespace
  python cli.py --sync tool --tool-dir /path/to/specs   # Explicit tool-spec directory
  python cli.py --query "LeaveRequest approval rules"   # Retrieve Pinecone context (no LLM)
  python cli.py --query "màn hình duyệt" --layer ui
  python cli.py --serve

Sync types:
  doc   — Requirement documents: auto-discovers Output/ dirs, runs the 5-layer
           Mendix classifier, chunks with MarkdownHeaderTextSplitter.
  tool  — Tool Specification markdown: reads files with <!-- tool_start ... -->
           markers, applies the 3-layer tool_loader pipeline
           (Category / Tool / Section sub-chunk).

Changes from original:
  - --sync now requires a type argument: 'doc' or 'tool'.
  - --query returns raw Pinecone chunks only (no Gemini generation).
  - Namespace is interactively picked before each sync (--namespace skips picker).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

# Đảm bảo import từ đúng thư mục
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

# Windows terminal encoding fix — force UTF-8 output
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv

# Load .env từ project dir hoặc thư mục cha
_env_paths = [_HERE / ".env", _HERE.parent / ".env"]
for _ep in _env_paths:
    if _ep.exists():
        load_dotenv(_ep)
        break

from loguru import logger


# ── Sync (gọi logic trực tiếp, không qua Celery) ────────────────────────────

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
    """Shared batched-upload loop for both sync paths."""
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


# ── Sync: Requirement Docs (5-layer pipeline) ──────────────────────────────────

def _run_sync_docs(namespace_arg: str | None = None) -> None:
    """
    Sync requirement documents to Pinecone.
    Uses the existing 5-layer Mendix classifier pipeline (loader.py).
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
    logger.info("🔄  SYNC DOC — Requirement Documents (5-layer pipeline)")
    logger.info("  Index:     {}", settings.pinecone_index_name)
    logger.info("  Namespace: {}", chosen_namespace)
    logger.info("=" * 60)

    from core.ingestion.loader import fetch_project_context_documents
    logger.info("Step 1/3 — Discovering requirement documents...")
    try:
        all_chunks = fetch_project_context_documents()
    except FileNotFoundError as exc:
        print(str(exc))
        sys.exit(1)

    total = len(all_chunks)
    if total == 0:
        logger.warning("No documents found. Make sure 'Output' directories exist.")
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
    uploaded = _batched_upsert_cli(all_chunks, vs, "doc-sync")

    logger.info("=" * 60)
    logger.info("✅  SYNC DOC COMPLETE: {}/{} chunks → namespace '{}'.",
                uploaded, total, chosen_namespace)
    logger.info("=" * 60)


# ── Sync: Tool Specifications (3-layer pipeline) ─────────────────────────────

def _run_sync_tools(
    namespace_arg: str | None = None,
    tool_dir_arg: str | None = None,
) -> None:
    """
    Sync Tool Specification markdown files to Pinecone.
    Uses the 3-layer tool_loader pipeline (chunk_tool_directory).
    """
    import os as _os
    from config import get_settings
    settings = get_settings()

    _os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)
    _os.environ.setdefault("PINECONE_API_KEY", settings.pinecone_api_key)

    from pinecone import Pinecone
    from langchain_pinecone import PineconeVectorStore
    from core.ingestion.embeddings import get_embeddings
    from core.ingestion.tool_loader import chunk_tool_directory

    pc = Pinecone(api_key=settings.pinecone_api_key)
    chosen_namespace = namespace_arg or _pick_namespace(
        pc, settings.pinecone_index_name, settings.pinecone_tool_namespace
    )

    # Resolve tool-spec directory (let chunk_tool_directory auto-discover if None)
    resolved_dir = tool_dir_arg or settings.tool_docs_dir

    logger.info("=" * 60)
    logger.info("🔄  SYNC TOOL — Tool Specification Markdown (3-layer pipeline)")
    logger.info("  Index:     {}", settings.pinecone_index_name)
    logger.info("  Namespace: {}", chosen_namespace)
    logger.info("  Tool dir:  {}", resolved_dir)
    logger.info("=" * 60)

    logger.info("Step 1/3 — Chunking tool-spec markdown files...")
    try:
        all_chunks = chunk_tool_directory(resolved_dir)
    except FileNotFoundError as exc:
        print(str(exc))
        sys.exit(1)

    total = len(all_chunks)
    if total == 0:
        logger.warning(
            "No chunks produced. Ensure .md files in '{}' contain "
            "<!-- tool_start id=\"N\" name=\"fn\" --> blocks.",
            resolved_dir,
        )
        return
    logger.info("  {} chunks produced.", total)

    # Print a preview table of what will be uploaded
    from collections import Counter
    chunk_types = Counter(c.metadata.get("chunk_type", "?") for c in all_chunks)
    categories  = Counter(c.metadata.get("category",   "?") for c in all_chunks)
    logger.info("  Categories : {}", dict(categories))
    logger.info("  Chunk types: {}", dict(chunk_types))

    index = pc.Index(settings.pinecone_index_name)
    logger.info("Step 2/3 — Clearing namespace '{}'...", chosen_namespace)
    try:
        index.delete(delete_all=True, namespace=chosen_namespace)
        logger.info("  Namespace '{}' cleared.", chosen_namespace)
    except Exception as exc:
        logger.warning("  Namespace delete failed (may be new/empty): {}", exc)

    logger.info("Step 3/3 — Uploading {} tool chunks...", total)
    vs = PineconeVectorStore(
        index_name=settings.pinecone_index_name,
        embedding=get_embeddings(),
        namespace=chosen_namespace,
    )
    uploaded = _batched_upsert_cli(all_chunks, vs, "tool-sync")

    logger.info("=" * 60)
    logger.info("✅  SYNC TOOL COMPLETE: {}/{} chunks → namespace '{}'.",
                uploaded, total, chosen_namespace)
    logger.info("=" * 60)


# ── Public dispatcher ──────────────────────────────────────────────────────────────

def run_sync(
    sync_type: str,
    namespace_arg: str | None = None,
    tool_dir_arg: str | None = None,
) -> None:
    """Route to the correct sync pipeline based on sync_type ('doc' | 'tool')."""
    if sync_type == "doc":
        _run_sync_docs(namespace_arg=namespace_arg)
    elif sync_type == "tool":
        _run_sync_tools(namespace_arg=namespace_arg, tool_dir_arg=tool_dir_arg)
    else:
        print(f"❌ Unknown sync type '{sync_type}'. Must be 'doc' or 'tool'.")
        sys.exit(1)


# ── Query (pipeline trực tiếp, không qua FastAPI) ────────────────────────────

async def run_query(query: str, layer: str | None = None, namespace_arg: str | None = None) -> None:
    """
    Retrieve chunks using the 2-phase dual-namespace pipeline.
    Displays Phase A (business context) and Phase B (tool spec) separately.
    """
    from config import get_settings
    from core.retrieval.retriever import orchestrate_retrieval, format_plan_output
    from core.retrieval.query_optimizer import build_phase_guardrail_message

    settings = get_settings()

    # Override namespace if provided via CLI
    if namespace_arg:
        settings.pinecone_namespace = namespace_arg

    logger.info("Query: '{}' | Layer: {}", query, layer or "auto-detect")

    # ── Run 2-phase orchestration ─────────────────────────────────────────────
    plan = await orchestrate_retrieval(query=query, top_k=8, layer=layer)

    # ── Check guardrails ──────────────────────────────────────────────────────
    if plan.phase_a.guardrail_msg:
        print("\n" + "=" * 60)
        print("GUARDRAIL TRIGGERED (Phase A):")
        print(plan.phase_a.guardrail_msg)
        print("=" * 60 + "\n")
        return

    if not plan.all_chunks:
        print("\n" + "=" * 60)
        print("NO CONTEXT FOUND:")
        print(build_phase_guardrail_message(plan))
        print("=" * 60 + "\n")
        return

    # ── Print results ─────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"RETRIEVAL RESULTS — Intent: {plan.intent.value}")
    print(f"  Phase A (BIZ):  {len(plan.phase_a.chunks)} chunks, {plan.phase_a.call_count} call(s)")
    print(f"  Phase B (TOOL): {len(plan.phase_b.chunks)} chunks, {plan.phase_b.call_count} call(s)")
    print(f"  Total calls: {plan.total_calls}")
    print("=" * 60)
    print(format_plan_output(plan))
    print("=" * 60)
    print("Generation is disabled. Showing raw Pinecone context only.")
    print("=" * 60 + "\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="CLI for Mendix RAG Production System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Sync requirement documents (5-layer classifier pipeline)
  python cli.py --sync doc
  python cli.py --sync doc --namespace mendix-docs

  # Sync Tool Specification markdown (3-layer tool_loader pipeline)
  python cli.py --sync tool --tool-dir /path/to/tool/specs
  python cli.py --sync tool --tool-dir /path/to/specs --namespace mendix-tools

  # Query (retrieve raw Pinecone context, no LLM generation)
  python cli.py --query "LeaveRequest approval business rules"
  python cli.py --query "màn hình duyệt nghỉ phép" --layer ui
  python cli.py --query "VAL_ check leave balance" --layer behavior

  # Start API server
  python cli.py --serve
        """,
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--sync",
        choices=["doc", "tool"],
        metavar="TYPE",
        help=(
            "Sync data to Pinecone. TYPE must be one of:\n"
            "  doc   — requirement docs  (5-layer Mendix classifier pipeline)\n"
            "  tool  — tool-spec markdown (3-layer tool_loader pipeline)"
        ),
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
        "--layer", type=str, default=None,
        choices=["foundation", "api", "behavior", "ui", "cross-cutting"],
        help="[--query] Restrict retrieval to a specific Mendix layer",
    )
    parser.add_argument(
        "--namespace", type=str, default=None,
        help="[--sync] Skip the interactive namespace picker and use this value directly",
    )
    parser.add_argument(
        "--tool-dir", type=str, default=None, dest="tool_dir",
        help="[--sync tool] Path to the directory containing tool-spec .md files",
    )

    args = parser.parse_args()

    if args.sync:
        run_sync(
            sync_type=args.sync,
            namespace_arg=args.namespace,
            tool_dir_arg=args.tool_dir,
        )
    elif args.query:
        asyncio.run(run_query(args.query, args.layer, args.namespace))
    elif args.serve:
        import uvicorn
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    main()
