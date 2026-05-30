"""
core/ingestion/loader.py — Document discovery, loading, and chunking pipeline.

Faithfully mirrors fetch_project_context_documents() from rag_system.py:

  1. Auto-discover 'Output'/'Outputs' directories by walking downward (unlimited)
     and upward (3 ancestor levels × 3-level deep subtrees).
  2. Build glob patterns for *.md and *.yaml inside each discovered dir.
  3. Exclude forbidden directories and filename fragments.
  4. Classify each file via the hybrid classifier (filename-first → LLM fallback).
  5. Split with MarkdownHeaderTextSplitter, then sub-split large chunks with
     RecursiveCharacterTextSplitter (chunk_size=900, overlap=120).
  6. Prefix each chunk with [FILE | TYPE | LAYER | SECTION] context header.
"""
from __future__ import annotations

import glob
import os
from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from loguru import logger
import re

from config import get_settings
from core.ingestion.classifier import classify_document

settings = get_settings()

# ── Exclusion Lists (from rag_system.py) ──────────────────────────────────────

EXCLUDED_DIRS: set[str] = {
    "node_modules", ".github", ".vscode", "__pycache__",
    "dist", "build", ".git", "coverage", ".idea", "out", "target",
}

EXCLUDED_NAME_FRAGMENTS: set[str] = {"instruction", "generation_log", "gap_report"}

# ── Markdown Splitter Config ──────────────────────────────────────────────────

HEADERS_TO_SPLIT_ON = [
    ("#",    "Header 1"),
    ("##",   "Header 2"),
    ("###",  "Header 3"),
    ("####", "Header 4"),
]


# ── Helper: exclusion guard ───────────────────────────────────────────────────

def _is_excluded(file_path: str) -> bool:
    """Return True if the file must not be indexed."""
    parts = set(file_path.replace("\\", "/").split("/"))
    if parts & EXCLUDED_DIRS:
        return True
    base_lower = os.path.basename(file_path).lower()
    return any(frag in base_lower for frag in EXCLUDED_NAME_FRAGMENTS)


# ── Helper: Output directory auto-discovery ───────────────────────────────────

def _find_output_dirs(start_dir: str) -> list[str]:
    """
    Mirror of _find_output_dirs() from rag_system.py.

    Searches for directories named 'Output' or 'Outputs' (case-insensitive):
      1. Downward from start_dir — unlimited depth.
      2. Upward through up to 3 ancestor levels, each scanned 3 levels deep.

    Returns a de-duplicated, order-preserved list of absolute paths.
    """
    found: list[str] = []
    target_names = {"output", "outputs"}
    excluded_lower = {e.lower() for e in EXCLUDED_DIRS}

    def _walk_bounded(root_path: str, max_depth: int):
        for root, dirs, files in os.walk(root_path):
            rel = os.path.relpath(root, root_path)
            depth = 0 if rel == "." else len(rel.split(os.sep))
            if depth >= max_depth:
                dirs[:] = []
                continue
            dirs[:] = [d for d in dirs if d.lower() not in excluded_lower]
            yield root, dirs, files

    # ── 1. Downward scan ──────────────────────────────────────────────────────
    logger.debug("[SCAN] Scanning downward from: {}", start_dir)
    for root, dirs, _ in _walk_bounded(start_dir, max_depth=999):
        for d in dirs:
            if d.strip().lower() in target_names:
                candidate = os.path.join(root, d)
                found.append(candidate)
                logger.info("  ✅ Found Output dir (downward): {}", candidate)

    # ── 2. Upward scan ────────────────────────────────────────────────────────
    ancestor = start_dir
    for _ in range(3):
        parent = os.path.dirname(ancestor)
        if parent == ancestor:
            break
        try:
            for root, dirs, _ in _walk_bounded(parent, max_depth=3):
                abs_root = os.path.abspath(root)
                abs_start = os.path.abspath(start_dir)
                try:
                    if os.path.commonpath([abs_root, abs_start]) == abs_start:
                        dirs[:] = []
                        continue
                except ValueError:
                    pass
                for d in dirs:
                    if d.strip().lower() in target_names:
                        candidate = os.path.join(root, d)
                        if candidate not in found:
                            found.append(candidate)
                            logger.info("  ✅ Found Output dir (upward): {}", candidate)
        except PermissionError:
            pass
        ancestor = parent

    return list(dict.fromkeys(found))  # preserve order, deduplicate


