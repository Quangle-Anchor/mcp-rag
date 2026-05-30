"""
core/retrieval/retriever.py — Dual-Namespace 2-Phase Retrieval Orchestrator.

Implements the fully automatic retrieval pipeline:
  Phase A: Business context from mendix-docs namespace
  Phase B: Tool spec from mx-tools-agent-microflow namespace

Each phase:
  1. Call #1 — deep targeted search with filter
  2. Evaluate — is context sufficient?
  3. IF insufficient → Call #2 with broadened query (no filter / wider filter)
  4. HARD STOP after 2 calls per phase

Total max calls = 4 (2 per phase × 2 phases).
"""
from __future__ import annotations

import re
from typing import Any

from langchain_core.documents import Document
from loguru import logger

from config import get_settings
from core.retrieval.query_optimizer import (
    QueryPlan,
    RetrievalIntent,
    RetrievalPhase,
    PhaseResult,
    build_empty_layer_message,
    build_no_context_message,
    build_phase_guardrail_message,
    detect_mendix_layer,
    detect_retrieval_intent,
    generate_biz_filter,
    generate_tool_filter,
    rewrite_query_for_retrieval,
    sort_chunks_by_priority,
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


# Regex to detect specific IDs in queries (BR-02, SCR-EMP-01, UC-03, E001, etc.)
_ID_RE = re.compile(r'\b(BR-?\d{2,}|SCR-?[A-Z]+-?\d+|UC-?\d+|[IE]\d{3})\b', re.IGNORECASE)


def _keyword_rerank(chunks: list[dict], query: str) -> list[dict]:
    """
    Post-retrieval re-ranking: combines two signals to rank chunks.

    Signal 1 — Exact ID match (+10 per matching ID found in content):
        Dense embeddings treat "BR-02" and "BR-06" as nearly identical vectors.
        Finding the queried ID literally in the content text boosts it.

    Signal 2 — Doc-type source tier (+0..+8 from DOC_TYPE_TIER):
        build_report / screen_layout files REFERENCE many IDs without owning them.
        Primary spec files (business_rules, domain_definition, message_list) get
        a bonus so they beat referencing files even at the same embedding score.

    If query has no IDs, only doc-type tier reordering is applied.
    """
    from core.retrieval.query_optimizer import DOC_TYPE_TIER

    query_ids = _ID_RE.findall(query)

    # Build all ID variations
    target_variants: set[str] = set()
    for raw_id in query_ids:
        upper = raw_id.upper()
        target_variants.add(upper)
        target_variants.add(upper.replace("-", ""))
        m = re.match(r'^([A-Z]+)(\d+)$', upper)
        if m:
            target_variants.add(f"{m.group(1)}-{m.group(2)}")

    scored: list[tuple[float, int, dict]] = []
    for i, chunk in enumerate(chunks):
        content_upper = chunk.get("content", "").upper()
        doc_type = chunk.get("metadata", {}).get("doc_type", "general").lower().strip()
        base_score = chunk.get("score", 0.5)

        # Signal 1: exact ID match
        id_boost = sum(10.0 for v in target_variants if v in content_upper)

        # Signal 2: doc-type tier (scale to 0..8 range so IDs still dominate)
        tier_raw = DOC_TYPE_TIER.get(doc_type, 0)
        tier_boost = tier_raw / 10.0  # +8.0 for tier-1, 0 for tier-2, -2.0 for tier-3

        total = base_score + id_boost + tier_boost
        
        from loguru import logger
        logger.debug("[RERANK] doc_type={} | base={} | id_boost={} | tier_boost={} | total={}", doc_type, base_score, id_boost, tier_boost, total)
        
        scored.append((total, -i, chunk))

    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [item[2] for item in scored]


# ── Single-phase retrieval (1 or 2 calls) ────────────────────────────────────

async def _execute_phase(
    query: str,
    phase_result: PhaseResult,
    metadata_filter: dict[str, Any] | None,
    phase: RetrievalPhase,
    top_k: int,
    layer_str: str | None = None,
    biz_context: list[dict] | None = None,
) -> None:
    """
    Execute a single retrieval phase with retry logic.

    Call #1: Deep targeted search with filter.
    IF insufficient → Call #2: Broadened query (relax filter).
    Updates phase_result in-place.
    """
    # ── Call #1 ───────────────────────────────────────────────────────────────
    attempt = 1
    rewritten = rewrite_query_for_retrieval(query, phase=phase, attempt=attempt, biz_context=biz_context)
    phase_result.call_count += 1
    phase_result.queries_used.append(rewritten)
    phase_result.filters_used.append(metadata_filter or {})

    logger.info(
        "[RETRIEVE] Phase {} | Call #{} | namespace='{}' | filter={} | query='{}'",
        phase.value, phase_result.call_count, phase_result.namespace,
        metadata_filter, rewritten[:80],
    )

    retriever_instance = get_retriever(
        top_k=top_k * 3,  # Over-fetch for re-ranking
        namespace=phase_result.namespace,
        metadata_filter=metadata_filter,
    )
    docs: list[Document] = retriever_instance.invoke(rewritten)


    # Empty Layer Guardrail (Phase A only)
    if not docs and layer_str and phase == RetrievalPhase.biz:
        logger.warning("[GUARDRAIL] Empty layer: '{}' — 0 chunks returned", layer_str)
        phase_result.guardrail_msg = build_empty_layer_message(layer_str)
        return

    chunks = _docs_to_chunks(docs)
    chunks = sort_chunks_by_priority(chunks)
    # Keyword re-ranking for Phase A (business docs)
    if phase == RetrievalPhase.biz:
        chunks = _keyword_rerank(chunks, query)
        
    # Trim back to requested top_k
    chunks = chunks[:top_k]
    phase_result.chunks.extend(chunks)

    logger.info(
        "[RETRIEVE] Phase {} Call #{} complete — {} chunks",
        phase.value, phase_result.call_count, len(chunks),
    )

    # ── Evaluate: sufficient? ─────────────────────────────────────────────────
    if phase_result.has_context:
        logger.info(
            "[RETRIEVE] Phase {} sufficient ({} chunks) — skipping Call #2",
            phase.value, len(phase_result.chunks),
        )
        return

    if phase_result.calls_exhausted:
        logger.warning(
            "[RETRIEVE] Phase {} — call quota exhausted ({}/{}) with {} chunks",
            phase.value, phase_result.call_count, settings.max_calls_per_phase,
            len(phase_result.chunks),
        )
        return

    # ── Call #2: Broadened query ──────────────────────────────────────────────
    attempt = 2
    rewritten2 = rewrite_query_for_retrieval(query, phase=phase, attempt=attempt, biz_context=biz_context)
    phase_result.call_count += 1
    phase_result.queries_used.append(rewritten2)

    # Relax filter for retry
    relaxed_filter: dict[str, Any] | None = None
    if phase == RetrievalPhase.tool:
        # Keep data_type but drop tool_name filter
        relaxed_filter = {"data_type": "tool_spec"}
    # Phase A: drop layer filter entirely (search all layers)
    phase_result.filters_used.append(relaxed_filter or {})

    logger.info(
        "[RETRIEVE] Phase {} | Call #{} (retry) | filter={} | query='{}'",
        phase.value, phase_result.call_count, relaxed_filter, rewritten2[:80],
    )

    retriever_instance2 = get_retriever(
        top_k=top_k * 3,
        namespace=phase_result.namespace,
        metadata_filter=relaxed_filter,
    )
    docs2: list[Document] = retriever_instance2.invoke(rewritten2)
    chunks2 = _docs_to_chunks(docs2, offset=len(phase_result.chunks))
    chunks2 = sort_chunks_by_priority(chunks2)
    
    if phase == RetrievalPhase.biz:
        chunks2 = _keyword_rerank(chunks2, query)
        
    chunks2 = chunks2[:top_k]

    # Merge + deduplicate
    phase_result.chunks = _deduplicate_chunks(phase_result.chunks + chunks2)
    # Re-sort combined to ensure priority holds across merged calls, then trim
    phase_result.chunks = sort_chunks_by_priority(phase_result.chunks)
    if phase == RetrievalPhase.biz:
        phase_result.chunks = _keyword_rerank(phase_result.chunks, query)
    phase_result.chunks = phase_result.chunks[:top_k]


    logger.info(
        "[RETRIEVE] Phase {} Call #{} complete — {} total chunks after merge",
        phase.value, phase_result.call_count, len(phase_result.chunks),
    )


# ── Orchestration: 2-Phase Flow ──────────────────────────────────────────────

async def orchestrate_retrieval(
    query: str,
    top_k: int | None = None,
    layer: str | None = None,
) -> QueryPlan:
    """
    Fully automatic 2-phase dual-namespace retrieval.

    1. Detect intent (biz_only / tool_only / biz_then_tool)
    2. Phase A: Business context from mendix-docs
    3. Phase B: Tool spec from mx-tools-agent-microflow (if needed)
    4. Return merged QueryPlan with all context

    Each phase has its own call counter (max 2 calls per phase).
    """
    k = top_k or settings.top_k_retrieval
    plan = QueryPlan(original_query=query)
    plan.intent = detect_retrieval_intent(query)

    logger.info(
        "=" * 60 + "\n"
        "[ORCHESTRATE] Intent: {} | Query: '{}'\n" + "=" * 60,
        plan.intent.value, query[:80],
    )

    # ── Phase A: Business Context ─────────────────────────────────────────────
    if plan.intent in (RetrievalIntent.biz_only, RetrievalIntent.biz_then_tool):
        biz_filter = generate_biz_filter(query, layer)
        layer_str = layer or detect_mendix_layer(query)

        logger.info("[ORCHESTRATE] Phase A — Business Context (namespace='{}')", plan.phase_a.namespace)

        await _execute_phase(
            query=query,
            phase_result=plan.phase_a,
            metadata_filter=biz_filter,
            phase=RetrievalPhase.biz,
            top_k=k,
            layer_str=layer_str,
        )

        # If guardrail triggered in Phase A, stop early
        if plan.phase_a.guardrail_msg:
            return plan

    # ── Phase B: Tool Spec ────────────────────────────────────────────────────
    if plan.intent in (RetrievalIntent.tool_only, RetrievalIntent.biz_then_tool):
        tool_filter = generate_tool_filter(query, plan.phase_a.chunks or None)

        logger.info("[ORCHESTRATE] Phase B — Tool Spec (namespace='{}')", plan.phase_b.namespace)

        await _execute_phase(
            query=query,
            phase_result=plan.phase_b,
            metadata_filter=tool_filter,
            phase=RetrievalPhase.tool,
            top_k=k,
            biz_context=plan.phase_a.chunks,
        )

    logger.info(
        "[ORCHESTRATE] Complete | Phase A: {} chunks ({} calls) | Phase B: {} chunks ({} calls) | Total: {} calls",
        len(plan.phase_a.chunks), plan.phase_a.call_count,
        len(plan.phase_b.chunks), plan.phase_b.call_count,
        plan.total_calls,
    )

    return plan


# ── Legacy-compatible single-call retrieve (for backward compat) ─────────────

async def retrieve_chunks(
    query: str,
    ctx: Any = None,
    top_k: int | None = None,
    layer: str | None = None,
    namespace: str | None = None,
    metadata_filter: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    """
    Backward-compatible single-call Pinecone retrieval.

    Used by cli.py --query with explicit namespace.
    For the full 2-phase flow, use orchestrate_retrieval() instead.
    """
    k = top_k or settings.top_k_retrieval

    # Build filter
    effective_filter = metadata_filter
    if effective_filter is None and layer:
        effective_filter = generate_biz_filter(query, layer)

    retriever_instance = get_retriever(
        top_k=k,
        namespace=namespace,
        metadata_filter=effective_filter,
    )
    docs: list[Document] = retriever_instance.invoke(query)

    if not docs:
        return [], build_no_context_message()

    chunks = _docs_to_chunks(docs)
    chunks = sort_chunks_by_priority(chunks)
    return chunks, None


# ── Formatting ────────────────────────────────────────────────────────────────

def format_context_blocks(chunks: list[dict[str, Any]], label: str = "") -> str:
    """
    Format chunks into bordered text blocks.

    Supports both business context and tool spec formatting.
    """
    if not chunks:
        return build_no_context_message()

    parts = []
    for chunk in chunks:
        meta      = chunk.get("metadata", {})
        src       = meta.get("file_name", meta.get("source", "unknown"))
        data_type = meta.get("data_type", "doc")

        if data_type == "tool_spec":
            tool_name = meta.get("tool_name", "?")
            category  = meta.get("category", "?")
            chunk_type = meta.get("chunk_type", "?")
            header = f"SOURCE: {src} [TOOL: {tool_name} | CATEGORY: {category} | CHUNK: {chunk_type}]"
        else:
            doc_type  = meta.get("doc_type", "general")
            doc_layer = meta.get("layer", 0)
            header = f"SOURCE: {src} [TYPE: {doc_type} | LAYER: {doc_layer}]"

        parts.append(
            f"=== {header} ===\n"
            f"{chunk['content']}\n"
            f"{'=' * 40}"
        )
    return "\n\n".join(parts)


def format_plan_output(plan: QueryPlan) -> str:
    """Format the full QueryPlan output for display."""
    sections = []

    if plan.phase_a.chunks:
        sections.append(
            f"--- PHASE A: BUSINESS CONTEXT ({len(plan.phase_a.chunks)} chunks, "
            f"{plan.phase_a.call_count} call(s)) ---\n"
            + format_context_blocks(plan.phase_a.chunks)
        )

    if plan.phase_b.chunks:
        sections.append(
            f"--- PHASE B: TOOL SPEC ({len(plan.phase_b.chunks)} chunks, "
            f"{plan.phase_b.call_count} call(s)) ---\n"
            + format_context_blocks(plan.phase_b.chunks)
        )

    if not sections:
        return build_no_context_message()

    header = (
        f"RETRIEVAL PLAN: {plan.intent.value} | "
        f"Total calls: {plan.total_calls} | "
        f"Total chunks: {len(plan.all_chunks)}"
    )
    return f"{header}\n{'=' * 60}\n\n" + "\n\n".join(sections)
