"""
core/retrieval/query_optimizer.py — Query optimization for RAG retrieval.

Provides:
  - ID pattern detection (BR-xx, SCR-xx, UC-xx, VAL-, ACT_, etc.)
  - Query expansion for bare ID queries
  - Query intent classification (lookup vs search vs compare)
  - Self-reflection: auto-rewrite query for retry attempts
  - Guardrail message builders
"""
from __future__ import annotations

import re
from enum import Enum
from typing import Any

from loguru import logger

from config import get_settings

settings = get_settings()


# ── ID Pattern Detection ─────────────────────────────────────────────────────

# Common ID patterns found in business/technical documents
_ID_PATTERNS = [
    re.compile(r'\b(BR-\d{2,})\b', re.IGNORECASE),          # BR-01, BR-02
    re.compile(r'\b(SCR-[A-Z]+-\d+)\b', re.IGNORECASE),     # SCR-EMP-02, SCR-HR-01
    re.compile(r'\b(UC-\d+)\b', re.IGNORECASE),              # UC-01, UC-02
    re.compile(r'\b(VAL-[A-Z0-9-]+)\b', re.IGNORECASE),     # VAL-EMP02-001
    re.compile(r'\b(ACT_[A-Za-z_]+)\b'),                      # ACT_Submit, ACT_Approve
    re.compile(r'\b(SUB_[A-Za-z_]+)\b'),                      # SUB_CalculateDays
    re.compile(r'\b(WFA_[A-Za-z_]+)\b'),                      # WFA_ApprovalFlow
    re.compile(r'\b(EVT_[A-Za-z_]+)\b'),                      # EVT_OnClick_Submit
    re.compile(r'\b([EI]\d{3})\b'),                            # E001, I001 (error/info codes)
]


def detect_id_patterns(query: str) -> list[str]:
    """Extract all recognized ID patterns from a query string."""
    ids: list[str] = []
    for pattern in _ID_PATTERNS:
        ids.extend(pattern.findall(query))
    return list(dict.fromkeys(ids))  # deduplicate, preserve order


# ── Query Intent Classification ──────────────────────────────────────────────

class QueryIntent(str, Enum):
    """Simple query intent classification."""
    lookup = "lookup"       # Exact ID lookup (e.g., "BR-02")
    search = "search"       # Semantic search (e.g., "leave approval rules")
    compare = "compare"     # Comparison (e.g., "difference between BR-02 and BR-03")


def classify_query_intent(query: str) -> QueryIntent:
    """
    Classify query intent using heuristics.

    - lookup: query IS an ID or very short with an ID
    - compare: query mentions multiple IDs or comparison words
    - search: everything else
    """
    ids = detect_id_patterns(query)
    words = query.strip().split()

    # Pure ID lookup: query is just an ID (possibly with dehyphenated variant)
    if len(words) <= 2 and len(ids) >= 1:
        return QueryIntent.lookup

    # Comparison: multiple IDs or comparison keywords
    compare_keywords = {"vs", "versus", "compare", "difference", "so sánh", "khác nhau", "giống"}
    if len(ids) >= 2 or any(kw in query.lower() for kw in compare_keywords):
        return QueryIntent.compare

    return QueryIntent.search


# ── Query Expansion ──────────────────────────────────────────────────────────

# Map ID prefixes to expansion terms for semantic enrichment
_ID_EXPANSION_MAP = {
    "BR":  "Business Rule definition description condition logic",
    "SCR": "Screen layout UI page form widget",
    "UC":  "Use Case scenario flow actor",
    "VAL": "Validation rule check field constraint",
    "ACT": "Action microflow operation submit",
    "SUB": "Sub-microflow reusable logic calculation",
    "WFA": "Workflow approval state transition",
    "EVT": "Event trigger handler onClick onLoad",
    "E":   "Error message validation feedback",
    "I":   "Information message notification",
}


def expand_bare_id_query(query: str) -> str:
    """
    If the query is a bare ID (e.g., "BR-02"), expand it with context terms
    to produce a richer embedding.

    "BR-02" → "BR-02 BR02 Business Rule definition description condition logic"

    If the query is already a full sentence, returns it unchanged.
    """
    ids = detect_id_patterns(query)
    intent = classify_query_intent(query)

    if intent != QueryIntent.lookup or not ids:
        return query

    expansions = [query]

    for id_str in ids:
        # Add dehyphenated version: BR-02 → BR02
        if "-" in id_str:
            expansions.append(id_str.replace("-", ""))

        # Find matching prefix and add expansion terms
        prefix = id_str.split("-")[0].split("_")[0].upper()
        if prefix in _ID_EXPANSION_MAP:
            expansions.append(_ID_EXPANSION_MAP[prefix])

    expanded = " ".join(expansions)
    logger.info("[QO] Expanded bare ID query: '{}' → '{}'", query, expanded[:100])
    return expanded


# ── Self-Reflection: Query Rewrite for Retry ─────────────────────────────────

def rewrite_for_retry(query: str, attempt: int) -> str | None:
    """
    Generate an alternative query for self-reflection retry.

    Attempt 1 (original): use the query as-is (or expanded).
    Attempt 2 (retry):    broaden the query — remove specific IDs,
                          focus on the category/concept.

    Returns None if no more rewrites are possible.
    """
    if attempt <= 1:
        return None  # First attempt uses the original query

    ids = detect_id_patterns(query)

    if ids:
        # Strategy: remove specific ID numbers, keep the category
        broad_query = query
        for id_str in ids:
            broad_query = broad_query.replace(id_str, "")
        broad_query = broad_query.strip()

        # Add broader context
        prefix = ids[0].split("-")[0].split("_")[0].upper()
        if prefix in _ID_EXPANSION_MAP:
            broad_query = f"{broad_query} {_ID_EXPANSION_MAP[prefix]}".strip()

        if broad_query and broad_query != query:
            logger.info("[QO] Self-reflection rewrite (attempt {}): '{}' → '{}'",
                       attempt, query[:60], broad_query[:80])
            return broad_query

    # Fallback: just append "context overview summary"
    fallback = f"{query} context overview summary definition"
    logger.info("[QO] Self-reflection fallback (attempt {}): '{}'", attempt, fallback[:80])
    return fallback


# ── Keyword Reranking ────────────────────────────────────────────────────────

def compute_keyword_boost(chunk_content: str, query: str) -> float:
    """
    Compute a bonus score for chunks that contain exact ID matches from the query.

    If the query contains "BR-02" and the chunk literally has "BR-02" in its text,
    this returns settings.keyword_boost (default 10.0). Otherwise returns 0.0.
    """
    ids = detect_id_patterns(query)
    if not ids:
        return 0.0

    content_upper = chunk_content.upper()
    boost = 0.0
    for id_str in ids:
        # Check exact match (case-insensitive)
        if id_str.upper() in content_upper:
            boost += settings.keyword_boost
        # Also check dehyphenated version
        elif "-" in id_str and id_str.replace("-", "").upper() in content_upper:
            boost += settings.keyword_boost * 0.5

    return boost


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