# ── Keyword Extraction Helper ────────────────────────────────────────────────

_ID_PATTERN = re.compile(r'\b(BR-\d{2,}|SCR-[A-Z]+-\d+|UC-\d+|[IE]\d{3})\b')

def _extract_keywords(text: str) -> str:
    """
    Find specific business IDs (BR-xx, SCR-xxx, etc.) and return a formatted
    keyword string that includes both hyphenated and non-hyphenated versions.
    This drastically improves Dense Embedding retrieval for exact codes.
    """
    matches = set(_ID_PATTERN.findall(text))
    if not matches:
        return ""
    
    # Generate variations (e.g., BR-02 -> BR02) to handle user query variations
    keywords = []
    for m in matches:
        keywords.append(m)
        if '-' in m:
            keywords.append(m.replace('-', ''))
            
    return f"[KEYWORDS: {', '.join(sorted(keywords))}]"


# ── Core: fetch and chunk all project documents ───────────────────────────────

def fetch_project_context_documents(base_dir: str | None = None) -> list[Document]:
    """
    Mirror of fetch_project_context_documents() from rag_system.py.

    Steps:
      1. Auto-discover Output directories near base_dir.
      2. Glob *.md and *.yaml inside them.
      3. Classify each file (filename → LLM fallback).
      4. Split with MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter.
      5. Annotate each chunk with [FILE | TYPE | LAYER | SECTION] prefix.

    Args:
        base_dir: Directory to start from. Defaults to the project root.

    Returns:
        List of annotated LangChain Document chunks ready for embedding.
    """
    script_dir = base_dir or str(Path(__file__).resolve().parent.parent.parent)
    output_dirs = _find_output_dirs(script_dir)

    if output_dirs:
        logger.info("  📂 Found {} Output director{}: {}",
                    len(output_dirs),
                    "y" if len(output_dirs) == 1 else "ies",
                    output_dirs)
    else:
        # ── HARD STOP — no Output directory anywhere near the project ──────
        searched_paths = [
            script_dir,
            os.path.dirname(script_dir),
            os.path.dirname(os.path.dirname(script_dir)),
        ]
        raise FileNotFoundError(
            "\n"
            "╔══════════════════════════════════════════════════════════╗\n"
            "║         ❌  NO 'Output' DIRECTORY FOUND                  ║\n"
            "╠══════════════════════════════════════════════════════════╣\n"
            "║  The sync requires at least one folder named 'Output'    ║\n"
            "║  or 'Outputs' containing your .md / .yaml documents.    ║\n"
            "║                                                          ║\n"
            "║  📍 Paths searched:                                      ║\n"
            + "".join(f"║    • {p:<52}║\n" for p in searched_paths) +
            "║                                                          ║\n"
            "║  ✅ FIX: Create an 'Output' folder in your project and   ║\n"
            "║         place your .md/.yaml documents inside it.        ║\n"
            "╚══════════════════════════════════════════════════════════╝"
        )

    # ── Build glob patterns ───────────────────────────────────────────────────
    patterns = [
        os.path.join(script_dir, "*.md"),
        os.path.join(script_dir, "*.yaml"),
    ]
    for out_dir in output_dirs:
        patterns.append(os.path.join(out_dir, "**", "*.md"))
        patterns.append(os.path.join(out_dir, "**", "*.yaml"))

    # ── Splitters ─────────────────────────────────────────────────────────────
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=HEADERS_TO_SPLIT_ON)
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,     # 900
        chunk_overlap=settings.chunk_overlap,  # 120
    )

    # ── Pass 1: Read files & extract definitions ──────────────────────────────
    raw_files = []
    definitions = {}

    for pattern in patterns:
        is_recursive = "**" in pattern
        for file_path in glob.glob(pattern, recursive=is_recursive):
            if not os.path.isfile(file_path):
                continue
            if _is_excluded(file_path):
                logger.debug("[SKIP] {}", file_path)
                continue

            file_name = os.path.basename(file_path)

            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except UnicodeDecodeError:
                try:
                    with open(file_path, "r", encoding="utf-16") as f:
                        content = f.read()
                except Exception as exc:
                    logger.error("[ERROR reading {}] {}", file_path, exc)
                    continue
            except Exception as exc:
                logger.error("[ERROR reading {}] {}", file_path, exc)
                continue

            # Classify
            doc_type, doc_layer, method = classify_document(file_name, content)
            raw_files.append((file_path, file_name, content, doc_type, doc_layer, method))

            # Extract Definitions from tables
            for line in content.splitlines():
                if line.strip().startswith('|'):
                    m = re.search(r'\|\s*\**((?:BR|UC|E|I)-?\d{2,})\**\s*\|', line, re.IGNORECASE)
                    if m:
                        br_id = m.group(1).upper()
                        if '-' not in br_id:
                            m2 = re.match(r'^([A-Z]+)(\d+)$', br_id)
                            if m2: br_id = f"{m2.group(1)}-{m2.group(2)}"
                        if br_id not in definitions:
                            definitions[br_id] = line.strip()

    # ── Pass 2: Split and Inject ──────────────────────────────────────────────
    all_chunks: list[Document] = []
    
    for file_path, file_name, content, doc_type, doc_layer, method in raw_files:
            # ── Split ─────────────────────────────────────────────────────────
            md_splits = markdown_splitter.split_text(content)
            chunks = (
                text_splitter.split_documents(md_splits)
                if md_splits
                else text_splitter.create_documents([content])
            )

            # ── Annotate each chunk ───────────────────────────────────────────
            for chunk in chunks:
                chunk.metadata["source"]    = file_path
                chunk.metadata["file_name"] = file_name
                chunk.metadata["doc_type"]  = doc_type
                chunk.metadata["layer"]     = doc_layer

                # Build section breadcrumb from MarkdownHeaderTextSplitter metadata
                header_context = " > ".join(
                    chunk.metadata.get(f"Header {i}", "")
                    for i in range(1, 5)
                    if chunk.metadata.get(f"Header {i}")
                )
                context_prefix = f"[FILE: {file_name} | TYPE: {doc_type} | LAYER: {doc_layer}]"
                if header_context:
                    context_prefix += f"\n[SECTION: {header_context}]"
                
                keywords_str = _extract_keywords(chunk.page_content)
                if keywords_str:
                    context_prefix += f"\n{keywords_str}"

                chunk.page_content = context_prefix + "\n\n" + chunk.page_content
                
                # ── Inject Definitions ────────────────────────────────────────
                found_ids = set(_ID_PATTERN.findall(chunk.page_content))
                injected_defs = []
                for k in found_ids:
                    upper_k = k.upper()
                    if '-' not in upper_k:
                        m2 = re.match(r'^([A-Z]+)(\d+)$', upper_k)
                        if m2: upper_k = f"{m2.group(1)}-{m2.group(2)}"
                    
                    if upper_k in definitions:
                        # Avoid injecting if the chunk already contains the table row
                        if definitions[upper_k] not in chunk.page_content:
                            injected_defs.append(f"{upper_k} Definition: {definitions[upper_k]}")
                
                if injected_defs:
                    chunk.page_content += "\n\n[INJECTED DEFINITIONS]\n" + "\n".join(injected_defs)

            all_chunks.extend(chunks)
            logger.info(
                "[OK] {} → {} chunks (type={}, layer={}, via={})",
                file_name, len(chunks), doc_type, doc_layer, method,
            )

    return all_chunks
