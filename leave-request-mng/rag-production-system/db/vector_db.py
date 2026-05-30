"""
db/vector_db.py — Pinecone vector store wrapper with multi-namespace support.

Supports dynamic namespace selection so the retriever can query
different namespaces (e.g., mendix-docs for business context,
mx-tools-agent-microflow for tool specs) within the same index.
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
    falls back to settings.pinecone_namespace (default: mendix-docs).
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
        namespace:       Pinecone namespace to query. None = default (mendix-docs).
        metadata_filter: Dynamic Pinecone metadata filter dict, e.g.:
                         {"tool_name": {"$in": ["create_microflow"]}, "data_type": "tool_spec"}
                         {"layer": 3}

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
"""
Description: Upgraded from singleton cache to multi-namespace dict cache.
get_retriever() now accepts namespace + dynamic metadata_filter instead of just layer_filter.
"""
