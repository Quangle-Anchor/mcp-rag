"""
mcp_server.py - FastMCP wrapper for the new RAG Production System.

Enhancements over basic wrapper:
  - Sibling Expansion (Phase B): When tool spec chunks are found,
    automatically fetches all sibling chunks from the same tool.
  - Keyword Re-ranking (Phase A): Detects specific IDs in the query
    (e.g., BR-02, SCR-EMP-01) and boosts chunks that contain them.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, Optional

# Ensure we can import from rag-production-system
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from dotenv import load_dotenv
_env_paths = [_HERE / ".env", _HERE.parent / ".env"]
for _ep in _env_paths:
    if _ep.exists():
        load_dotenv(_ep)
        break

from mcp.server.fastmcp import FastMCP
from core.retrieval.retriever import retrieve_chunks, format_context_blocks
from cli import _run_sync_docs, _run_sync_tools

mcp = FastMCP("Mendix RAG Server Production")


# ── Helpers ───────────────────────────────────────────────────────────────────

# Regex to detect specific IDs in user queries
_ID_RE = re.compile(r'\b(BR-?\d{2,}|SCR-?[A-Z]+-?\d+|UC-?\d+|[IE]\d{3})\b', re.IGNORECASE)


def _sanitize_filter(f: Any) -> Any:
    """Recursively strip backticks from filter keys (e.g. `$in` → $in)."""
    if isinstance(f, dict):
        return {k.strip("`"): _sanitize_filter(v) for k, v in f.items()}
    if isinstance(f, list):
        return [_sanitize_filter(item) for item in f]
    return f


def _normalize_id(raw_id: str) -> set[str]:
    """
    Generate all variations of an ID for matching.
    e.g., "BR02" → {"BR-02", "BR02", "br-02", "br02"}
    """
    upper = raw_id.upper()
    variants: set[str] = {upper, upper.replace("-", "")}

    # If no hyphen, try inserting one (BR02 → BR-02)
    m = re.match(r'^([A-Z]+)(\d+)$', upper)
    if m:
        variants.add(f"{m.group(1)}-{m.group(2)}")

    # SCR patterns: SCREMP01 → SCR-EMP-01
    m2 = re.match(r'^SCR([A-Z]+)(\d+)$', upper)
    if m2:
        variants.add(f"SCR-{m2.group(1)}-{m2.group(2)}")

    return variants


def _keyword_rerank(chunks: list[dict], query: str) -> list[dict]:
    """
    Re-rank chunks by boosting those that contain specific IDs from the query.

    Dense embeddings treat "BR-02" and "BR-06" as nearly identical vectors.
    This post-retrieval step ensures chunks with the EXACT queried ID
    float to the top.
    """
    query_ids = _ID_RE.findall(query)
    if not query_ids:
        return chunks  # no IDs detected, keep original order

    # Build all variations of each detected ID
    target_variants: set[str] = set()
    for raw_id in query_ids:
        target_variants.update(_normalize_id(raw_id))

    # Score each chunk: +10 for each target ID found in its content
    scored: list[tuple[float, int, dict]] = []
    for i, chunk in enumerate(chunks):
        content_upper = chunk.get("content", "").upper()
        boost = sum(10.0 for v in target_variants if v in content_upper)
        base_score = chunk.get("score", 0.5)
        scored.append((base_score + boost, -i, chunk))  # -i for stable sort

    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [item[2] for item in scored]


# ── MCP Tools ─────────────────────────────────────────────────────────────────

@mcp.tool()
def sync_mendix_context() -> str:
    """
    [ADMIN — USER CONSENT REQUIRED]
    Re-index all project documentation files into Pinecone.

    *** AI AGENT: YOU ARE STRICTLY FORBIDDEN FROM CALLING THIS TOOL DIRECTLY. ***
    Before executing this tool you MUST:
      1. Inform the user that a full re-index is needed and why.
      2. Ask: "Do you want me to reset and re-sync the Pinecone index? This will
         delete all existing vectors and re-upload all documents."
      3. Proceed ONLY if the user explicitly answers YES.

    Calling this tool without explicit user confirmation is a critical violation.
    """
    import io
    from contextlib import redirect_stdout, redirect_stderr
    from config import get_settings
    settings = get_settings()

    out = io.StringIO()
    with redirect_stdout(out), redirect_stderr(out):
        try:
            print("Syncing documentation...")
            _run_sync_docs(namespace_arg=settings.pinecone_namespace)
            print("\nSyncing tools...")
            _run_sync_tools(namespace_arg=settings.pinecone_tool_namespace)
        except Exception as e:
            return f"Sync failed: {e}\n{out.getvalue()}"

    return out.getvalue() + "\nSuccessfully synced all contexts."


@mcp.tool()
async def retrieve_mendix_context(query: str, namespace: str, metadata_filter: Optional[Dict[str, Any]] = None) -> str:
    """
    Retrieve Grounding Truth context from the Pinecone knowledge base.

    Args:
        query: A precise English description of the information needed.
        namespace: Either 'mendix-docs' (Phase A) or 'mx-tools-agent-microflow' (Phase B).
        metadata_filter: Optional Pinecone metadata filter object.
    """
    safe_filter = _sanitize_filter(metadata_filter) if metadata_filter else None

    # ── Initial retrieval ─────────────────────────────────────────────────────
    chunks, err = await retrieve_chunks(
        query=query,
        namespace=namespace,
        metadata_filter=safe_filter,
    )

    if err:
        return err

    from config import get_settings
    settings = get_settings()
    TOOL_NAMESPACE = settings.pinecone_tool_namespace
    BIZ_NAMESPACE = settings.pinecone_namespace

    # ── Phase B: Sibling Expansion for Tool Specs ─────────────────────────────
    # Problem: microflows.md is split into 19 parts. Pinecone only returns the
    # 1-2 parts with highest cosine similarity — missing CreateObject, ChangeObject etc.
    #
    # Fix strategy:
    #   1. Group by file_name (catches multi-part files like microflows.md).
    #   2. Also group by tool_name for regular single-tool files.
    # Both expansions use a high top_k to pull ALL parts.
    if namespace == TOOL_NAMESPACE and chunks:
        seen_content: set[str] = set()
        for c in chunks:
            seen_content.add(c.get("content", ""))

        # Group 1: file-level expansion (for microflows.md and similar large files)
        found_files: set[str] = set()
        for c in chunks:
            fn = c.get("metadata", {}).get("file_name")
            total_parts = c.get("metadata", {}).get("total_parts", 1)
            # Only expand if the file has multiple parts (is a big split file)
            if fn and total_parts and int(total_parts) > 1:
                found_files.add(fn)

        if found_files:
            for file_name in found_files:
                file_chunks, _ = await retrieve_chunks(
                    query=f"tool specification complete reference {file_name}",
                    namespace=TOOL_NAMESPACE,
                    metadata_filter={"data_type": "tool_spec", "file_name": file_name},
                    top_k=30,  # microflows.md has 19 parts — grab them all
                )
                for sc in file_chunks:
                    if sc.get("content", "") not in seen_content:
                        chunks.append(sc)
                        seen_content.add(sc.get("content", ""))

        # Group 2: tool-level expansion for regular single-tool files
        found_tools: set[str] = set()
        for c in chunks:
            tn = c.get("metadata", {}).get("tool_name")
            fn = c.get("metadata", {}).get("file_name", "")
            # Skip tools already covered by file-level expansion
            if tn and fn not in found_files:
                found_tools.add(tn)

        if found_tools:
            sibling_filter = {
                "data_type": "tool_spec",
                "tool_name": {"$in": list(found_tools)},
            }
            sibling_chunks, _ = await retrieve_chunks(
                query=f"tool specification input schema parameters behavior for {' '.join(found_tools)}",
                namespace=TOOL_NAMESPACE,
                metadata_filter=sibling_filter,
                top_k=16,
            )
            for sc in sibling_chunks:
                if sc.get("content", "") not in seen_content:
                    chunks.append(sc)
                    seen_content.add(sc.get("content", ""))

    # ── Phase A: Keyword Re-ranking for Business Docs ─────────────────────────
    if namespace == BIZ_NAMESPACE:
        chunks = _keyword_rerank(chunks, query)

    return format_context_blocks(chunks)



def _require_env() -> None:
    if not os.environ.get("GOOGLE_API_KEY"):
        raise RuntimeError("Missing GOOGLE_API_KEY in environment.")
    if not os.environ.get("PINECONE_API_KEY"):
        raise RuntimeError("Missing PINECONE_API_KEY in environment.")

if __name__ == "__main__":
    _require_env()
    print("Starting RAG MCP Production Server...", file=sys.stderr)
    mcp.run()
