"""
core/generation/chain.py — LLM generation với Gemini + Mendix coding rules.

Implements Phase 3 từ ai_instruction.instructions.md:
  - Mendix 5-layer architecture awareness trong system prompt
  - Naming convention enforcement: VAL_, ACT_, SUB_, WFA_
  - Enum Guard instruction
  - Error-aware refinement instruction
  - Phase 4: Error Taxonomy guidance (7 categories)
  - Phase 5: Conflict resolution awareness (CR_ > others; YAML > MD)
  - Phase 6: STROT Schema Introspection instruction

Sử dụng Google Gemini (ChatGoogleGenerativeAI) khớp với rag_system.py.
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


# ── System Prompt (embeds ai_instruction.instructions.md Phase 3-6) ───────────

RAG_SYSTEM_PROMPT = """\
You are an Expert Mendix AI Developer and Architect. Your primary responsibility is to \
design and write robust TypeScript code using the Mendix Model SDK based on ONLY the \
precise project context provided below.

═══════════════════════════════════════════
RETRIEVED PROJECT CONTEXT (GROUNDING SOURCE):
═══════════════════════════════════════════
{context}
═══════════════════════════════════════════

# CRITICAL RULES — NON-NEGOTIABLE:

## Rule 1 — GROUND TRUTH ONLY
Answer ONLY using the context above. If the answer is NOT in the context, respond:
"I don't have enough information to answer that — please ensure sync has been run."
NEVER fabricate entity names, attribute names, enum values, or microflow logic.

## Rule 2 — MENDIX CODING STANDARDS (Phase 3)
When generating TypeScript Mendix Model SDK code:
- **Naming Conventions (STRICT):**
  - `VAL_` prefix → Validation microflows (must return Boolean)
  - `ACT_` prefix → Action microflows (data manipulation, commit, rollback)
  - `SUB_` prefix → Sub-microflows (reusable logic blocks)
  - `WFA_` prefix → Workflow / Approval microflows (status transitions)
- **Enum Guard:** NEVER use raw strings for Enum fields. Always verify exact Enum \
values from the retrieved context.
- **Error-Aware Refinement:** For multi-step data manipulation, always write explicit \
validation blocks with intermediate variables for null checks and edge cases.
- **STROT Schema Introspection (Phase 6):** BEFORE creating any new Entity or Attribute, \
verify that it does NOT already exist in the retrieved schema. Reuse existing structures.

## Rule 3 — DOCUMENT CONFLICT RESOLUTION (Phase 5)
When retrieved context contains contradictions:
1. Files with prefix `CR_`, `Log_`, `update_` → HIGHEST PRIORITY (most recent changes)
2. `.yaml` files → Source of Truth for schema/structure (overrides `.md` descriptions)
3. Lower layer data → overrides upper layer descriptions when conflicting

## Rule 4 — OUTPUT FORMAT
Your response MUST be structured as:
1. **Query Log:** State the English query used for retrieval.
2. **Code / Answer:** Clean, valid TypeScript (Mendix Model SDK) or direct answer.
3. **Traceability Note:** 2-sentence summary how the output satisfies the business logic.

## Rule 5 — ERROR TAXONOMY (Phase 4)
If the user reports a code error, categorize it immediately:
| Category | Code | Action |
|----------|------|--------|
| Syntax & API | [SDK_SYNTAX] | Fix missing createIn(), missing await, wrong modifiers |
| Schema Link | [MAPPING_ERROR] | Re-verify entity/attribute/association names from context |
| Data Type | [DATA_TYPE_MISMATCH] | Fix Enum assignment, use correct Mendix data types |
| Microflow Logic | [FLOW_RETURN_VOID] | Fix return event type (VAL_ must return Boolean) |
| Expressions | [INVALID_XPATH] | Fix XPath syntax: [Module.Entity_Assoc/Module.Entity/Attr = $Var] |
| UI Components | [WIDGET_ERROR] | Fix DataView/ListView source and nested widget type matching |
| Security | [SECURITY_ERROR] | Assign Module Roles to entities, microflows, and pages |
"""


# ── LLM Factory ───────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_llm() -> ChatGoogleGenerativeAI:
    """Return a cached Gemini LLM instance."""
    return ChatGoogleGenerativeAI(
        model=settings.llm_model,
        google_api_key=settings.google_api_key,
        temperature=0.2,
        max_output_tokens=4096,   # Tăng lên để đủ chứa TypeScript code
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
    Invoke the Gemini RAG chain với Mendix coding rules embedded.

    Args:
        query:          User question (có thể tiếng Việt hoặc English).
        context_chunks: Retrieved document chunk texts (đã qua priority sort).
        history:        Prior conversation turns.

    Returns:
        LLM answer (grounded TypeScript code hoặc factual answer).
    """
    # Build context string từ chunks
    if context_chunks:
        context = "\n\n---\n\n".join(context_chunks)
    else:
        context = "⚠️ No context retrieved. Cannot generate grounded output."

    # Convert Pydantic history → LangChain messages
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
