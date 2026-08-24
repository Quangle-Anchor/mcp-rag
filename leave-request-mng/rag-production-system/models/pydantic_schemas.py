"""
models/pydantic_schemas.py — Pydantic v2 data contracts.

Defines request/response schemas for the RAG API endpoints.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator


# ── Enums ─────────────────────────────────────────────────────────────────────

class IngestionStatus(str, Enum):
    queued     = "queued"
    processing = "processing"
    completed  = "completed"
    failed     = "failed"


# ── Shared Base ───────────────────────────────────────────────────────────────

class TimestampMixin(BaseModel):
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── Chat Schemas ──────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    """A single conversation turn."""
    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1, max_length=8192)


class ChatRequest(BaseModel):
    """
    Payload for POST /api/v1/chat.

    Supports multi-language queries — the system handles normalization.
    """
    session_id: UUID = Field(default_factory=uuid4)
    query: str = Field(
        ..., min_length=1, max_length=2048,
        description="User question for RAG retrieval.",
    )
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)
    top_k: int = Field(
        8, ge=1, le=20,
        description="Number of chunks to retrieve (default 8).",
    )
    namespace: str | None = Field(
        None,
        description="Namespace to query. Defaults to settings value.",
    )
    stream: bool = Field(False, description="SSE streaming (future)")

    @field_validator("query")
    @classmethod
    def strip_query(cls, v: str) -> str:
        return v.strip()


class SourceChunk(BaseModel):
    """A chunk retrieved from vector store."""
    chunk_id: str
    document_name: str
    score: float = Field(..., ge=0.0)
    snippet: str = Field(..., description="First 300 chars of chunk content")


class ChatResponse(BaseModel):
    """Response from POST /api/v1/chat."""
    session_id: UUID
    answer: str = Field(description="Retrieved context or guardrail message")
    sources: list[SourceChunk] = Field(default_factory=list)
    latency_ms: float
    model_used: str
    retrieve_calls_used: int = Field(0, ge=0, description="Number of retrieval calls made")
    context_blocks: str = Field("", description="Formatted source blocks")
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── Ingestion Schemas ─────────────────────────────────────────────────────────

class DocumentUploadResponse(TimestampMixin):
    """Returned immediately after a file is accepted for ingestion."""
    task_id: str
    filename: str
    status: IngestionStatus = IngestionStatus.queued
    message: str = "Document accepted and queued for ingestion."


class IngestionStatusResponse(TimestampMixin):
    """Status of a background ingestion task."""
    task_id: str
    status: IngestionStatus
    filename: str | None = None
    chunks_created: int | None = None
    error: str | None = None


class SyncResponse(BaseModel):
    """Returned by POST /api/v1/sync."""
    task_id: str
    status: str = "queued"
    message: str


# ── Health / Generic ──────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    qdrant_url: str
    default_namespace: str
    llm_model: str
    embedding_model: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


# ── Code Scan Schemas ─────────────────────────────────────────────────────────

class CodeScanRequest(BaseModel):
    """Payload for POST /api/v1/code/scan."""
    folder_name: str = Field(
        ..., min_length=1, max_length=256,
        description="Name of the sibling folder to scan (e.g., 'detect-error').",
    )
    namespace: str | None = Field(
        None,
        description="Namespace. Defaults to folder_name if not provided.",
    )

    @field_validator("folder_name")
    @classmethod
    def sanitize_folder_name(cls, v: str) -> str:
        v = v.strip().strip("/").strip("\\")
        if ".." in v or "/" in v or "\\" in v:
            raise ValueError("folder_name must be a simple directory name, no path traversal.")
        return v


class CodeScanResponse(BaseModel):
    """Response from POST /api/v1/code/scan."""
    folder_name: str
    namespace: str
    files_scanned: int
    chunks_created: int
    languages: list[str] = Field(default_factory=list)
    message: str

