"""
core/ingestion/loader.py — Document discovery, loading, and chunking pipeline.

Pipeline:
  1. Auto-discover document directories by name (matching namespace or custom names).
  2. Build glob patterns for *.md and *.yaml inside each discovered dir.
  3. Exclude forbidden directories and filename fragments.
  4. Split with MarkdownHeaderTextSplitter, then sub-split large chunks with
     RecursiveCharacterTextSplitter (chunk_size=900, overlap=120).
  5. Prefix each chunk with [FILE | SECTION] context header.
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

settings = get_settings()

# ── Exclusion Lists ───────────────────────────────────────────────────────────

EXCLUDED_DIRS: set[str] = {
    "node_modules", ".github", ".vscode", "__pycache__",
    "dist", "build", ".git", "coverage", ".idea", "out", "target",
    ".venv", "venv",
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


# ── Helper: Document directory auto-discovery ─────────────────────────────────

def _find_doc_dirs(start_dir: str, target_names: set[str] | None = None) -> list[str]:
    """
    Search for directories matching target_names (case-insensitive).

    Default target names come from settings.docs_dir_names (comma-separated).
    Searches:
      1. Downward from start_dir — unlimited depth.
      2. Upward through up to 3 ancestor levels, each scanned 3 levels deep.

    Returns a de-duplicated, order-preserved list of absolute paths.
    """
    if target_names is None:
        raw = settings.docs_dir_names or settings.pinecone_namespace or "documents"
        target_names = {n.strip().lower() for n in raw.split(",") if n.strip()}

    found: list[str] = []
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
                logger.info("  ✅ Found doc dir (downward): {}", candidate)

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
                            logger.info("  ✅ Found doc dir (upward): {}", candidate)
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
    """
    matches = set(_ID_PATTERN.findall(text))
    if not matches:
        return ""
    
    keywords = []
    for m in matches:
        keywords.append(m)
        if '-' in m:
            keywords.append(m.replace('-', ''))
            
    return f"[KEYWORDS: {', '.join(sorted(keywords))}]"


# ── Core: fetch and chunk all project documents ───────────────────────────────

def fetch_project_context_documents(base_dir: str | None = None) -> list[Document]:
    """
    Discover, load, and chunk all documents from auto-discovered directories.

    Steps:
      1. Auto-discover document directories (matching namespace or custom names).
      2. Glob *.md and *.yaml inside them.
      3. Split with MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter.
      4. Annotate each chunk with [FILE | SECTION] prefix.

    Args:
        base_dir: Directory to start from. Defaults to the project root.

    Returns:
        List of annotated LangChain Document chunks ready for embedding.
    """
    script_dir = base_dir or str(Path(__file__).resolve().parent.parent.parent)
    doc_dirs = _find_doc_dirs(script_dir)

    # Also add any extra dirs from settings
    if settings.docs_extra_dirs:
        for extra in settings.docs_extra_dirs.split(","):
            extra = extra.strip()
            if extra and os.path.isdir(extra) and extra not in doc_dirs:
                doc_dirs.append(extra)

    if doc_dirs:
        logger.info("  📂 Found {} document director{}: {}",
                    len(doc_dirs),
                    "y" if len(doc_dirs) == 1 else "ies",
                    doc_dirs)
    else:
        # ── HARD STOP — no document directory found ───────────────────────────
        ns = settings.pinecone_namespace
        searched_paths = [
            script_dir,
            os.path.dirname(script_dir),
            os.path.dirname(os.path.dirname(script_dir)),
        ]
        raise FileNotFoundError(
            "\n"
            "╔══════════════════════════════════════════════════════════╗\n"
            "║         ❌  NO DOCUMENT DIRECTORY FOUND                  ║\n"
            "╠══════════════════════════════════════════════════════════╣\n"
            f"║  Looking for folder named: '{ns}' (= namespace)         ║\n"
            "║                                                          ║\n"
            "║  📍 Paths searched:                                      ║\n"
            + "".join(f"║    • {p:<52}║\n" for p in searched_paths) +
            "║                                                          ║\n"
            f"║  ✅ FIX: Create a '{ns}' folder in your project and     ║\n"
            "║         place your .md/.yaml documents inside it.        ║\n"
            "╚══════════════════════════════════════════════════════════╝"
        )

    # ── Build glob patterns ───────────────────────────────────────────────────
    patterns = [
        os.path.join(script_dir, "*.md"),
        os.path.join(script_dir, "*.yaml"),
    ]
    for doc_dir in doc_dirs:
        patterns.append(os.path.join(doc_dir, "**", "*.md"))
        patterns.append(os.path.join(doc_dir, "**", "*.yaml"))

    # ── Splitters ─────────────────────────────────────────────────────────────
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=HEADERS_TO_SPLIT_ON)
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
    )

    # ── Read and chunk files ──────────────────────────────────────────────────
    all_chunks: list[Document] = []

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

                # Build section breadcrumb from MarkdownHeaderTextSplitter metadata
                header_context = " > ".join(
                    chunk.metadata.get(f"Header {i}", "")
                    for i in range(1, 5)
                    if chunk.metadata.get(f"Header {i}")
                )
                context_prefix = f"[FILE: {file_name}]"
                if header_context:
                    context_prefix += f"\n[SECTION: {header_context}]"
                
                keywords_str = _extract_keywords(chunk.page_content)
                if keywords_str:
                    context_prefix += f"\n{keywords_str}"

                chunk.page_content = context_prefix + "\n\n" + chunk.page_content

            all_chunks.extend(chunks)
            logger.info("[OK] {} → {} chunks", file_name, len(chunks))

    return all_chunks
