"""
db/vector_db.py — Pinecone vector store wrapper.

Supports configurable namespace via settings or explicit parameter.
"""
from __future__ import annotations

import os
from typing import Any

from langchain_pinecone import PineconeVectorStore
from loguru import logger

from config import get_settings
from core.ingestion.embeddings import get_embeddings

settings = get_settings()

# Cache stores by namespace to avoid re-creating them
_store_cache: dict[str, PineconeVectorStore] = {}


def get_vector_store(namespace: str | None = None) -> PineconeVectorStore:
    """
    Return a PineconeVectorStore for the given namespace.

    Instances are cached per-namespace. If namespace is None,
    falls back to settings.pinecone_namespace (default: 'documents').
    """
    os.environ.setdefault("PINECONE_API_KEY", settings.pinecone_api_key)
    ns = namespace or settings.pinecone_namespace

    if ns not in _store_cache:
        _store_cache[ns] = PineconeVectorStore(
            index_name=settings.pinecone_index_name,
            embedding=get_embeddings(),
            namespace=ns,
        )
        logger.info(
            "Pinecone connected | index='{}' | namespace='{}'",
            settings.pinecone_index_name, ns,
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
        namespace:       Pinecone namespace. None = default from settings.
        metadata_filter: Optional Pinecone metadata filter dict.

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
