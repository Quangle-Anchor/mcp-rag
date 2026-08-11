"""
config.py — Centralized, type-safe configuration via Pydantic Settings v2.

Stack:
  - Google Gemini for embeddings + LLM
  - Pinecone as the vector store
  - MarkdownHeaderTextSplitter chunking with size-900 fallback
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ───────────────────────────────────────────────────────────────────
    app_env: str = Field("development", description="development | production")
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    log_level: str = "INFO"

    # ── Google Gemini ─────────────────────────────────────────────────────────
    google_api_key: str = Field("", description="Google AI API key")
    llm_model: str = "gemini-3.5-flash"
    embedding_model: str = "models/gemini-embedding-2"

    # ── Pinecone ──────────────────────────────────────────────────────────────
    pinecone_api_key: str = Field("", description="Pinecone API key")
    pinecone_index_name: str = "mendix-rag"
    pinecone_namespace: str = "documents"

    # ── Relational DB ─────────────────────────────────────────────────────────
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR / 'data' / 'rag_app.db'}"

    # ── Celery / Redis ────────────────────────────────────────────────────────
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # ── RAG Chunking ──────────────────────────────────────────────────────────
    chunk_size: int = Field(900, ge=64, le=4096)
    chunk_overlap: int = Field(120, ge=0)
    top_k_retrieval: int = Field(8, ge=1, le=20)
    embed_batch_size: int = 50
    llm_rate_limit_sleep: float = 4.0

    # ── Retrieval ─────────────────────────────────────────────────────────────
    max_calls_per_phase: int = 2
    sufficient_chunk_threshold: int = 2

    # ── Document Discovery ────────────────────────────────────────────────────
    # Comma-separated list of directory names to scan for documents.
    # The default matches the namespace name. Auto-discovery searches for
    # folders with these names (case-insensitive).
    docs_dir_names: str = Field(
        "documents",
        description=(
            "Comma-separated folder names to scan for .md/.yaml files. "
            "Default matches the namespace name."
        ),
    )
    # Comma-separated list of extra directories (absolute paths) to scan.
    docs_extra_dirs: str = ""

    # ── Hybrid Search (BM25 + Dense + RRF Fusion) ────────────────────────────
    bm25_weight: float = Field(0.4, ge=0.0, le=1.0, description="BM25 contribution in RRF fusion")
    dense_weight: float = Field(0.6, ge=0.0, le=1.0, description="Dense vector contribution in RRF fusion")
    rrf_k: int = Field(60, ge=1, description="RRF constant (standard=60)")
    keyword_boost: float = Field(10.0, ge=0.0, description="Score boost for exact ID matches in query")
    enable_self_reflection: bool = Field(True, description="Auto-retry with rewritten query if context insufficient")
    max_retrieval_attempts: int = Field(2, ge=1, le=3, description="Max retrieval attempts (1 original + retries)")
    bm25_index_path: str = str(BASE_DIR / "data" / "bm25_index.pkl")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached singleton of Settings."""
    return Settings()  # type: ignore[call-arg]  # pydantic-settings reads from env, not positional args
