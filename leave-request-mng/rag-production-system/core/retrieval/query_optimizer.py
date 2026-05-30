"""
core/retrieval/query_optimizer.py — Dual-Namespace Agentic RAG: Query Optimization.

Implements the 2-Phase retrieval pipeline:
  Phase A: Business context from mendix-docs namespace
  Phase B: Tool spec from mx-tools-agent-microflow namespace

Key responsibilities:
  1. Intent Detection — classify user prompt into biz_only | tool_only | biz_then_tool
  2. Multi-language CQR — normalize any language input → structured English query
  3. Filter Generation — produce Pinecone metadata filters (layer, tool_name, category)
  4. Query Plan — orchestrate the 2-phase retrieval with retry logic
  5. Guardrails — empty layer, token guardrail, call counter enforcement
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from loguru import logger

from config import get_settings

settings = get_settings()


# ── Enums ─────────────────────────────────────────────────────────────────────

class RetrievalIntent(str, Enum):
    """What kind of retrieval does the user prompt require?"""
    biz_only      = "biz_only"       # Only needs business context (schema/rules)
    tool_only     = "tool_only"      # Only needs tool spec (SDK syntax)
    biz_then_tool = "biz_then_tool"  # Needs both: business context → then tool spec


class RetrievalPhase(str, Enum):
    """Which phase of the dual-namespace retrieval."""
    biz  = "biz"   # Phase A: mendix-docs
    tool = "tool"  # Phase B: mx-tools-agent-microflow


# ── Constants ─────────────────────────────────────────────────────────────────

# Mendix 5-layer architecture keyword detection
MENDIX_LAYER_KEYWORDS: dict[str, str] = {
    # Layer 1 — Foundation
    "foundation": "foundation", "business terminology": "foundation",
    "domain glossary": "foundation", "domain definition": "foundation",
    "requirement": "foundation", "entity": "foundation", "attribute": "foundation",
    # Layer 2 — API
    "api": "api", "external interface": "api", "openapi": "api",
    "rest": "api", "message contract": "api", "integration": "api",
    # Layer 3 — Behavior
    "behavior": "behavior", "microflow": "behavior",
    "val_": "behavior", "act_": "behavior", "sub_": "behavior", "wfa_": "behavior",
    "business rule": "behavior", "validation": "behavior", "validate": "behavior",
    "calculation": "behavior", "domain model": "behavior",
    "submit": "behavior", "approval": "behavior", "reject": "behavior",
    # Layer 4 — UI
    "ui": "ui", "screen": "ui", "page": "ui", "form": "ui",
    "layout": "ui", "widget": "ui", "navigation": "ui",
    # Layer 5 — Cross-cutting
    "cross-cutting": "cross-cutting", "nfr": "cross-cutting",
    "security": "cross-cutting", "error code": "cross-cutting",
    "message list": "cross-cutting", "logging": "cross-cutting",
}

# Microflow prefix conventions (Phase 3 Mendix Coding Rules)
MENDIX_PREFIXES = {"VAL_", "ACT_", "SUB_", "WFA_"}

# Document priority fragments (Phase 5 — Conflict Resolution)
HIGH_PRIORITY_FRAGMENTS = {"cr_", "log_", "change_request", "update_"}

# ── Doc-type Source Tier ──────────────────────────────────────────────────────────────────
# Tier 1 (+80): PRIMARY source-of-truth files — these DEFINE rules/schema/messages.
#   When the user asks for a business rule, they want THIS, not a build report.
# Tier 2 (0):   SECONDARY docs — useful context, but not authoritative.
# Tier 3 (-20): SUMMARY/REPORT docs — these REFERENCE tier-1 docs.
#   They pollute results when querying specific IDs because they mention many IDs.
DOC_TYPE_TIER: dict[str, int] = {
    # Tier 1 — Primary source-of-truth
    "business_rules":    80,
    "domain_definition": 80,
    "code_definition":   80,
    "message_list":      80,
    "physical_er":       70,
    # Tier 2 — Secondary context
    "requirement":       0,
    "screen_layout":     0,
    "use_case":          0,
    "system_spec":       0,
    "api_spec":          0,
    # Tier 3 — Summary/report docs (penalise: they cite many IDs without owning them)
    "build_report":     -20,
    "general":          -20,
    "readme":           -20,
}

# ── Tool Spec Metadata ───────────────────────────────────────────────────────

# Mapping from common keywords in user prompts → relevant tool_name values
# This allows the system to auto-generate Pinecone filters for Phase B
TOOL_NAME_MAP: dict[str, list[str]] = {
    # Domain Model
    "entity":       ["create_entity", "create_multiple_entities", "read_domain_model"],
    "attribute":    ["add_attribute", "update_attribute", "read_attribute_details", "set_calculated_attribute"],
    "association":  ["create_association", "create_multiple_associations", "update_association",
                     "query_associations", "diagnose_associations"],
    "enumeration":  ["create_enumeration", "update_enumeration", "list_enumerations",
                     "rename_enumeration_value"],
    "enum":         ["create_enumeration", "update_enumeration", "list_enumerations"],
    "generalization": ["set_entity_generalization", "remove_entity_generalization"],
    # Microflows
    "microflow":    ["create_microflow", "create_microflow_activities", "update_microflow",
                     "list_microflows", "read_microflow_details", "read_microflow_security",
                     "modify_microflow_activity", "insert_before_activity", "microflow_arrange",
                     "set_microflow_url"],
    "nanoflow":     ["create_nanoflow", "update_nanoflow"],
    # Pages / UI
    "page":         ["create_page", "add_widget", "set_widget_property", "create_form_page",
                     "create_combobox", "generate_overview_pages", "list_pages", "read_page_details"],
    "widget":       ["add_widget", "set_widget_property", "create_combobox"],
    "form":         ["create_form_page", "create_page", "add_widget"],
    "combobox":     ["create_combobox"],
    "button":       ["add_widget", "set_widget_property"],
    "dataview":     ["add_widget", "set_widget_property"],
    # REST / API
    "rest":         ["create_consumed_rest_service", "create_published_rest_service",
                     "add_rest_operation", "define_rest_call", "configure_rest_authentication",
                     "add_published_rest_resource", "add_published_rest_operation",
                     "summarize_rest_services", "import_openapi_spec"],
    "odata":        ["create_consumed_odata_service", "create_published_odata_service",
                     "add_published_odata_microflow", "add_published_odata_enumeration"],
    # Constants
    "constant":     ["create_constant", "update_constant", "list_constants",
                     "configure_constant_values"],
    # Session/Working Copy
    "working copy": ["open_working_copy", "commit_working_copy", "discard_working_copy"],
    "commit":       ["commit_working_copy"],
    "session":      ["configure_token", "configure_app", "open_working_copy"],
    # Utilities
    "rename":       ["rename_document", "rename_enumeration_value", "validate_name"],
    "delete":       ["delete_document", "delete_model_element"],
    "copy":         ["copy_model_element"],
    "arrange":      ["arrange_domain_model", "microflow_arrange"],
}

# All 78 known tool names (for validation)
ALL_TOOL_NAMES = sorted({name for names in TOOL_NAME_MAP.values() for name in names})

# All 11 known categories
ALL_CATEGORIES = [
    "Associations", "Attributes", "Constants", "Domain Model", "Enumerations",
    "Microflows", "Model Utilities", "Nanoflows", "Pages", "Rest Services",
    "Session Management",
]

# Keywords that trigger intent = biz_then_tool (user wants to BUILD something)
BUILD_KEYWORDS = {
    "tạo", "tao", "create", "build", "implement", "generate", "make", "add",
    "viết", "viet", "write", "code", "setup", "set up", "configure",
    "xây dựng", "xay dung", "thiết kế", "thiet ke", "làm", "lam",
}

# Keywords that trigger intent = tool_only (user asks about SDK syntax)
TOOL_SYNTAX_KEYWORDS = {
    "syntax", "cú pháp", "cu phap", "sdk", "tool spec", "tool_name",
    "how to use", "cách dùng", "cach dung", "api reference",
    "input parameter", "behavior", "error case",
}


# ── Multi-language normalization ──────────────────────────────────────────────

MULTILANG_MAP: dict[str, str] = {
    # Vietnamese
    "nghỉ phép": "leave request",
    "nghi phep": "leave request",
    "duyệt": "approval",
    "duyet": "approval",
    "từ chối": "reject",
    "tu choi": "reject",
    "số dư": "balance",
    "so du": "balance",
    "kiểm tra": "validation check",
    "kiem tra": "validation check",
    "khách hàng": "customer entity",
    "khach hang": "customer entity",
    "nhân viên": "employee entity",
    "nhan vien": "employee entity",
    "màn hình": "screen page",
    "man hinh": "screen page",
    "logic": "business logic microflow",
    "flow": "microflow flow",
    "trạng thái": "status enumeration",
    "trang thai": "status enumeration",
    "lịch sử": "history audit trail",
    "lich su": "history audit trail",
    "phân quyền": "security module role access",
    "phan quyen": "security module role access",
    "tên": "name",
    "ten": "name",
    "loại": "type",
    "loai": "type",
    "danh sách": "list",
    "danh sach": "list",
    "xóa": "delete",
    "xoa": "delete",
    "sửa": "update modify",
    "sua": "update modify",
    "thêm": "add create",
    "them": "add create",
    # Japanese (common Mendix partner language)
    "エンティティ": "entity",
    "マイクロフロー": "microflow",
    "ページ": "page",
}


def _normalize_multilang(text: str) -> str:
    """Normalize multi-language input → English technical terms."""
    result = text
    for foreign, english in MULTILANG_MAP.items():
        result = result.replace(foreign, english)
    return result


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class PhaseResult:
    """Result from a single retrieval phase."""
    phase: RetrievalPhase
    namespace: str
    queries_used: list[str] = field(default_factory=list)
    filters_used: list[dict] = field(default_factory=list)
    chunks: list[dict] = field(default_factory=list)
    call_count: int = 0
    guardrail_msg: str | None = None

    @property
    def has_context(self) -> bool:
        return len(self.chunks) >= settings.sufficient_chunk_threshold

    @property
    def calls_exhausted(self) -> bool:
        return self.call_count >= settings.max_calls_per_phase


@dataclass
class QueryPlan:
    """
    Orchestration plan for the 2-phase dual-namespace retrieval.

    Each phase has its own call counter (max 2 per phase).
    Total max calls = max_calls_per_phase × 2 phases = 4.
    """
    original_query: str
    intent: RetrievalIntent = RetrievalIntent.biz_then_tool
    phase_a: PhaseResult = field(default_factory=lambda: PhaseResult(
        phase=RetrievalPhase.biz,
        namespace=get_settings().pinecone_namespace,
    ))
    phase_b: PhaseResult = field(default_factory=lambda: PhaseResult(
        phase=RetrievalPhase.tool,
        namespace=get_settings().pinecone_tool_namespace,
    ))

    @property
    def total_calls(self) -> int:
        return self.phase_a.call_count + self.phase_b.call_count

    @property
    def all_chunks(self) -> list[dict]:
        """Merged chunks from both phases (biz first, then tool)."""
        return self.phase_a.chunks + self.phase_b.chunks


# ── Intent Detection ─────────────────────────────────────────────────────────

def detect_retrieval_intent(query: str) -> RetrievalIntent:
    """
    Classify user prompt into one of three intents:
      - biz_only:      Only needs business context (entity schema, rules)
      - tool_only:     Only needs tool spec (SDK syntax/parameters)
      - biz_then_tool: Needs both (create/build something)

    Multi-language aware — normalizes before detection.
    """
    q_lower = _normalize_multilang(query).lower()

    # Check for tool-only keywords first (most specific)
    for kw in TOOL_SYNTAX_KEYWORDS:
        if kw in q_lower:
            logger.debug("[INTENT] tool_only — matched keyword '{}'", kw)
            return RetrievalIntent.tool_only

    # Check for build/create keywords → needs both contexts
    for kw in BUILD_KEYWORDS:
        if kw in q_lower:
            logger.debug("[INTENT] biz_then_tool — matched keyword '{}'", kw)
            return RetrievalIntent.biz_then_tool

    # Check if query mentions a specific tool name
    for tool_name in ALL_TOOL_NAMES:
        if tool_name in q_lower.replace("-", "_"):
            logger.debug("[INTENT] tool_only — matched tool name '{}'", tool_name)
            return RetrievalIntent.tool_only

    # Default: business context only
    logger.debug("[INTENT] biz_only — no build/tool keywords detected")
    return RetrievalIntent.biz_only


# ── Layer Detection ──────────────────────────────────────────────────────────

def detect_mendix_layer(query: str) -> str | None:
    """Detect Mendix architecture layer from query keywords.
    
    Longer/more-specific keywords are tested first so that 'domain model'
    wins over 'entity' when both appear in the query.
    """
    q_lower = _normalize_multilang(query).lower()
    # Sort by keyword length descending — multi-word phrases checked before single words
    for keyword in sorted(MENDIX_LAYER_KEYWORDS, key=len, reverse=True):
        layer = MENDIX_LAYER_KEYWORDS[keyword]
        if keyword.lower() in q_lower:
            logger.debug("[LAYER] Detected: '{}' via keyword '{}'", layer, keyword)
            return layer
    return None


def detect_microflow_prefix(query: str) -> str | None:
    """Detect Mendix microflow prefix (VAL_, ACT_, SUB_, WFA_) in query."""
    q_upper = query.upper()
    for prefix in MENDIX_PREFIXES:
        if prefix in q_upper:
            return prefix
    return None


# ── CQR: Contextual Query Rewriting (always outputs English) ─────────────────

# Bare-ID detection patterns (compiled once at module level)
_BARE_BR_RE  = re.compile(r'^\s*BR-?\d{2,}\s*$', re.IGNORECASE)
_BARE_E_RE   = re.compile(r'^\s*E\d{3}\s*$',     re.IGNORECASE)
_BARE_I_RE   = re.compile(r'^\s*I\d{3}\s*$',     re.IGNORECASE)
_BARE_SCR_RE = re.compile(r'^\s*SCR-[A-Z]+-\d+\s*$', re.IGNORECASE)
_BARE_UC_RE  = re.compile(r'^\s*UC-?\d+\s*$',    re.IGNORECASE)

def rewrite_query_for_retrieval(
    query: str,
    phase: RetrievalPhase,
    attempt: int = 1,
    biz_context: list[dict] | None = None,
) -> str:
    """
    CQR — Transform user input (any language) → structured English query.

    Always produces English output regardless of input language.
    Adapts strategy based on phase and attempt number.

    Args:
        query:       Original user prompt (any language).
        phase:       Which retrieval phase (biz or tool).
        attempt:     1 = deep targeted, 2 = broadened pivot.
        biz_context: Chunks from Phase A (used in Phase B to refine).
    """
    # Step 1: Normalize multi-language → English
    normalized = _normalize_multilang(query.strip())

    # Step 2: Detect metadata for enrichment
    prefix = detect_microflow_prefix(normalized)
    layer = detect_mendix_layer(normalized)

    if phase == RetrievalPhase.biz:
        return _rewrite_biz_query(normalized, prefix, layer, attempt)
    else:
        return _rewrite_tool_query(normalized, biz_context, attempt)


def _rewrite_biz_query(normalized: str, prefix: str | None, layer: str | None, attempt: int) -> str:
    """CQR for Phase A: Business context retrieval."""
    # ── ID Expansion: bare codes like "BR-02" or "E001" get expanded ────────
    # A 2-token query like "BR-02" produces a nearly identical embedding to
    # "BR-06", making Pinecone unable to distinguish them. Expanding to a
    # descriptive sentence widens the vector distance.
    bare_id = normalized.strip()
    if _BARE_BR_RE.match(bare_id):
        # Add "source specification" anchor so Pinecone favours the business_rules
        # spec file over build_report / screen_layout files that merely cite the ID.
        normalized = (
            f"business rule {bare_id} {bare_id.replace('-','')} "
            f"definition description condition source specification "
            f"business_rules domain_definition leave request"
        )
    elif _BARE_E_RE.match(bare_id):
        normalized = (
            f"error message code {bare_id} severity validation blocking "
            f"text description leave request message_list source specification"
        )
    elif _BARE_I_RE.match(bare_id):
        normalized = (
            f"info message code {bare_id} success notification text "
            f"description leave request message_list source specification"
        )
    elif _BARE_SCR_RE.match(bare_id):
        normalized = (
            f"screen page layout {bare_id} fields buttons events microflow "
            f"UI design screen_layout source specification leave request"
        )
    elif _BARE_UC_RE.match(bare_id):
        normalized = (
            f"use case {bare_id} {bare_id.replace('-','')} actor flow steps "
            f"preconditions postconditions leave request"
        )

    if attempt == 1:
        extras = []
        if prefix:
            extras.append(f"{prefix} microflow return type parameters activity list")
        if layer:
            extras.append(f"{layer} layer document")
        if "VAL_" in normalized.upper() or "valid" in normalized.lower():
            extras.append("validation boolean return XPath constraint error message")
        if "ACT_" in normalized.upper():
            extras.append("action microflow commit rollback entity manipulation")
        if "WFA_" in normalized.upper():
            extras.append("workflow approval reject status transition")
        rewritten = normalized
        if extras:
            rewritten += " " + " ".join(extras)
        return rewritten.strip()
    else:
        # Attempt 2: Broaden — shift focus to schema/entity level
        rewritten = re.sub(r'\b(VAL|ACT|SUB|WFA)_\w+', 'microflow', normalized, flags=re.IGNORECASE)
        rewritten += " entity attributes associations enumeration values domain model schema"
        return rewritten.strip()



def _rewrite_tool_query(normalized: str, biz_context: list[dict] | None, attempt: int) -> str:
    """CQR for Phase B: Tool spec retrieval."""
    if attempt == 1:
        # Extract entity/microflow names from biz_context to sharpen query
        context_hints = []
        if biz_context:
            for chunk in biz_context[:3]:  # top 3 chunks
                content = chunk.get("content", "").lower()
                if "microflow" in content:
                    context_hints.append("create microflow activities parameters return type")
                if "entity" in content or "attribute" in content:
                    context_hints.append("create entity add attribute domain model")
                if "page" in content or "widget" in content:
                    context_hints.append("create page add widget set property layout")
                if "association" in content:
                    context_hints.append("create association update association")

        rewritten = normalized + " Mendix Model SDK tool specification input parameters behavior"
        if context_hints:
            rewritten += " " + " ".join(set(context_hints))
        return rewritten.strip()
    else:
        # Attempt 2: Broaden — search by category instead of specific tool
        rewritten = normalized + " tool specification category SDK syntax input output error cases"
        return rewritten.strip()


# ── Filter Generation ─────────────────────────────────────────────────────────

# Keywords that signal this behavior query also needs cross-cutting messages (layer 5)
_BIZ_NEEDS_MESSAGES_RE = re.compile(
    r'\b(validate|validation|error|message|submit|E\d{3}|I\d{3}|feedback|BR-?\d{2,})\b',
    re.IGNORECASE
)


def generate_biz_filter(query: str, layer: str | None = None) -> dict[str, Any] | None:
    """
    Generate Pinecone metadata filter for Phase A (business context).

    Layer 5 inclusion rule:
        Microflow/validation queries (ACT_, BR-xx, error/message keywords) need
        BOTH their primary behavior layer (3) AND the cross-cutting message list
        (layer 5). We use {"layer": {"$in": [3, 5]}} in these cases so that
        03_message_list.yaml (layer 5) is not excluded.

    Returns a filter dict or None (no filter = search all).
    """
    from core.ingestion.classifier import LAYER_MAP

    effective_layer = layer or detect_mendix_layer(query)
    if not effective_layer:
        return None

    layer_int = LAYER_MAP.get(effective_layer.lower().strip())
    if layer_int is None:
        logger.warning("[FILTER] Unknown layer '{}'. No filter applied.", effective_layer)
        return None

    # For behavior layer (3), also pull layer 5 when query involves
    # validation / error codes / message lists.
    if layer_int == 3 and _BIZ_NEEDS_MESSAGES_RE.search(query):
        logger.info("[FILTER] Behavior + message query → layer $in [3, 5]")
        return {"layer": {"$in": [3, 5]}}

    return {"layer": layer_int}


def generate_tool_filter(
    query: str,
    biz_context: list[dict] | None = None,
) -> dict[str, Any]:
    """
    Generate Pinecone metadata filter for Phase B (tool spec).

    Always includes data_type="tool_spec".
    Attempts to narrow by tool_name based on query keywords + biz context.
    Falls back to category filter if no specific tool is detected.

    Returns a filter dict ready for Pinecone.
    """
    base_filter: dict[str, Any] = {"data_type": "tool_spec"}

    # Step 1: Find matching tool names from query keywords
    q_lower = _normalize_multilang(query).lower().replace("-", "_")
    matched_tools: set[str] = set()

    for keyword, tool_names in TOOL_NAME_MAP.items():
        if keyword in q_lower:
            matched_tools.update(tool_names)

    # Step 2: Enrich from biz_context content
    if biz_context:
        for chunk in biz_context[:5]:
            content = chunk.get("content", "").lower()
            for keyword, tool_names in TOOL_NAME_MAP.items():
                if keyword in content:
                    matched_tools.update(tool_names)

    # Step 3: Build filter
    if matched_tools:
        # Limit to most relevant tools (max 10 to avoid over-broad filter)
        tool_list = sorted(matched_tools)[:10]
        base_filter["tool_name"] = {"$in": tool_list}
        logger.info("[FILTER] Tool filter: {} tool(s) matched", len(tool_list))
    else:
        logger.info("[FILTER] No specific tools matched — querying all tool specs")

    return base_filter


# ── Phase 5: Document Conflict Resolution ─────────────────────────────────────

def sort_chunks_by_priority(chunks: list[dict]) -> list[dict]:
    """
    Phase 5 — Document Conflict Resolution Rules (Source Priority Bias fix):

    The key insight: build_report / screen_layout files contain MANY keyword IDs
    (BR-02, ACT_Submit, E001 ...) because they REFERENCE spec files. Dense
    embedding then ranks them equal to (or above) the actual source files.

    Fix: apply a 3-tier doc-type scoring so primary spec files always win:
      Tier 1 (+80): business_rules, domain_definition, code_definition, message_list,
                    physical_er    → these OWN and DEFINE rules/schema.
      Tier 2 (0):   requirement, screen_layout, use_case, system_spec.
      Tier 3 (-20): build_report, general, readme  → cite many IDs, don't own them.

    Additional boosts:
      +30  CR_ / Log_ / change_request filenames (most recent state)
      +15  .yaml extension over .md (YAML = structured spec)
    """
    def priority_score(chunk: dict) -> int:
        meta = chunk.get("metadata", {})
        filename = meta.get("file_name", "").lower()
        doc_type = meta.get("doc_type", "general").lower().strip()
        score = 0

        # Tier bonus from doc_type
        score += DOC_TYPE_TIER.get(doc_type, 0)

        # Extra: CR_ / Log_ filename prefix → most up-to-date change record
        for frag in HIGH_PRIORITY_FRAGMENTS:
            if filename.startswith(frag):
                score += 30
                break

        # .yaml slightly preferred over .md for same doc_type tier
        if filename.endswith(".yaml"):
            score += 15

        # tool_spec handled in Phase B; tiny boost to keep them visible
        if meta.get("data_type") == "tool_spec":
            score += 10

        return score

    return sorted(chunks, key=lambda c: (-priority_score(c), -c.get("score", 0)))


# ── Guardrail Messages ───────────────────────────────────────────────────────

def build_empty_layer_message(layer: str) -> str:
    """Phase 2 — EMPTY LAYER GUARDRAIL format."""
    return (
        f"[EMPTY LAYER GUARDRAIL TRIGGERED]\n"
        f"Layer \"{layer}\" returned zero chunks from the Pinecone index.\n"
        f"This means the documentation for this layer has NOT been synced yet.\n\n"
        f"ACTION REQUIRED (choose one):\n"
        f"[ ] Run sync (POST /api/v1/sync with confirmed: true) to re-index all project documentation files.\n"
        f"[ ] Confirm that the relevant documents exist in the Output directory.\n\n"
        f"I cannot generate code without a grounded source of truth. Please sync the index and retry."
    )


def build_no_context_message() -> str:
    """Returned when no chunks found at all."""
    return (
        "No context found for this query.\n"
        "Check that sync has been run and the query is specific enough."
    )


def build_phase_guardrail_message(plan: QueryPlan) -> str:
    """
    Token guardrail message when a phase exhausts its call quota
    without sufficient context.
    """
    lines = [
        "[TOKEN GUARDRAIL TRIGGERED: INSUFFICIENT CONTEXT]",
        f"Intent: {plan.intent.value}",
        f"Total calls: {plan.total_calls}",
    ]
    if plan.phase_a.queries_used:
        lines.append(f"\nPhase A (Business Context) — {plan.phase_a.call_count} call(s):")
        for i, q in enumerate(plan.phase_a.queries_used, 1):
            lines.append(f"  Call #{i}: \"{q[:100]}\"")
        lines.append(f"  Chunks retrieved: {len(plan.phase_a.chunks)}")

    if plan.phase_b.queries_used:
        lines.append(f"\nPhase B (Tool Spec) — {plan.phase_b.call_count} call(s):")
        for i, q in enumerate(plan.phase_b.queries_used, 1):
            lines.append(f"  Call #{i}: \"{q[:100]}\"")
        lines.append(f"  Chunks retrieved: {len(plan.phase_b.chunks)}")

    lines.append("\nASSUMPTIONS (Please confirm before I proceed):")
    lines.append("[ ] A1: Entity and attribute names assumed from query context — not verified in Pinecone.")
    lines.append("[ ] A2: Business logic assumed from general Mendix patterns — not grounded in project docs.")
    lines.append("\nPlease clarify the missing business logic or metadata above.")
    return "\n".join(lines)
