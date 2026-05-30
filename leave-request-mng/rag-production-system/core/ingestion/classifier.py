"""
core/ingestion/classifier.py — Document layer classification.

Direct port of the hybrid classification logic from rag_system.py:

  STEP 1 (FREE, INSTANT): Keyword match on filename → ~80% of files.
  STEP 2 (LLM FALLBACK) : Call Gemini only when filename gives no signal.
                          Rate-limited to 4 s between calls (free-tier RPM).

The 5-layer Mendix architecture model is preserved exactly.
"""
from __future__ import annotations

import json
import re
import sys
import time

from langchain_google_genai import ChatGoogleGenerativeAI
from loguru import logger

from config import get_settings

settings = get_settings()

# ── 5-Layer Classification Map (from rag_system.py) ──────────────────────────

FILENAME_CLASSIFICATION_MAP: dict[str, dict] = {
    # ── Layer 5 — Cross-cutting (checked FIRST to avoid false matches)
    # e.g. "nfr_requirements.md" must hit 'nfr' before 'requirement'
    "nfr":                  {"layer": 5, "doc_type": "nfr"},
    "message list":         {"layer": 5, "doc_type": "message_list"},
    "message_list":         {"layer": 5, "doc_type": "message_list"},
    "error code":           {"layer": 5, "doc_type": "error_codes"},
    "error_code":           {"layer": 5, "doc_type": "error_codes"},
    # ── Layer 4 — UI
    "screen layout":        {"layer": 4, "doc_type": "screen_layout"},
    "screen list":          {"layer": 4, "doc_type": "screen_list"},
    "screen flow":          {"layer": 4, "doc_type": "screen_flow"},
    "screen transition":    {"layer": 4, "doc_type": "screen_transition"},
    "scr-":                 {"layer": 4, "doc_type": "screen_layout"},
    # ── Layer 3 — Behavior (multi-word first, single-word last)
    "domain model":         {"layer": 3, "doc_type": "domain_model"},
    "physical er":          {"layer": 3, "doc_type": "physical_er"},
    "physical_er":          {"layer": 3, "doc_type": "physical_er"},
    "business rule":        {"layer": 3, "doc_type": "business_rules"},
    "business flow":        {"layer": 3, "doc_type": "business_flow"},
    "build report":         {"layer": 3, "doc_type": "build_report"},
    "build_report":         {"layer": 3, "doc_type": "build_report"},
    # ── Layer 2 — API Contract
    "external interface":   {"layer": 2, "doc_type": "external_interface"},
    "api specification":    {"layer": 2, "doc_type": "api_specification"},
    "external process":     {"layer": 2, "doc_type": "external_process"},
    "data item":            {"layer": 2, "doc_type": "data_item_definition"},
    "openapi":              {"layer": 2, "doc_type": "api_specification"},
    # ── Layer 1 — Foundation (generic keywords last to avoid false positives)
    "business terminology": {"layer": 1, "doc_type": "business_terminology"},
    "domain glossary":      {"layer": 1, "doc_type": "domain_glossary"},
    "domain definition":    {"layer": 1, "doc_type": "domain_definition"},
    "code definition":      {"layer": 1, "doc_type": "code_definition"},
    "requirement":          {"layer": 1, "doc_type": "requirement"},
}

# String → integer map used by the API layer filter
LAYER_MAP: dict[str, int] = {
    "foundation":    1,
    "api":           2,
    "behavior":      3,
    "ui":            4,
    "cross-cutting": 5,
}

# ── LLM Classifier Prompt (from rag_system.py) ────────────────────────────────

