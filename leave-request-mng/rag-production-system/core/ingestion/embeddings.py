"""
core/ingestion/embeddings.py — Batched, tenacity-backed Gemini embeddings.

Refactored from the original 1-by-1 + hardcoded sleep implementation.

Key improvements
────────────────
  OLD: process texts one-by-one, sleep(1.5s) between every call
       → N texts × 1.5 s = very slow, wastes RPM budget even when no errors

  NEW: send batches of 50 texts per API call, NO sleep unless a 429 arrives
       → only pauses when the API actually complains, not preventively
       → for a typical 200-chunk sync: ~4 calls instead of 200

Architecture
────────────
  embed_documents()
    └── _embed_batch_with_retry()   ← one call per batch of ≤ BATCH_SIZE texts
          └── @retry (tenacity)     ← exponential back-off ONLY on 429 / rate errors
                └── super().embed_documents(batch)   ← real Gemini API call
                      └── result[:1024]              ← Pinecone dimensionality cap

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
from functools import lru_cache
from typing import Any

from langchain_google_genai import GoogleGenerativeAIEmbeddings
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

# Pinecone index dimensionality — all vectors MUST be truncated to this.
PINECONE_DIM: int = 1024


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
        5,
        type(exc).__name__ if exc else "unknown",
        float(wait) if isinstance(wait, (int, float)) else 0,
    )


# ── Core class ────────────────────────────────────────────────────────────────

class CustomGeminiEmbeddings(GoogleGenerativeAIEmbeddings):
    """
    Batched, rate-resilient wrapper around GoogleGenerativeAIEmbeddings.

    Behaviour
    ---------
    - Batches texts (default: 50 per request) → far fewer API calls than 1-by-1.
    - Zero artificial sleep — the system runs at full API speed.
    - Automatic exponential back-off via tenacity ONLY when a 429 is received.
    - All vectors truncated to PINECONE_DIM (1024) dimensions.
    """

    def embed_documents(  # type: ignore[override]
        self,
        texts: list[str],
        *,
        batch_size: int = 0,
        task_type: str | None = None,
        titles: list[str] | None = None,
        output_dimensionality: int | None = None,
    ) -> list[list[float]]:
        """
        Embed a list of texts using batched Gemini API calls.

        Splits `texts` into chunks of BATCH_SIZE and calls the parent
        embed_documents() once per chunk. Each batch is wrapped with
        tenacity retry logic — NO sleep unless a 429 error is encountered.
        """
        if not texts:
            return []

        all_vectors: list[list[float]] = []
        total_batches = (len(texts) + BATCH_SIZE - 1) // BATCH_SIZE

        for batch_idx, start in enumerate(range(0, len(texts), BATCH_SIZE)):
            batch = texts[start: start + BATCH_SIZE]
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
            len(texts), len(all_vectors), PINECONE_DIM,
        )
        return all_vectors

    @retry(
        retry=retry_if_exception(is_rate_limit_error),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(5),
        before_sleep=_log_retry,
        reraise=True,
    )
    def _embed_batch_with_retry(self, batch: list[str]) -> list[list[float]]:
        """
        Single batched API call with tenacity retry on 429.

        The @retry decorator pauses and retries ONLY when is_rate_limit_error()
        returns True. Auth errors, network errors etc. propagate immediately.
        """
        raw: list[list[float]] = super().embed_documents(batch)  # type: ignore[arg-type]
        return [v[:PINECONE_DIM] for v in raw]

    @retry(
        retry=retry_if_exception(is_rate_limit_error),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(5),
        before_sleep=_log_retry,
        reraise=True,
    )
    def embed_query(  # type: ignore[override]
        self,
        text: str,
        *,
        task_type: str | None = None,
        title: str | None = None,
        output_dimensionality: int | None = None,
    ) -> list[float]:
        """
        Embed a single query string with tenacity retry on 429.
        Used by retrieval (query-time), not during bulk ingestion.
        """
        result: list[float] = super().embed_query(text)  # type: ignore[arg-type]
        return result[:PINECONE_DIM]


# ── Factory ───────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_embeddings() -> CustomGeminiEmbeddings:
    """
    Return a cached singleton CustomGeminiEmbeddings instance.
    Sets GOOGLE_API_KEY env var before init (langchain reads it from env).
    """
    if settings.google_api_key:
        os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)
    return CustomGeminiEmbeddings(model=settings.embedding_model)
