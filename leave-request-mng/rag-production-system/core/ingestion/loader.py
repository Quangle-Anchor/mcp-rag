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
        raw = settings.docs_dir_names or settings.default_namespace or "documents"
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

def fetch_project_context_documents(
    base_dir: str | None = None,
    folder_name: str | None = None,
    namespace: str | None = None,
    target_names: set[str] | list[str] | None = None,
) -> list[Document]:
    """
    Discover, load, and chunk all documents from auto-discovered directories.

    Steps:
      1. Auto-discover document directories (matching namespace, folder_name, or custom names).
      2. Glob *.md and *.yaml inside them.
      3. Split with MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter.
      4. Annotate each chunk with [FILE | SECTION] prefix.

    Args:
        base_dir: Directory to start from. Defaults to the project root.
        folder_name: Optional explicit folder name (e.g. sibling folder name).
        namespace: Optional explicit namespace name.
        target_names: Optional explicit set of target directory names.

    Returns:
        List of annotated LangChain Document chunks ready for embedding.
    """
    script_dir = base_dir or str(Path(__file__).resolve().parent.parent.parent)
    
    # ── Resolve Document Directory ────────────────────────────────────────────
    doc_dirs: list[str] = []
    
    if folder_name:
        # 1. Check local subfolder
        local_candidate = Path(script_dir) / folder_name
        # 2. Check sibling folder
        sibling_candidate = Path(script_dir).parent / folder_name
        
        if local_candidate.is_dir():
            doc_dirs = [str(local_candidate)]
        elif sibling_candidate.is_dir():
            doc_dirs = [str(sibling_candidate)]
        else:
            # Fallback to bounded discovery
            doc_dirs = _find_doc_dirs(script_dir, target_names={folder_name.strip().lower()})
    else:
        # Default: look for 'documents' or namespace folder in project or sibling
        target_name = namespace or settings.default_namespace or "documents"
        local_doc = Path(script_dir) / "documents"
        local_ns = Path(script_dir) / target_name
        sibling_doc = Path(script_dir).parent / target_name
        
        if local_doc.is_dir():
            doc_dirs = [str(local_doc)]
        elif local_ns.is_dir():
            doc_dirs = [str(local_ns)]
        elif sibling_doc.is_dir():
            doc_dirs = [str(sibling_doc)]
        else:
            doc_dirs = _find_doc_dirs(script_dir, target_names={target_name.strip().lower(), "documents"})

    # Add explicit extra dirs from settings if configured
    if not folder_name and settings.docs_extra_dirs:
        for extra in settings.docs_extra_dirs.split(","):
            extra = extra.strip()
            if extra and os.path.isdir(extra) and extra not in doc_dirs:
                doc_dirs.append(extra)

    if doc_dirs:
        logger.info("  📂 Target document director{}: {}",
                    "y" if len(doc_dirs) == 1 else "ies",
                    doc_dirs)
    else:
        # ── HARD STOP — no document directory found ───────────────────────────
        ns = namespace or folder_name or settings.default_namespace
        searched_paths = [
            str(Path(script_dir) / "documents"),
            str(Path(script_dir) / ns),
            str(Path(script_dir).parent / ns),
        ]
        raise FileNotFoundError(
            "\n"
            "╔══════════════════════════════════════════════════════════╗\n"
            "║         ❌  NO DOCUMENT DIRECTORY FOUND                  ║\n"
            "╠══════════════════════════════════════════════════════════╣\n"
            f"║  Looking for folder named: '{ns}'                        ║\n"
            "║                                                          ║\n"
            "║  📍 Paths searched:                                      ║\n"
            + "".join(f"║    • {p:<52}║\n" for p in searched_paths) +
            "║                                                          ║\n"
            f"║  ✅ FIX: Create a '{ns}' or 'documents' folder and      ║\n"
            "║         place your .md/.yaml documents inside it.        ║\n"
            "╚══════════════════════════════════════════════════════════╝"
        )

    # ── Build glob patterns (STRICTLY inside document directories) ───────────
    # Text files + Visual files (PDF, images)
    _TEXT_EXTS = ("md", "yaml")
    _VISUAL_EXTS = ("pdf", "png", "jpg", "jpeg", "webp")
    _ALL_EXTS = _TEXT_EXTS + _VISUAL_EXTS

    patterns = []
    for doc_dir in doc_dirs:
        for ext in _ALL_EXTS:
            patterns.append(os.path.join(doc_dir, f"*.{ext}"))
            patterns.append(os.path.join(doc_dir, "**", f"*.{ext}"))

    # ── Splitters ─────────────────────────────────────────────────────────────
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=HEADERS_TO_SPLIT_ON)
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
    )

    # ── Read and chunk files ──────────────────────────────────────────────────
    all_chunks: list[Document] = []
    seen_files: set[str] = set()

    for pattern in patterns:
        is_recursive = "**" in pattern
        for file_path in glob.glob(pattern, recursive=is_recursive):
            abs_fp = os.path.abspath(file_path)
            if not os.path.isfile(abs_fp) or abs_fp in seen_files:
                continue
            seen_files.add(abs_fp)

            if _is_excluded(abs_fp):
                logger.debug("[SKIP] {}", abs_fp)
                continue

            file_name = os.path.basename(abs_fp)
            file_ext = os.path.splitext(abs_fp)[1].lower()

            # ── Read content (text vs visual files) ───────────────────────────
            if file_ext in (".pdf", ".png", ".jpg", ".jpeg", ".webp"):
                # Visual file → Vision parser (PDF page classifier + Gemini OCR)
                try:
                    from core.ingestion.parsers.vision_parser import parse_visual_file
                    content = parse_visual_file(abs_fp)
                except Exception as exc:
                    logger.error("[ERROR vision-parse {}] {}", file_path, exc)
                    continue
                if not content or not content.strip():
                    logger.warning("[SKIP] Vision parser returned empty for {}", file_name)
                    continue
            else:
                # Text file (.md, .yaml) → direct read
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
