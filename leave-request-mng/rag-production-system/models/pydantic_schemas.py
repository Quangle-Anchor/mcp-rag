"""
models/pydantic_schemas.py — Pydantic v2 data contracts.

Updated to fully reflect:
  - ai_instruction.instructions.md Phase 1-6 behaviour
  - rag_system.py retrieve_mendix_context() / sync_mendix_context() interface
  - QOL Pipeline metadata (retrieve_calls_used, context_blocks)
  - Mendix 5-layer architecture enum
  - Error taxonomy response format (Phase 4)
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator


# ── Enums ─────────────────────────────────────────────────────────────────────

class MendixLayer(str, Enum):
    """5-layer Mendix architecture model — mirrors LAYER_MAP từ rag_system.py."""
    foundation    = "foundation"     # Layer 1
    api           = "api"            # Layer 2
    behavior      = "behavior"       # Layer 3
    ui            = "ui"             # Layer 4
    cross_cutting = "cross-cutting"  # Layer 5


class IngestionStatus(str, Enum):
    queued     = "queued"
    processing = "processing"
    completed  = "completed"
    failed     = "failed"


class SyncType(str, Enum):
    """
    Discriminates between the two sync pipelines:
      doc  — requirement documents (5-layer Mendix architecture, existing pipeline)
      tool — Tool Specification markdown files (3-layer tool_loader pipeline)
    """
    doc  = "doc"
    tool = "tool"


class MendixErrorCategory(str, Enum):
    """Phase 4 — Error Taxonomy từ ai_instruction.instructions.md."""
    sdk_syntax      = "SDK_SYNTAX"
    mapping_error   = "MAPPING_ERROR"
    data_type       = "DATA_TYPE_MISMATCH"
    flow_void       = "FLOW_RETURN_VOID"
    invalid_xpath   = "INVALID_XPATH"
    widget_error    = "WIDGET_ERROR"
    security_error  = "SECURITY_ERROR"


# ── Shared Base ───────────────────────────────────────────────────────────────

class TimestampMixin(BaseModel):
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── Chat Schemas ──────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    """Một lượt hội thoại."""
    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1, max_length=8192)


class ChatRequest(BaseModel):
    """
    Payload cho POST /api/v1/chat.

    Hỗ trợ:
      - query: câu hỏi (tiếng Việt hoặc English đều được — CQR sẽ normalize)
      - layer: filter theo layer Mendix (optional — sẽ auto-detect nếu không chỉ định)
      - top_k: số chunk truy vấn (default 8 từ rag_system.py)
    """
    session_id: UUID = Field(default_factory=uuid4)
    query: str = Field(
        ..., min_length=1, max_length=2048,
        description="User question — tiếng Việt hoặc English đều được. CQR sẽ tự optimize.",
    )
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)
    top_k: int = Field(
        8, ge=1, le=20,
        description="Số chunks truy vấn (default 8 — từ rag_system.py k=8)",
    )
    layer: MendixLayer | None = Field(
        None,
        description=(
            "Filter theo Mendix layer. Nếu không chỉ định, system tự detect từ query.\n"
            "Values: foundation | api | behavior | ui | cross-cutting"
        ),
    )
    stream: bool = Field(False, description="SSE streaming (future)")

    @field_validator("query")
    @classmethod
    def strip_query(cls, v: str) -> str:
        return v.strip()

    @field_validator("layer", mode="before")
    @classmethod
    def normalise_layer(cls, v: str | None) -> str | None:
        return v.strip().lower() if isinstance(v, str) else v


class SourceChunk(BaseModel):
    """
    Một chunk được retrieve từ Pinecone.
    Mirrors format trong retrieve_mendix_context() của rag_system.py.
    """
    chunk_id: str
    document_name: str
    layer: int | None = Field(None, description="Mendix architecture layer (1-5)")
    doc_type: str = Field("general", description="Document type từ classifier")
    score: float = Field(..., ge=0.0, le=1.0)
    snippet: str = Field(..., description="First 300 chars của chunk content")


class ChatResponse(BaseModel):
    """
    Response từ POST /api/v1/chat.

    Bao gồm QOL metadata:
      - retrieve_calls_used: số lần gọi Pinecone (max 2 per request)
      - context_blocks: raw ╔══ SOURCE ══╗ blocks như rag_system.py output
    """
    session_id: UUID
    answer: str = Field(description="LLM answer hoặc guardrail message")
    sources: list[SourceChunk] = Field(default_factory=list)
    latency_ms: float
    model_used: str
    retrieve_calls_used: int = Field(
        0, ge=0, le=4,
        description="Total Pinecone calls (max 2 per phase × 2 phases = 4)",
    )
    context_blocks: str = Field(
        "", description="Formatted ╔══ SOURCE ══╗ blocks như rag_system.py"
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── Ingestion Schemas ─────────────────────────────────────────────────────────

class DocumentUploadResponse(TimestampMixin):
    """Trả về ngay sau khi file được chấp nhận để ingest."""
    task_id: str
    filename: str
    status: IngestionStatus = IngestionStatus.queued
    message: str = "Document accepted and queued for ingestion."


class IngestionStatusResponse(TimestampMixin):
    """Trạng thái của background task."""
    task_id: str
    status: IngestionStatus
    filename: str | None = None
    chunks_created: int | None = None
    error: str | None = None


class SyncResponse(BaseModel):
    """
    Trả về bởi POST /api/v1/sync.
    Mirrors sync_mendix_context() return value từ rag_system.py.

    [ADMIN — USER CONSENT REQUIRED]
    Endpoint này yêu cầu confirmed=true trong body để tránh xóa nhầm Pinecone namespace.
    """
    task_id: str
    status: str = "queued"
    message: str


# ── Error Taxonomy (Phase 4) ──────────────────────────────────────────────────

class ErrorTaxonomyResponse(BaseModel):
    """
    Phase 4 — Structured error response khi user báo cáo lỗi code Mendix SDK.
    """
    category: MendixErrorCategory
    error_code: str
    description: str
    cot_rectification: str = Field(
        description="Chain-of-Thought guided rectification steps"
    )
    raw_error: str | None = None


# ── Health / Generic ──────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    pinecone_index: str
    pinecone_namespace: str
    llm_model: str
    embedding_model: str
    max_retrieve_calls: int = 2   # HARD LIMIT từ ai_instruction.instructions.md
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None
