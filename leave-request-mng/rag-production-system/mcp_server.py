"""
mcp_server.py — FastMCP wrapper for the RAG Production System.

Provides two MCP tools:
  - sync_documents: Re-index all documents into Pinecone
  - retrieve_context: Retrieve document chunks from Pinecone
"""
from __future__ import annotations

import os
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
from cli import _run_sync

mcp = FastMCP("RAG Server Production")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sanitize_filter(f: Any) -> Any:
    """Recursively strip backticks from filter keys (e.g. `$in` → $in)."""
    if isinstance(f, dict):
        return {k.strip("`"): _sanitize_filter(v) for k, v in f.items()}
    if isinstance(f, list):
        return [_sanitize_filter(item) for item in f]
    return f


# ── MCP Tools ─────────────────────────────────────────────────────────────────

@mcp.tool()
def sync_documents(namespace: Optional[str] = None) -> str:
    """
    [ADMIN — USER CONSENT REQUIRED]
    Re-index all project documentation files into Pinecone.

    *** AI AGENT: YOU ARE STRICTLY FORBIDDEN FROM CALLING THIS TOOL DIRECTLY. ***
    Before executing this tool you MUST:
      1. Inform the user that a full re-index is needed and why.
      2. Ask: "Do you want me to reset and re-sync the Pinecone index? This will
         delete all existing vectors and re-upload all documents."
      3. Proceed ONLY if the user explicitly answers YES.

    Args:
        namespace: Optional Pinecone namespace. Defaults to settings value.
    """
    import io
    from contextlib import redirect_stdout, redirect_stderr
    from config import get_settings
    settings = get_settings()

    out = io.StringIO()
    with redirect_stdout(out), redirect_stderr(out):
        try:
            _run_sync(namespace_arg=namespace or settings.pinecone_namespace)
        except Exception as e:
            return f"Sync failed: {e}\n{out.getvalue()}"

    return out.getvalue() + "\nSuccessfully synced all documents."


@mcp.tool()
async def retrieve_context(
    query: str,
    namespace: Optional[str] = None,
    metadata_filter: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Retrieve context from the Pinecone knowledge base.

    Args:
        query: A precise description of the information needed.
        namespace: Pinecone namespace to query. Defaults to settings value.
        metadata_filter: Optional Pinecone metadata filter object.
    """
    safe_filter = _sanitize_filter(metadata_filter) if metadata_filter else None

    chunks, err = await retrieve_chunks(
        query=query,
        namespace=namespace,
        metadata_filter=safe_filter,
    )

    if err:
        return err

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