CLASSIFIER_PROMPT = """\
You are a Mendix project document classifier.
Classify the document below into the correct architectural layer using the 5-layer model:

  Layer 1 (foundation): Business terminology, domain glossary, domain/code definitions,
    data dictionaries, entity descriptions, requirements.
  Layer 2 (api): External interfaces, API specs, OpenAPI, external processes,
    message contracts, data item definitions, integration specs.
  Layer 3 (behavior): Domain models, physical ER diagrams, business rules, business flows,
    microflow specifications, validation rules, calculation logic.
  Layer 4 (ui): Screen layouts, screen lists, screen flows, screen transitions,
    UI wireframes, page designs, navigation specs.
  Layer 5 (cross-cutting): NFRs, message lists, error codes, security requirements,
    logging, i18n, audit, performance constraints.

File name: {file_name}
Content sample (first 1800 chars):
{content_sample}

Respond with ONLY valid JSON — no markdown fences, no explanation:
{{"layer": <integer 1-5 or 0 if uncertain>, "doc_type": "<snake_case_label>"}}

doc_type examples: physical_er, screen_layout, business_rules, api_specification,
message_list, domain_definition, screen_flow, nfr, code_definition, general.
"""

# ── Lazy LLM Singleton ────────────────────────────────────────────────────────

_classifier_llm: ChatGoogleGenerativeAI | None = None


def _get_classifier_llm() -> ChatGoogleGenerativeAI:
    global _classifier_llm
    if _classifier_llm is None:
        _classifier_llm = ChatGoogleGenerativeAI(
            model=settings.classifier_model,
            temperature=0,
            google_api_key=settings.google_api_key,
        )
    return _classifier_llm


# ── Public API ────────────────────────────────────────────────────────────────

def classify_by_filename(file_name: str) -> dict | None:
    """
    Fast, free classification by matching keywords in the filename.

    Normalization applied before matching:
      - Strip numeric prefixes like '02_', '01 ', etc.
      - Replace underscores AND hyphens with spaces so that
        '02_screen_list.md' matches keyword 'screen list'.
      - Also check original (lowercased) to catch dash patterns like 'scr-'.

    Returns None when no keyword matches — caller falls back to LLM.
    """
    # Raw lowercase (for dash-patterns like "scr-")
    raw = file_name.lower()

    # Normalised: underscores + hyphens → spaces, strip leading digits/separators
    normalised = raw.replace("_", " ").replace("-", " ")
    # Remove leading numeric prefix e.g. "02 " → "screen list"
    normalised = re.sub(r'^\d+\s*', '', normalised)

    for keyword, info in FILENAME_CLASSIFICATION_MAP.items():
        if keyword in normalised or keyword in raw:
            return info
    return None


def classify_with_llm(file_name: str, content: str) -> dict:
    """
    LLM fallback: only called when filename gives no classification signal.
    Applies a 4-second rate-limit sleep after each call (free-tier RPM guard).
    Falls back gracefully to layer=0, doc_type='general' on any error.
    """
    sample = content[:1800]
    prompt = CLASSIFIER_PROMPT.format(file_name=file_name, content_sample=sample)
    try:
        llm = _get_classifier_llm()
        response = llm.invoke(prompt)
        raw = str(response.content).strip()
        # Strip markdown fences if the model wraps output despite instructions
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        result = json.loads(raw)
        layer = int(result.get("layer", 0))
        if layer not in range(6):
            layer = 0
        doc_type = str(result.get("doc_type", "general")).strip() or "general"
        return {"layer": layer, "doc_type": doc_type}
    except Exception as exc:
        logger.warning("[WARN] LLM classification failed for {}: {}", file_name, exc)
        return {"layer": 0, "doc_type": "general"}
    finally:
        # Always sleep to respect rate limits, even on failure
        time.sleep(settings.llm_rate_limit_sleep)


def classify_document(file_name: str, content: str) -> tuple[str, int, str]:
    """
    Hybrid classification entry point.

    Returns:
        (doc_type, layer, method)   where method is "filename" | "llm"
    """
    result = classify_by_filename(file_name)
    if result is not None:
        return result["doc_type"], result["layer"], "filename"

    logger.info("[LLM] No filename match for '{}' — calling Gemini classifier…", file_name)
    result = classify_with_llm(file_name, content)
    return result["doc_type"], result["layer"], "llm"
