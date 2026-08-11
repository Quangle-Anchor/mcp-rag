"""
core/retrieval/query_optimizer.py — Query optimization for RAG retrieval.

Provides general-purpose query utilities for single-namespace retrieval.
"""
from __future__ import annotations

from loguru import logger

from config import get_settings

settings = get_settings()


# ── Guardrail Messages ───────────────────────────────────────────────────────

def build_no_context_message() -> str:
    """Returned when no chunks found at all."""
    return (
        "No context found for this query.\n"
        "Check that sync has been run and the query is specific enough."
    )


def build_insufficient_context_message(
    query: str,
    calls_used: int,
    chunks_found: int,
) -> str:
    """
    Message when retrieval exhausts its call quota
    without sufficient context.
    """
    lines = [
        "[INSUFFICIENT CONTEXT]",
        f"Query: \"{query[:100]}\"",
        f"Calls used: {calls_used}",
        f"Chunks found: {chunks_found}",
        "",
        "Suggestions:",
        "  - Run sync to ensure documents are indexed.",
        "  - Try a more specific or broader query.",
    ]
    return "\n".join(lines)
