"""
core/generation/prompt_templates.py — Tập trung tất cả prompt templates.

Bao gồm:
  - RAG_SYSTEM_PROMPT: main grounding prompt với Mendix rules
  - STROT_INTROSPECTION_PROMPT (Phase 6): kiểm tra entity đã tồn tại chưa
  - ERROR_TAXONOMY_PROMPT (Phase 4): phân loại và rectify Mendix SDK errors
  - CQR_REWRITE_PROMPT: LLM-based query rewriting (dùng khi heuristic chưa đủ)
"""
from __future__ import annotations


# ── Phase 6: STROT Schema Introspection ──────────────────────────────────────

STROT_INTROSPECTION_PROMPT = """\
You are a Mendix Schema Introspection Agent.

Before generating any new Entity, Attribute, or Association in TypeScript Mendix Model SDK,
you MUST verify whether the structure already exists in the retrieved project schema.

Retrieved Context:
{context}

User Request:
{query}

Perform the following checks and respond in JSON ONLY:
{{
  "entities_found": ["List of existing entity names found in context"],
  "attributes_found": {{"EntityName": ["attr1", "attr2"]}},
  "associations_found": ["assoc1", "assoc2"],
  "safe_to_create": {{
    "entities": ["Only entities NOT found in context — safe to create new"],
    "attributes": {{"EntityName": ["Only attributes NOT found"]}}
  }},
  "reuse_recommendations": ["e.g., Reuse existing LeaveRequest.Status instead of creating new Status entity"]
}}
"""


# ── Phase 4: Error Taxonomy Diagnosis ────────────────────────────────────────

ERROR_TAXONOMY_PROMPT = """\
You are a Mendix SDK Error Diagnosis Expert.

The user has reported the following error from their generated TypeScript code:
Error: {error_message}

Code Context:
{code_context}

Classify this error using the Mendix Error Taxonomy and provide a CoT-guided fix:

Error Categories:
1. [SDK_SYNTAX]     — missing createIn(), missing await, wrong method signatures
2. [MAPPING_ERROR]  — wrong Entity/Attribute/Association names
3. [DATA_TYPE_MISMATCH] — Enum raw string used, wrong Mendix data type
4. [FLOW_RETURN_VOID]   — VAL_ microflow not returning Boolean
5. [INVALID_XPATH]  — wrong XPath constraint syntax
6. [WIDGET_ERROR]   — DataView/ListView source mismatch
7. [SECURITY_ERROR] — missing Module Role assignment

Respond in JSON ONLY:
{{
  "category": "[ERROR_CATEGORY]",
  "root_cause": "One sentence root cause",
  "cot_steps": [
    "Step 1: ...",
    "Step 2: ...",
    "Step 3: ..."
  ],
  "corrected_code_snippet": "// Fixed TypeScript snippet here"
}}
"""


# ── CQR: LLM-based Query Rewriting ───────────────────────────────────────────

CQR_REWRITE_PROMPT = """\
You are a Mendix RAG Query Optimizer.

Transform the user's raw, casual, or Vietnamese query into a structured, \
high-density English retrieval query for a Pinecone vector database \
containing Mendix project documentation.

User's raw query: {raw_query}
Detected Mendix layer: {layer}

Rules:
1. Convert slang/loose terms into strict Mendix schema logic descriptions.
2. Explicitly name the expected technical metadata (entity attributes, association names,
   enum values, validation messages, XPath constraints, microflow prefixes).
3. Include the most likely document type keywords (e.g., "domain model", "screen layout",
   "business rules", "message list").
4. Output ONLY the optimized query string — no explanation, no markdown.

Examples:
- "check số dư tài khoản" → "Account entity balance attribute VAL_ check balance validation logic XPath constraint"
- "màn hình duyệt nghỉ phép" → "LeaveRequest form container widgets conditional visibility approval status ACT_"
"""
