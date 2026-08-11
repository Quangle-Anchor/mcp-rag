"""
core/retrieval/retriever.py — Single-namespace retrieval.

Simplified from the dual-namespace 2-phase orchestrator.
Now provides straightforward Pinecone retrieval with optional retry.
"""
from __future__ import annotations

from typing import Any

from langchain_core.documents import Document
from loguru import logger

from config import get_settings
from core.retrieval.query_optimizer import (
    build_no_context_message,
    build_insufficient_context_message,
)
from db.vector_db import get_retriever

settings = get_settings()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _docs_to_chunks(docs: list[Document], offset: int = 0) -> list[dict[str, Any]]:
    """Convert LangChain Documents → dicts with score proxy."""
    return [
        {
            "id": f"chunk_{offset + i}",
            "content": doc.page_content,
            "metadata": doc.metadata,
            "score": round(1.0 - (i / max(len(docs), 1)) * 0.3, 3),
        }
        for i, doc in enumerate(docs)
    ]


def _deduplicate_chunks(chunks: list[dict]) -> list[dict]:
    """Remove duplicate chunks based on content."""
    seen: set[str] = set()
    result: list[dict] = []
    for c in chunks:
        if c["content"] not in seen:
            result.append(c)
            seen.add(c["content"])
    return result


# ── Main retrieval function ──────────────────────────────────────────────────

async def retrieve_chunks(
    query: str,
    top_k: int | None = None,
    namespace: str | None = None,
    metadata_filter: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    """
    Retrieve chunks from Pinecone.

    Performs a single retrieval call. If no results and no filter was applied,
    returns a no-context message.

    Args:
        query:           Search query text.
        top_k:           Number of chunks to retrieve.
        namespace:       Pinecone namespace (defaults to settings).
        metadata_filter: Optional Pinecone metadata filter dict.

    Returns:
        (chunks, error_message) — error_message is None on success.
    """
    k = top_k or settings.top_k_retrieval

    retriever_instance = get_retriever(
        top_k=k,
        namespace=namespace,
        metadata_filter=metadata_filter,
    )

    logger.info(
        "[RETRIEVE] namespace='{}' | filter={} | top_k={} | query='{}'",
        namespace or settings.pinecone_namespace,
        metadata_filter, k, query[:80],
    )

    docs: list[Document] = retriever_instance.invoke(query)

    if not docs:
        return [], build_no_context_message()

    chunks = _docs_to_chunks(docs)
    chunks = _deduplicate_chunks(chunks)
    chunks = chunks[:k]

    logger.info("[RETRIEVE] {} chunks retrieved", len(chunks))
    return chunks, None


# ── Formatting ────────────────────────────────────────────────────────────────

def format_context_blocks(chunks: list[dict[str, Any]], label: str = "") -> str:
    """Format chunks into bordered text blocks."""
    if not chunks:
        return build_no_context_message()

    parts = []
    for chunk in chunks:
        meta = chunk.get("metadata", {})
        src  = meta.get("file_name", meta.get("source", "unknown"))
        header = f"SOURCE: {src}"

        parts.append(
            f"=== {header} ===\n"
            f"{chunk['content']}\n"
            f"{'=' * 40}"
        )
    return "\n\n".join(parts)
