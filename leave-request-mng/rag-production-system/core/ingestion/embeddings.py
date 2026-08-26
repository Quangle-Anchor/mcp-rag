"""
core/ingestion/embeddings.py — Batched, tenacity-backed Gemini embeddings.

Refactored from the original 1-by-1 + hardcoded sleep implementation.
Vector store: Qdrant (local Docker).

Key improvements
────────────────
  OLD: process texts one-by-one, sleep(1.5s) between every call
       → N texts × 1.5 s = very slow, wastes RPM budget even when no errors

  NEW: send batches of 50 texts per API call, NO sleep unless a 429 arrives
       → only pauses when the API actually complains, not preventively
       → for a typical 200-chunk sync: ~4 calls instead of 200

  Vector dimension: 3072 (full Gemini gemini-embedding-2 native output, no truncation).

Architecture
────────────
  embed_documents()
    └── _embed_batch_with_retry()   ← one call per batch of ≤ BATCH_SIZE texts
          └── @retry (tenacity)     ← exponential back-off ONLY on 429 / rate errors
                └── super().embed_documents(batch)   ← real Gemini API call
                      └── result[:VECTOR_DIM]        ← Qdrant dimensionality

  embed_query()
    └── @retry (tenacity)           ← same back-off for single-text lookups
          └── super().embed_query(text)[:1024]

Tenacity policy
───────────────
  - wait_exponential(multiplier=1, min=4, max=60)  → 4 s, 8 s, 16 s … up to 60 s
  - stop_after_attempt(5)                          → give up after 5 total attempts
  - retry_if_exception(is_rate_limit_error)        → only retry 429 / quota errors
  - before_sleep_log(logger, WARNING)              → prints which batch failed + wait time
"""
from __future__ import annotations

import os
import warnings
from functools import lru_cache
from typing import Any

# Suppress the deprecation warning for clean logs
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    import google.generativeai as genai

from langchain_core.embeddings import Embeddings
from loguru import logger
from tenacity import (
    RetryCallState,
    before_sleep_log,
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from config import get_settings

settings = get_settings()

# ── Constants ─────────────────────────────────────────────────────────────────

# Number of texts sent per single Gemini API call.
# Gemini embedding API accepts up to 100 texts/call; 50 is a safe ceiling.
BATCH_SIZE: int = 50

# Vector dimensionality — Gemini gemini-embedding-2 produces 3072-dim vectors.
# Using full dimensions for maximum semantic accuracy (quality-first).
VECTOR_DIM: int = 3072


# ── Tenacity helpers ──────────────────────────────────────────────────────────

def is_rate_limit_error(exc: BaseException) -> bool:
    """
    Return True only for 429 / quota-exceeded errors.
    Other errors (auth, network) propagate immediately without retry.
    """
    msg = str(exc).lower()
    return (
        "429" in msg
        or "quota" in msg
        or "rate limit" in msg
        or "resource exhausted" in msg
        or "too many requests" in msg
    )


def _log_retry(retry_state: RetryCallState) -> None:
    """Custom before-sleep logger — prints batch index and wait duration."""
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    wait = getattr(retry_state.next_action, "sleep", "?")
    logger.warning(
        "[EMBED RETRY] attempt {}/{} — {} — waiting {:.1f}s before next try…",
        retry_state.attempt_number,
        6,
        type(exc).__name__ if exc else "unknown",
        float(wait) if isinstance(wait, (int, float)) else 0,
    )


# ── Core class ────────────────────────────────────────────────────────────────

class CustomGeminiEmbeddings(Embeddings):
    """
    Batched, rate-resilient Embeddings implementation using Google Gemini API.

    Behaviour
    ---------
    - Batches texts (default: 50 per request) → far fewer API calls than 1-by-1.
    - Uses direct Google Generative AI client (bypassing httpx socket hanging issues).
    - Automatic exponential back-off via tenacity ONLY when a 429 is received.
    - All vectors normalized to VECTOR_DIM (3072) dimensions.
    """

    def __init__(self, model: str | None = None) -> None:
        self.model = model or settings.embedding_model
        if settings.google_api_key:
            genai.configure(api_key=settings.google_api_key)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """
        Embed a list of texts using batched Gemini API calls.

        Splits `texts` into chunks of BATCH_SIZE and calls the API once per chunk.
        Each batch is wrapped with tenacity retry logic on 429 errors.
        """
        if not texts:
            return []

        all_vectors: list[list[float]] = []
        total_batches = (len(texts) + BATCH_SIZE - 1) // BATCH_SIZE

        for batch_idx, start in enumerate(range(0, len(texts), BATCH_SIZE)):
            if batch_idx > 0 and settings.llm_rate_limit_sleep > 0:
                import time
                logger.debug(
                    "[EMBED] Pacing delay: sleeping {:.1f}s between batches...",
                    settings.llm_rate_limit_sleep,
                )
                time.sleep(settings.llm_rate_limit_sleep)

            batch = texts[start : start + BATCH_SIZE]
            logger.debug(
                "[EMBED] Batch {}/{} — {} text(s) | chars: {}",
                batch_idx + 1,
                total_batches,
                len(batch),
                sum(len(t) for t in batch),
            )

            batch_vectors = self._embed_batch_with_retry(batch)
            all_vectors.extend(batch_vectors)

        logger.info(
            "[EMBED] embed_documents complete — {} texts → {} vectors ({}D each)",
            len(texts),
            len(all_vectors),
            VECTOR_DIM,
        )
        return all_vectors

    @retry(
        retry=retry_if_exception(is_rate_limit_error),
        wait=wait_exponential(multiplier=2, min=16, max=60),
        stop=stop_after_attempt(6),
        before_sleep=_log_retry,
        reraise=True,
    )
    def _embed_batch_with_retry(self, batch: list[str]) -> list[list[float]]:
        """
        Single batched API call with tenacity retry on 429.
        """
        response = genai.embed_content(
            model=self.model,
            content=batch,
            task_type="retrieval_document",
        )
        raw = response.get("embedding", [])
        if raw and not isinstance(raw[0], list):
            raw = [raw]
        return [v[:VECTOR_DIM] for v in raw]

    @retry(
        retry=retry_if_exception(is_rate_limit_error),
        wait=wait_exponential(multiplier=2, min=16, max=60),
        stop=stop_after_attempt(6),
        before_sleep=_log_retry,
        reraise=True,
    )
    def embed_query(self, text: str) -> list[float]:
        """
        Embed a single query string with tenacity retry on 429.
        Used by retrieval (query-time), not during bulk ingestion.
        """
        response = genai.embed_content(
            model=self.model,
            content=text,
            task_type="retrieval_query",
        )
        raw = response.get("embedding", [])
        return raw[:VECTOR_DIM]


# ── Factory ───────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_embeddings() -> CustomGeminiEmbeddings:
    """
    Return a cached singleton CustomGeminiEmbeddings instance.
    Sets GOOGLE_API_KEY env var before init.
    """
    if settings.google_api_key:
        os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)
    return CustomGeminiEmbeddings(model=settings.embedding_model)

