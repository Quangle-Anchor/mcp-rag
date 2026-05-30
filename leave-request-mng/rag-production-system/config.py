"""
config.py — Centralized, type-safe configuration via Pydantic Settings v2.
Mirrors the environment and model choices from the working rag_system.py:
  - Google Gemini for embeddings + LLM  (not OpenAI)
  - Pinecone as the vector store        (not Chroma/Qdrant)
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

    # ── Google Gemini (mirrors rag_system.py) ─────────────────────────────────
    google_api_key: str = Field("", description="Google AI API key")
    llm_model: str = "gemini-3.5-flash"
    embedding_model: str = "models/gemini-embedding-2"
    classifier_model: str = "gemini-3.1-flash-lite"  # cheap model for doc classification

    # ── Pinecone (mirrors rag_system.py) ──────────────────────────────────────
    pinecone_api_key: str = Field("", description="Pinecone API key")
    pinecone_index_name: str = "mendix-rag"
    pinecone_namespace: str = "mendix-docs"
    pinecone_tool_namespace: str = "tools"

    # ── Relational DB ─────────────────────────────────────────────────────────
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR / 'data' / 'rag_app.db'}"

    # ── Celery / Redis ────────────────────────────────────────────────────────
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # ── RAG Chunking (mirrors rag_system.py values) ───────────────────────────
    chunk_size: int = Field(900, ge=64, le=4096)
    chunk_overlap: int = Field(120, ge=0)
    top_k_retrieval: int = Field(8, ge=1, le=20)    # k=8 from rag_system.py
    embed_batch_size: int = 50                       # batched tenacity-backed embedding
    llm_rate_limit_sleep: float = 4.0               # sleep between LLM classifier calls

    # ── Retrieval Orchestration ────────────────────────────────────────────────
    max_calls_per_phase: int = 2                     # max Pinecone calls per retrieval phase
    sufficient_chunk_threshold: int = 2              # min chunks to skip retry

    # ── Document Discovery ────────────────────────────────────────────────────
    # Comma-separated list of extra directories to scan for .md/.yaml files.
    # Leave empty to use auto-discovery (same as rag_system.py _find_output_dirs logic).
    docs_extra_dirs: str = ""

    # ── Tool Spec Docs ────────────────────────────────────────────────────────
    # Directory containing Tool Specification .md files (for --sync tool).
    # Each file must contain <!-- tool_start id="N" name="fn" --> blocks.
    tool_docs_dir: str = Field("", description="Path to tool-spec markdown directory")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached singleton of Settings."""
    return Settings()  # type: ignore[call-arg]  # pydantic-settings reads from env, not positional args
