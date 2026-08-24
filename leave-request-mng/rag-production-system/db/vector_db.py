"""
db/vector_db.py — Qdrant vector store wrapper.

Supports configurable namespace via settings or explicit parameter.
Each namespace maps to a separate Qdrant collection for full isolation.
"""
from __future__ import annotations

from typing import Any

from langchain_qdrant import QdrantVectorStore
from loguru import logger
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams

from config import get_settings
from core.ingestion.embeddings import get_embeddings, VECTOR_DIM

settings = get_settings()

# Cache stores by namespace to avoid re-creating them
_store_cache: dict[str, QdrantVectorStore] = {}
_client: QdrantClient | None = None


def _get_client() -> QdrantClient:
    """Return a cached Qdrant client singleton."""
    global _client
    if _client is None:
        _client = QdrantClient(url=settings.qdrant_url)
        logger.info("Qdrant client connected | url='{}'", settings.qdrant_url)
    return _client


def _ensure_collection(collection_name: str) -> None:
    """Create a Qdrant collection if it doesn't already exist."""
    client = _get_client()
    if not client.collection_exists(collection_name):
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(
                size=VECTOR_DIM,
                distance=Distance.COSINE,
            ),
        )
        logger.info(
            "Qdrant collection '{}' created (dim={}, cosine)",
            collection_name, VECTOR_DIM,
        )


def get_vector_store(namespace: str | None = None) -> QdrantVectorStore:
    """
    Return a QdrantVectorStore for the given namespace.

    Instances are cached per-namespace. If namespace is None,
    falls back to settings.default_namespace (default: 'documents').
    """
    ns = namespace or settings.default_namespace
    collection_name = settings.collection_name_for(ns)

    if ns not in _store_cache:
        _ensure_collection(collection_name)
        _store_cache[ns] = QdrantVectorStore(
            client=_get_client(),
            collection_name=collection_name,
            embedding=get_embeddings(),
        )
        logger.info(
            "Qdrant store ready | collection='{}' | namespace='{}'",
            collection_name, ns,
        )
    return _store_cache[ns]


def get_retriever(
    top_k: int | None = None,
    namespace: str | None = None,
    metadata_filter: dict[str, Any] | None = None,
):
    """
    Build a LangChain retriever with optional namespace and metadata filter.

    Args:
        top_k:           Number of chunks to retrieve.
        namespace:       Namespace (maps to Qdrant collection). None = default.
        metadata_filter: Optional metadata filter dict.

    Returns:
        A LangChain VectorStoreRetriever.
    """
    store = get_vector_store(namespace=namespace)
    k = top_k or settings.top_k_retrieval

    search_kwargs: dict = {"k": k}
    if metadata_filter:
        search_kwargs["filter"] = metadata_filter
        logger.debug("Retriever: namespace='{}' | filter={}", namespace, metadata_filter)

    return store.as_retriever(search_kwargs=search_kwargs)


def check_namespace_exists(namespace: str) -> bool:
    """Check if a namespace (Qdrant collection) exists."""
    collection_name = settings.collection_name_for(namespace)
    client = _get_client()
    return client.collection_exists(collection_name)


def clear_namespace(namespace: str) -> None:
    """Delete all points in a namespace's collection (recreate it empty)."""
    collection_name = settings.collection_name_for(namespace)
    client = _get_client()

    if client.collection_exists(collection_name):
        client.delete_collection(collection_name)
        logger.info("Qdrant collection '{}' deleted", collection_name)

    # Recreate empty
    _ensure_collection(collection_name)

    # Invalidate cache
    _store_cache.pop(namespace, None)
    logger.info("Qdrant collection '{}' recreated (empty)", collection_name)
