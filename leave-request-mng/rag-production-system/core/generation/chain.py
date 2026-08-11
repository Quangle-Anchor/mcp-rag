"""
core/generation/chain.py — LLM generation with Gemini.

General-purpose RAG generation chain.
Uses Google Gemini (ChatGoogleGenerativeAI).
"""
from __future__ import annotations

from functools import lru_cache

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_google_genai import ChatGoogleGenerativeAI
from loguru import logger

from config import get_settings
from models.pydantic_schemas import ChatMessage

settings = get_settings()


# ── System Prompt ─────────────────────────────────────────────────────────────

RAG_SYSTEM_PROMPT = """\
You are a knowledgeable AI assistant. Your primary responsibility is to answer \
questions based ONLY on the precise project context provided below.

═══════════════════════════════════════════
RETRIEVED PROJECT CONTEXT (GROUNDING SOURCE):
═══════════════════════════════════════════
{context}
═══════════════════════════════════════════

# CRITICAL RULES:

## Rule 1 — GROUND TRUTH ONLY
Answer ONLY using the context above. If the answer is NOT in the context, respond:
"I don't have enough information to answer that — please ensure documents have been synced."
NEVER fabricate information that is not present in the retrieved context.

## Rule 2 — OUTPUT FORMAT
Your response should be clear, structured, and directly address the user's question.
Cite specific documents or sections from the context when relevant.
"""


# ── LLM Factory ───────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_llm() -> ChatGoogleGenerativeAI:
    """Return a cached Gemini LLM instance."""
    return ChatGoogleGenerativeAI(
        model=settings.llm_model,
        google_api_key=settings.google_api_key,
        temperature=0.2,
        max_output_tokens=4096,
    )


# ── Prompt Builder ────────────────────────────────────────────────────────────

def build_rag_prompt(context: str) -> ChatPromptTemplate:
    return ChatPromptTemplate.from_messages(
        [
            ("system", RAG_SYSTEM_PROMPT),
            MessagesPlaceholder(variable_name="history"),
            ("human", "{query}"),
        ]
    ).partial(context=context)


# ── Main Entrypoint ───────────────────────────────────────────────────────────

async def generate_answer(
    query: str,
    context_chunks: list[str],
    history: list[ChatMessage],
) -> str:
    """
    Invoke the Gemini RAG chain.

    Args:
        query:          User question.
        context_chunks: Retrieved document chunk texts.
        history:        Prior conversation turns.

    Returns:
        LLM answer grounded in the provided context.
    """
    if context_chunks:
        context = "\n\n---\n\n".join(context_chunks)
    else:
        context = "⚠️ No context retrieved. Cannot generate grounded output."

    lc_history = []
    for msg in history:
        if msg.role == "user":
            lc_history.append(HumanMessage(content=msg.content))
        elif msg.role == "assistant":
            lc_history.append(AIMessage(content=msg.content))

    chain = build_rag_prompt(context) | get_llm() | StrOutputParser()

    logger.debug(
        "Invoking Gemini | model={} | chunks={} | history_turns={}",
        settings.llm_model, len(context_chunks), len(lc_history),
    )
    answer: str = await chain.ainvoke({"query": query, "history": lc_history})
    return answer
