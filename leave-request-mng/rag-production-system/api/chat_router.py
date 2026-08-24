"""
api/chat_router.py — POST /api/v1/chat

RAG retrieval endpoint.

Flow:
  1. Receive user query
  2. Retrieve chunks from Qdrant
  3. Return context (raw Qdrant chunks, no LLM generation)
"""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from config import get_settings
from core.retrieval.retriever import (
    format_context_blocks,
    retrieve_chunks,
)
from models.pydantic_schemas import ChatRequest, ChatResponse, SourceChunk

router = APIRouter()
settings = get_settings()


@router.post(
    "/chat",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
    summary="RAG retrieval — retrieve context from Qdrant",
    description=(
        "Retrieves relevant document chunks from Qdrant for the given query.\n\n"
        "Returns raw context blocks without LLM generation.\n\n"
        "**Multi-language:** Accepts any language input.\n"
    ),
)
async def chat(request: ChatRequest) -> ChatResponse:
    t0 = time.perf_counter()

    logger.info(
        "Chat | session={} | namespace={} | query='{}'",
        request.session_id,
        request.namespace or "default",
        request.query[:80],
    )

    try:
        chunks, err = await retrieve_chunks(
            query=request.query,
            top_k=request.top_k,
            namespace=request.namespace,
        )

        if err and not chunks:
            latency_ms = round((time.perf_counter() - t0) * 1000, 2)
            return ChatResponse(
                session_id=request.session_id,
                answer=err,
                sources=[],
                latency_ms=latency_ms,
                model_used=settings.llm_model,
                retrieve_calls_used=1,
                context_blocks="",
            )

        sources = [
            SourceChunk(
                chunk_id=c["id"],
                document_name=c["metadata"].get("file_name", c["metadata"].get("source", "unknown")),
                score=c["score"],
                snippet=c["content"][:300],
            )
            for c in chunks
        ]

        context_blocks = format_context_blocks(chunks)
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
        "Chat complete | session={} | chunks={} | latency={}ms",
        request.session_id, len(chunks), latency_ms,
    )

    return ChatResponse(
        session_id=request.session_id,
        answer=answer,
        sources=sources,
        latency_ms=latency_ms,
        model_used=settings.llm_model,
        retrieve_calls_used=1,
        context_blocks=context_blocks,
    )
