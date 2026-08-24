"""
main.py — FastAPI application entry point.

Responsibilities:
  - Application factory (lifespan context)
  - Middleware registration (CORS, timing, metrics)
  - Router mounting
  - NO AI / business logic lives here

Stack:
  - Google Gemini for embeddings + LLM
  - Qdrant as vector store (local Docker)
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from prometheus_fastapi_instrumentator import Instrumentator

from api.chat_router import router as chat_router
from api.code_router import router as code_router
from api.ingest_router import router as ingest_router
from config import get_settings
from db.relational_db import init_db
from models.pydantic_schemas import ErrorDetail, HealthResponse

settings = get_settings()
APP_VERSION = "2.1.0"


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN001
    logger.info("⚡  RAG Production System v{} starting…", APP_VERSION)
    await init_db()
    logger.info("✅  Database initialised | DB: {}", settings.database_url)
    logger.info("✅  Qdrant url='{}' | collection_prefix='{}' | default_namespace='{}'",
                settings.qdrant_url, settings.qdrant_collection_prefix, settings.default_namespace)
    yield
    logger.info("🛑  Shutting down.")


def create_app() -> FastAPI:
    app = FastAPI(
        title="RAG Production System",
        description=(
            "Modular FastAPI backend for Retrieval-Augmented Generation.\n\n"
            "**Stack:** Google Gemini + Qdrant + LangChain\n\n"
            "**Features:** Document chunking, embedding, Qdrant storage & retrieval"
        ),
        version=APP_VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # ── CORS ──────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if settings.app_env == "development" else [],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Request Timing ────────────────────────────────────────────────────────
    @app.middleware("http")
    async def add_process_time_header(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - start) * 1000:.2f}"
        return response

    # ── Prometheus ────────────────────────────────────────────────────────────
    Instrumentator().instrument(app).expose(app, endpoint="/metrics")

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(chat_router,   prefix="/api/v1", tags=["Chat"])
    app.include_router(code_router,   prefix="/api/v1/code", tags=["Code Scan"])
    app.include_router(ingest_router, prefix="/api/v1", tags=["Ingestion"])

    # ── Global Error Handler ──────────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled exception on {}", request.url)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorDetail(code="INTERNAL_ERROR", message="An unexpected error occurred.").model_dump(mode="json"),
        )

    # ── Health Check ──────────────────────────────────────────────────────────
    @app.get("/health", response_model=HealthResponse, tags=["System"])
    async def health_check():
        return HealthResponse(
            version=APP_VERSION,
            qdrant_url=settings.qdrant_url,
            default_namespace=settings.default_namespace,
            llm_model=settings.llm_model,
            embedding_model=settings.embedding_model,
        )

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_env == "development",
        log_level=settings.log_level.lower(),
    )
