"""
db/relational_db.py — Async SQLAlchemy setup for chat history & document metadata.

Fixes applied:
  - relationship type annotations use Mapped[] (SQLAlchemy 2.x proper typing)
  - get_db return type corrected to AsyncGenerator[AsyncSession, None]
"""
from __future__ import annotations

from typing import AsyncGenerator

from loguru import logger
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, relationship

from config import get_settings

settings = get_settings()

# ── Engine & Session Factory ──────────────────────────────────────────────────

engine = create_async_engine(
    settings.database_url,
    echo=settings.app_env == "development",
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


# ── ORM Models ────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String(36), primary_key=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Use Mapped[] annotation — correct SQLAlchemy 2.x pattern (no false type error)
    messages: Mapped[list["ChatMessageRecord"]] = relationship(  # type: ignore[assignment]
        "ChatMessageRecord", back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessageRecord(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String(16), nullable=False)   # user | assistant | system
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    session: Mapped["ChatSession"] = relationship(  # type: ignore[assignment]
        "ChatSession", back_populates="messages"
    )


class DocumentRecord(Base):
    __tablename__ = "document_records"

    id = Column(String(36), primary_key=True)
    filename = Column(String(512), nullable=False)
    status = Column(String(32), default="queued")
    chunks_created = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ── Lifecycle ─────────────────────────────────────────────────────────────────

async def init_db() -> None:
    """Create all tables if they do not exist (idempotent)."""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Relational DB tables verified/created")
    except Exception as exc:
        logger.warning("Relational DB init notice: {}", exc)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
