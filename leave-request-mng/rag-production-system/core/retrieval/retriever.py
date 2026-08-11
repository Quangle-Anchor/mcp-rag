"""
core/retrieval/retriever.py — Hybrid Search retrieval pipeline.

Pipeline (per query):
  1. Query Optimization: detect IDs, expand bare ID queries
  2. Dense Search: Pinecone vector similarity → top_k × 2 candidates
  3. BM25 Search: In-memory keyword index → top_k × 2 candidates
  4. RRF Fusion: Merge dense + BM25 results with Reciprocal Rank Fusion
  5. Keyword Reranking: Boost chunks containing exact ID matches
  6. Deduplicate + Trim to final top_k
  7. Self-Reflection: If <2 relevant chunks, rewrite query and retry (max 2 attempts)
"""
from __future__ import annotations

from typing import Any

from langchain_core.documents import Document
from loguru import logger

from config import get_settings
from core.retrieval.bm25_index import get_bm25_index
from core.retrieval.query_optimizer import (
    build_no_context_message,
    build_insufficient_context_message,
    expand_bare_id_query,
    compute_keyword_boost,
    rewrite_for_retry,
    detect_id_patterns,
    classify_query_intent,
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


# ── RRF Fusion ────────────────────────────────────────────────────────────────

def _rrf_fusion(
    dense_chunks: list[dict[str, Any]],
    bm25_chunks: list[dict[str, Any]],
    query: str,
    k: int = 60,
) -> list[dict[str, Any]]:
    """
    Reciprocal Rank Fusion: merge dense and BM25 results.

    RRF score = bm25_weight * (1 / (k + bm25_rank)) + dense_weight * (1 / (k + dense_rank))

    Chunks appearing in both lists get scores from both; chunks in only one
    list get score from that source only.

    After RRF, applies keyword boost for exact ID matches.
    """
    # Build content → chunk mapping (use content as key for dedup)
    merged: dict[str, dict[str, Any]] = {}

    # Score dense results
    for rank, chunk in enumerate(dense_chunks):
        content = chunk["content"]
        rrf_score = settings.dense_weight * (1.0 / (k + rank + 1))
        if content in merged:
            merged[content]["rrf_score"] += rrf_score
            merged[content]["sources"].append("dense")
        else:
            merged[content] = {
                "content": content,
                "metadata": chunk.get("metadata", {}),
                "rrf_score": rrf_score,
                "dense_rank": rank,
                "bm25_rank": None,
                "sources": ["dense"],
            }

    # Score BM25 results
    for rank, chunk in enumerate(bm25_chunks):
        content = chunk["content"]
        rrf_score = settings.bm25_weight * (1.0 / (k + rank + 1))
        if content in merged:
            merged[content]["rrf_score"] += rrf_score
            if "bm25" not in merged[content]["sources"]:
                merged[content]["sources"].append("bm25")
            merged[content]["bm25_rank"] = rank
        else:
            merged[content] = {
                "content": content,
                "metadata": chunk.get("metadata", {}),
                "rrf_score": rrf_score,
                "dense_rank": None,
                "bm25_rank": rank,
                "sources": ["bm25"],
            }

    # Apply keyword boost
    for item in merged.values():
        boost = compute_keyword_boost(item["content"], query)
        if boost > 0:
            item["rrf_score"] += boost
            item["sources"].append("keyword_boost")

    # Sort by RRF score descending
    ranked = sorted(merged.values(), key=lambda x: x["rrf_score"], reverse=True)

    # Convert to standard chunk format
    results = []
    for rank, item in enumerate(ranked):
        results.append({
            "id": f"hybrid_{rank}",
            "content": item["content"],
            "metadata": item["metadata"],
            "score": round(item["rrf_score"], 4),
            "dense_rank": item["dense_rank"],
            "bm25_rank": item["bm25_rank"],
            "sources": item["sources"],
        })

    return results


# ── Single retrieval attempt ─────────────────────────────────────────────────

async def _retrieve_once(
    query: str,
    top_k: int,
    namespace: str | None,
    metadata_filter: dict[str, Any] | None,
    attempt: int,
) -> list[dict[str, Any]]:
    """
    Execute one retrieval attempt using hybrid search.

    Steps:
      1. Expand query (if bare ID)
      2. Dense search via Pinecone
      3. BM25 search via in-memory index
      4. RRF Fusion + Keyword Reranking
      5. Deduplicate + Trim
    """
    # ── 1. Query expansion ────────────────────────────────────────────────────
    search_query = expand_bare_id_query(query) if attempt == 1 else query

    # ── 2. Dense search (Pinecone) ────────────────────────────────────────────
    retriever_instance = get_retriever(
        top_k=top_k * 2,  # Over-fetch for fusion
        namespace=namespace,
        metadata_filter=metadata_filter,
    )

    logger.info(
        "[RETRIEVE] attempt={} | namespace='{}' | top_k={} | query='{}'",
        attempt,
        namespace or settings.pinecone_namespace,
        top_k, search_query[:80],
    )

    docs: list[Document] = retriever_instance.invoke(search_query)
    dense_chunks = _docs_to_chunks(docs)

    # ── 3. BM25 search ───────────────────────────────────────────────────────
    bm25_index = get_bm25_index()
    bm25_results: list[dict[str, Any]] = []

    if bm25_index.is_ready:
        bm25_results = bm25_index.search(search_query, top_k=top_k * 2)
        logger.info(
            "[RETRIEVE] BM25: {} results (top_score={:.3f})",
            len(bm25_results),
            bm25_results[0]["bm25_score"] if bm25_results else 0.0,
        )
    else:
        logger.debug("[RETRIEVE] BM25 index not available — using dense search only")

    # ── 4. RRF Fusion + Keyword Reranking ─────────────────────────────────────
    if bm25_results:
        fused = _rrf_fusion(dense_chunks, bm25_results, query, k=settings.rrf_k)
        logger.info(
            "[RETRIEVE] RRF fusion: {} dense + {} BM25 → {} merged",
            len(dense_chunks), len(bm25_results), len(fused),
        )
    else:
        # No BM25 — still apply keyword reranking to dense results
        for chunk in dense_chunks:
            boost = compute_keyword_boost(chunk["content"], query)
            if boost > 0:
                chunk["score"] += boost
        dense_chunks.sort(key=lambda x: x["score"], reverse=True)
        fused = dense_chunks

    # ── 5. Deduplicate + Trim ─────────────────────────────────────────────────
    fused = _deduplicate_chunks(fused)
    return fused[:top_k]


# ── Main retrieval function (with self-reflection) ───────────────────────────

async def retrieve_chunks(
    query: str,
    top_k: int | None = None,
    namespace: str | None = None,
    metadata_filter: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    """
    Retrieve chunks using hybrid search with self-reflection.

    Pipeline:
      Attempt 1: Hybrid search (Dense + BM25 + RRF + Keyword Boost)
      Attempt 2: If <2 chunks found, rewrite query and retry (self-reflection)

    Args:
        query:           Search query text.
        top_k:           Number of chunks to retrieve.
        namespace:       Pinecone namespace (defaults to settings).
        metadata_filter: Optional Pinecone metadata filter dict.

    Returns:
        (chunks, error_message) — error_message is None on success.
    """
    k = top_k or settings.top_k_retrieval
    max_attempts = settings.max_retrieval_attempts if settings.enable_self_reflection else 1
    all_chunks: list[dict[str, Any]] = []

    for attempt in range(1, max_attempts + 1):
        # Determine query for this attempt
        if attempt == 1:
            current_query = query
        else:
            rewritten = rewrite_for_retry(query, attempt)
            if rewritten is None:
                break
            current_query = rewritten

        chunks = await _retrieve_once(
            query=current_query,
            top_k=k,
            namespace=namespace,
            metadata_filter=metadata_filter,
            attempt=attempt,
        )

        # Merge with previous attempts' results
        if attempt > 1 and chunks:
            existing_contents = {c["content"] for c in all_chunks}
            for c in chunks:
                if c["content"] not in existing_contents:
                    all_chunks.append(c)
                    existing_contents.add(c["content"])
        else:
            all_chunks = chunks

        # Check if we have enough context
        if len(all_chunks) >= settings.sufficient_chunk_threshold:
            logger.info(
                "[RETRIEVE] Sufficient context ({} chunks) after attempt {}",
                len(all_chunks), attempt,
            )
            break
        elif attempt < max_attempts:
            logger.info(
                "[RETRIEVE] Only {} chunks after attempt {} — self-reflection retry",
                len(all_chunks), attempt,
            )

    if not all_chunks:
        return [], build_no_context_message()

    # Final trim
    all_chunks = all_chunks[:k]
    logger.info("[RETRIEVE] Final: {} chunks returned", len(all_chunks))
    return all_chunks, None


# ── Formatting ────────────────────────────────────────────────────────────────

def format_context_blocks(chunks: list[dict[str, Any]], label: str = "") -> str:
    """Format chunks into bordered text blocks."""
    if not chunks:
        return build_no_context_message()

    parts = []
    for chunk in chunks:
        meta = chunk.get("metadata", {})
        src = meta.get("file_name", meta.get("source", "unknown"))
        sources = chunk.get("sources", [])
        source_tag = f" [{'+'.join(sources)}]" if sources else ""
        header = f"SOURCE: {src}{source_tag}"

        parts.append(
            f"=== {header} ===\n"
            f"{chunk['content']}\n"
            f"{'=' * 40}"
        )
    return "\n\n".join(parts)
