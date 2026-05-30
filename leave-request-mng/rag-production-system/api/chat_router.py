"""
api/chat_router.py — POST /api/v1/chat

Dual-Namespace Agentic RAG endpoint.

Flow:
  1. Receive user prompt (any language)
  2. Auto-detect intent (biz_only / tool_only / biz_then_tool)
  3. Phase A: Retrieve business context from mendix-docs
  4. Phase B: Retrieve tool specs from mx-tools-agent-microflow
  5. Return merged context (raw Pinecone chunks, no LLM generation)

Each phase: 1 call first → evaluate → IF insufficient → retry (max 2 per phase).
Total max calls = 4.

GOLDEN RULES (from ai_instruction.instructions.md):
  - Queries are ALWAYS generated in English regardless of input language.
  - Filters are auto-generated based on intent + context analysis.
  - Guardrails are enforced per-phase (empty layer, token guardrail).
"""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from config import get_settings
from core.retrieval.retriever import (
    format_plan_output,
    orchestrate_retrieval,
)
from core.retrieval.query_optimizer import (
    build_phase_guardrail_message,
)
from models.pydantic_schemas import ChatRequest, ChatResponse, SourceChunk

router = APIRouter()
settings = get_settings()


@router.post(
    "/chat",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Dual-namespace RAG retrieval (fully automatic)",
    description=(
        "Fully automatic 2-phase retrieval endpoint.\n\n"
        "**Phase A:** Business context from mendix-docs namespace.\n"
        "**Phase B:** Tool specs from mx-tools-agent-microflow namespace.\n\n"
        "Each phase: Call #1 (targeted) → evaluate → Call #2 (broadened) if needed.\n"
        "Max 4 total calls (2 per phase).\n\n"
        "**Intent Detection:**\n"
        "- `biz_only`: Only queries mendix-docs.\n"
        "- `tool_only`: Only queries tool specs.\n"
        "- `biz_then_tool`: Queries both (most common for code generation tasks).\n\n"
        "**Multi-language:** Accepts any language input. Queries are always generated in English.\n"
    ),
)
async def chat(request: ChatRequest) -> ChatResponse:
    t0 = time.perf_counter()
    layer_str = request.layer.value if request.layer else None

    logger.info(
        "Chat | session={} | layer={} | query='{}'",
        request.session_id,
        layer_str or "auto",
        request.query[:80],
    )

    try:
        # ── Orchestrate 2-phase retrieval ─────────────────────────────────────
        plan = await orchestrate_retrieval(
            query=request.query,
            top_k=request.top_k,
            layer=layer_str,
        )

        # ── Check for Phase A guardrail ───────────────────────────────────────
        if plan.phase_a.guardrail_msg:
            logger.warning(
                "[GUARDRAIL] Phase A | session={} | msg='{}'",
                request.session_id, plan.phase_a.guardrail_msg[:80],
            )
            return _guardrail_response(
                request, plan.phase_a.guardrail_msg, t0, plan.total_calls,
            )

        # ── Check if we got any context at all ────────────────────────────────
        all_chunks = plan.all_chunks
        if not all_chunks:
            guardrail = build_phase_guardrail_message(plan)
            return _guardrail_response(request, guardrail, t0, plan.total_calls)

        # ── Build response ────────────────────────────────────────────────────
        sources = [
            SourceChunk(
                chunk_id=c["id"],
                document_name=c["metadata"].get(
                    "file_name", c["metadata"].get("source", "unknown")
                ),
                layer=c["metadata"].get("layer"),
                doc_type=c["metadata"].get("doc_type", c["metadata"].get("data_type", "general")),
                score=c["score"],
                snippet=c["content"][:300],
            )
            for c in all_chunks
        ]

        context_blocks = format_plan_output(plan)

        # Raw Pinecone context — no Gemini generation
        answer = context_blocks

    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except Exception as exc:
        logger.exception("Unexpected error in /chat")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RAG pipeline failed. Check logs for details.",
        ) from exc

    latency_ms = round((time.perf_counter() - t0) * 1000, 2)
    logger.info(
        "Chat complete | session={} | intent={} | chunks={} (A:{} B:{}) | "
        "calls={} (A:{} B:{}) | latency={}ms",
        request.session_id, plan.intent.value,
        len(all_chunks), len(plan.phase_a.chunks), len(plan.phase_b.chunks),
        plan.total_calls, plan.phase_a.call_count, plan.phase_b.call_count,
        latency_ms,
    )

    return ChatResponse(
        session_id=request.session_id,
        answer=answer,
        sources=sources,
        latency_ms=latency_ms,
        model_used=settings.llm_model,
        retrieve_calls_used=plan.total_calls,
        context_blocks=context_blocks,
    )


def _guardrail_response(
    request: ChatRequest,
    guardrail_msg: str,
    t0: float,
    calls_used: int,
) -> ChatResponse:
    """Helper: return guardrail message without generating answer."""
    return ChatResponse(
        session_id=request.session_id,
        answer=guardrail_msg,
        sources=[],
        latency_ms=round((time.perf_counter() - t0) * 1000, 2),
        model_used=settings.llm_model,
        retrieve_calls_used=calls_used,
        context_blocks="",
    )
