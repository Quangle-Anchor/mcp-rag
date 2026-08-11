"""
core/generation/prompt_templates.py — Centralized prompt templates.

Contains reusable prompt templates for the RAG system.
"""
from __future__ import annotations


# ── General RAG Query Rewrite Prompt ──────────────────────────────────────────

CQR_REWRITE_PROMPT = """\
You are a RAG Query Optimizer.

Transform the user's raw query into a structured, high-density retrieval query \
for a Pinecone vector database containing project documentation.

User's raw query: {raw_query}

Rules:
1. Convert loose terms into precise technical descriptions.
2. Include likely document type keywords and metadata terms.
3. Output ONLY the optimized query string — no explanation, no markdown.
"""
