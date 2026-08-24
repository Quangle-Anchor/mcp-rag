"""
core/retrieval/bm25_index.py — In-memory BM25 keyword search index.

Provides keyword-based retrieval alongside Qdrant dense vector search.
Built from the same document chunks at sync time, persisted to disk
so it survives server restarts.

Why BM25:
  Dense vectors encode semantics but CANNOT distinguish "BR-02" from "BR-08"
  (they embed to nearly identical vectors). BM25 matches exact tokens and
  finds the chunk that literally contains "BR-02".

Architecture:
  sync → loader chunks → BM25Index.build(chunks) → pickle to disk
  query → BM25Index.search(query) → ranked chunk_ids + scores
  retriever → RRF fusion(dense_results, bm25_results) → final ranking
"""
from __future__ import annotations

import os
import pickle
import re
from pathlib import Path
from typing import Any

from loguru import logger

from config import get_settings

settings = get_settings()

# ── Tokenizer ─────────────────────────────────────────────────────────────────

# Pattern to split on whitespace and punctuation, keeping alphanumeric tokens
_TOKEN_PATTERN = re.compile(r'[a-zA-Z0-9_\-]+')

def _tokenize(text: str) -> list[str]:
    """
    Simple whitespace + punctuation tokenizer.
    Lowercases all tokens. Keeps hyphens in IDs like BR-02.
    """
    return [t.lower() for t in _TOKEN_PATTERN.findall(text)]


# ── BM25 Index Class ─────────────────────────────────────────────────────────

class BM25Index:
    """
    In-memory BM25 index for keyword search over document chunks.

    Usage:
        # At sync time:
        index = BM25Index()
        index.build(chunks)  # chunks = list of LangChain Documents
        index.save()

        # At query time:
        index = BM25Index.load()
        results = index.search("BR-02", top_k=16)
    """

    def __init__(self):
        self._bm25 = None
        self._chunk_contents: list[str] = []
        self._chunk_metadatas: list[dict[str, Any]] = []
        self._corpus_tokens: list[list[str]] = []

    @property
    def is_ready(self) -> bool:
        """True if the index has been built or loaded."""
        return self._bm25 is not None and len(self._chunk_contents) > 0

    def build(self, chunks: list) -> None:
        """
        Build BM25 index from LangChain Document chunks.

        Args:
            chunks: List of LangChain Document objects with .page_content and .metadata
        """
        from rank_bm25 import BM25Okapi

        self._chunk_contents = [c.page_content for c in chunks]
        self._chunk_metadatas = [c.metadata for c in chunks]
        self._corpus_tokens = [_tokenize(text) for text in self._chunk_contents]

        self._bm25 = BM25Okapi(self._corpus_tokens)

        logger.info(
            "[BM25] Index built — {} documents, avg {:.0f} tokens/doc",
            len(self._chunk_contents),
            sum(len(t) for t in self._corpus_tokens) / max(len(self._corpus_tokens), 1),
        )

    def search(self, query: str, top_k: int = 16) -> list[dict[str, Any]]:
        """
        Search BM25 index and return ranked results.

        Returns list of dicts with: content, metadata, bm25_score, rank
        """
        if not self.is_ready:
            logger.warning("[BM25] Index not ready — returning empty results")
            return []

        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        scores = self._bm25.get_scores(query_tokens)

        # Get top_k indices sorted by score descending
        scored_indices = sorted(
            range(len(scores)),
            key=lambda i: scores[i],
            reverse=True,
        )[:top_k]

        results = []
        for rank, idx in enumerate(scored_indices):
            if scores[idx] <= 0:
                continue  # Skip zero-score results
            results.append({
                "content": self._chunk_contents[idx],
                "metadata": self._chunk_metadatas[idx],
                "bm25_score": float(scores[idx]),
                "rank": rank,
            })

        logger.debug(
            "[BM25] query='{}' → {} results (top score={:.3f})",
            query[:60],
            len(results),
            results[0]["bm25_score"] if results else 0.0,
        )
        return results

    def save(self, namespace: str = "default", path: str | None = None) -> None:
        """Persist BM25 index to disk."""
        if path:
            save_path = path
        else:
            base_dir = os.path.dirname(settings.bm25_index_path)
            save_path = os.path.join(base_dir, f"bm25_index_{namespace}.pkl")
            
        os.makedirs(os.path.dirname(save_path), exist_ok=True)

        data = {
            "chunk_contents": self._chunk_contents,
            "chunk_metadatas": self._chunk_metadatas,
            "corpus_tokens": self._corpus_tokens,
        }
        with open(save_path, "wb") as f:
            pickle.dump(data, f)

        logger.info("[BM25] Index saved to {} ({} chunks)", save_path, len(self._chunk_contents))

    @classmethod
    def load(cls, namespace: str = "default", path: str | None = None) -> BM25Index:
        """Load BM25 index from disk. Returns empty index if file not found."""
        if path:
            load_path = path
        else:
            base_dir = os.path.dirname(settings.bm25_index_path)
            load_path = os.path.join(base_dir, f"bm25_index_{namespace}.pkl")
            
        index = cls()

        if not os.path.exists(load_path):
            logger.warning("[BM25] No index file at {} — will use dense search only", load_path)
            return index

        try:
            with open(load_path, "rb") as f:
                data = pickle.load(f)

            index._chunk_contents = data["chunk_contents"]
            index._chunk_metadatas = data["chunk_metadatas"]
            index._corpus_tokens = data["corpus_tokens"]

            from rank_bm25 import BM25Okapi
            index._bm25 = BM25Okapi(index._corpus_tokens)

            logger.info("[BM25] Index loaded from {} ({} chunks)", load_path, len(index._chunk_contents))
        except Exception as exc:
            logger.error("[BM25] Failed to load index: {}", exc)

        return index


# ── Singleton Dictionary ──────────────────────────────────────────────────────

_global_indices: dict[str, BM25Index] = {}


def get_bm25_index(namespace: str = "default") -> BM25Index:
    """Return the global BM25 index (lazy-loaded from disk)."""
    global _global_indices
    if namespace not in _global_indices:
        _global_indices[namespace] = BM25Index.load(namespace=namespace)
    return _global_indices[namespace]


def set_bm25_index(index: BM25Index, namespace: str = "default") -> None:
    """Replace the global BM25 index (called after sync)."""
    global _global_indices
    _global_indices[namespace] = index


def build_and_persist_bm25(chunks: list, namespace: str = "default") -> BM25Index:
    """
    Convenience: build BM25 index from chunks, save to disk, set as global.
    Called after sync completes.
    """
    index = BM25Index()
    index.build(chunks)
    index.save(namespace=namespace)
    set_bm25_index(index, namespace=namespace)
    return index
