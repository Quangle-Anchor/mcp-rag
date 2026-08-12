"""
core/ingestion/code_loader.py — Language-aware source code chunking engine.

Scans a source code folder and chunks files using language-specific separators
(class/function/method boundaries) instead of markdown headers.

Supported Languages:
  Python (.py)          — class, def, async def
  JavaScript (.js/jsx)  — function, const, class, export
  TypeScript (.ts/tsx)   — interface, type, function, class, export
  Java (.java)           — public class, private, protected, public
  CSS/SCSS (.css/scss)   — selectors, @media
  HTML (.html)           — semantic tags
  JSON (.json)           — whole file or line-split
  YAML (.yaml/yml)       — document separators
  Markdown (.md)         — header-based (falls back to MarkdownHeaderTextSplitter)
  XML (.xml)             — tags
  SQL (.sql)             — CREATE, ALTER, INSERT, SELECT
  Shell (.sh/bash)       — function
  Go (.go)               — func, type
  Rust (.rs)             — fn, struct, impl, enum, mod
  C/C++ (.c/.cpp/.h)     — function signatures, class, struct
  Ruby (.rb)             — class, def, module
  PHP (.php)             — class, function
  Kotlin (.kt)           — class, fun, object
  Swift (.swift)         — class, func, struct, enum, protocol

Architecture:
  scan_source_code(folder_path)
    └── for each file:
          ├── detect language by extension
          ├── choose separator list
          ├── RecursiveCharacterTextSplitter(separators=...)
          └── prefix chunk with [FILE: ...] [LANG: ...]
"""
from __future__ import annotations

import os
from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import (
    MarkdownHeaderTextSplitter,
    RecursiveCharacterTextSplitter,
    Language,
)
from loguru import logger

from config import get_settings

settings = get_settings()

# ── Exclusion Lists ───────────────────────────────────────────────────────────

EXCLUDED_DIRS: set[str] = {
    "node_modules", ".github", ".vscode", "__pycache__",
    "dist", "build", ".git", "coverage", ".idea", "out", "target",
    ".venv", "venv", ".next", ".nuxt", ".cache", ".parcel-cache",
    "vendor", "Pods", ".gradle", "bin", "obj", ".svn", ".hg",
    ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    "egg-info", ".eggs", ".terraform",
}

EXCLUDED_FILES: set[str] = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "poetry.lock", "Pipfile.lock", "composer.lock",
    "Gemfile.lock", "Cargo.lock", "go.sum",
    ".DS_Store", "thumbs.db",
}

# Max file size to process (500KB) — skip minified bundles, large data files
MAX_FILE_SIZE_BYTES = 500 * 1024


# ── Language Detection & Separator Config ─────────────────────────────────────

# Maps file extension → (language_label, LangChain Language enum or None)
# Using LangChain's built-in Language enum where available for best separators
EXTENSION_MAP: dict[str, tuple[str, Language | None]] = {
    # Python
    ".py":    ("python",     Language.PYTHON),
    # JavaScript / TypeScript
    ".js":    ("javascript", Language.JS),
    ".jsx":   ("jsx",        Language.JS),
    ".ts":    ("typescript", Language.TS),
    ".tsx":   ("tsx",        Language.TS),
    # Java / Kotlin
    ".java":  ("java",       Language.JAVA),
    ".kt":    ("kotlin",     Language.KOTLIN),
    # Go
    ".go":    ("go",         Language.GO),
    # Rust
    ".rs":    ("rust",       Language.RUST),
    # C / C++
    ".c":     ("c",          Language.C),
    ".h":     ("c-header",   Language.C),
    ".cpp":   ("cpp",        Language.CPP),
    ".hpp":   ("cpp-header", Language.CPP),
    # Ruby
    ".rb":    ("ruby",       Language.RUBY),
    # PHP
    ".php":   ("php",        Language.PHP),
    # Swift
    ".swift": ("swift",      Language.SWIFT),
    # Scala
    ".scala": ("scala",      Language.SCALA),
    # Markdown
    ".md":    ("markdown",   Language.MARKDOWN),
    # HTML
    ".html":  ("html",       Language.HTML),
    ".htm":   ("html",       Language.HTML),
    # CSS / SCSS
    ".css":   ("css",        None),
    ".scss":  ("scss",       None),
    # Shell
    ".sh":    ("shell",      None),
    ".bash":  ("shell",      None),
    ".zsh":   ("shell",      None),
    # SQL
    ".sql":   ("sql",        None),
    # YAML
    ".yaml":  ("yaml",       None),
    ".yml":   ("yaml",       None),
    # JSON
    ".json":  ("json",       None),
    # XML
    ".xml":   ("xml",        None),
    # Config / misc
    ".toml":  ("toml",       None),
    ".ini":   ("ini",        None),
    ".cfg":   ("config",     None),
    ".env":   ("env",        None),
    ".txt":   ("text",       None),
    # Proto
    ".proto": ("protobuf",   Language.PROTO),
    # Dart
    ".dart":  ("dart",       None),
}

# Custom separators for languages not in LangChain's Language enum
CUSTOM_SEPARATORS: dict[str, list[str]] = {
    "css": ["\n@media", "\n@keyframes", "\n.", "\n#", "\n:", "\n\n", "\n", " "],
    "scss": ["\n@mixin", "\n@include", "\n@media", "\n.", "\n#", "\n&", "\n\n", "\n", " "],
    "shell": ["\nfunction ", "\n\n", "\n", " "],
    "sql": ["\nCREATE ", "\nALTER ", "\nDROP ", "\nINSERT ", "\nUPDATE ", "\nDELETE ", "\nSELECT ", "\n\n", "\n", " "],
    "yaml": ["\n---", "\n\n", "\n", " "],
    "json": ["\n\n", "\n", " "],
    "xml": ["\n<", "\n\n", "\n", " "],
    "toml": ["\n[", "\n\n", "\n", " "],
    "ini": ["\n[", "\n\n", "\n", " "],
    "config": ["\n[", "\n\n", "\n", " "],
    "env": ["\n\n", "\n"],
    "text": ["\n\n", "\n", " "],
    "dart": ["\nclass ", "\nvoid ", "\nWidget ", "\nFuture<", "\n\n", "\n", " "],
}

# Markdown header config (reused from loader.py)
MD_HEADERS = [
    ("#",    "Header 1"),
    ("##",   "Header 2"),
    ("###",  "Header 3"),
    ("####", "Header 4"),
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_excluded(file_path: str) -> bool:
    """Return True if the file/dir should be skipped."""
    parts = set(Path(file_path).parts)
    if parts & EXCLUDED_DIRS:
        return True
    basename = os.path.basename(file_path)
    if basename in EXCLUDED_FILES:
        return True
    if basename.startswith("."):
        return True
    return False


def _detect_language(file_path: str) -> tuple[str, Language | None]:
    """Detect language from file extension. Returns (label, LangChain Language or None)."""
    ext = Path(file_path).suffix.lower()
    return EXTENSION_MAP.get(ext, ("unknown", None))


def _get_splitter(lang_label: str, lang_enum: Language | None) -> RecursiveCharacterTextSplitter:
    """
    Build a RecursiveCharacterTextSplitter with language-appropriate separators.
    Uses LangChain's built-in from_language() when available, falls back to custom separators.
    """
    if lang_enum is not None:
        return RecursiveCharacterTextSplitter.from_language(
            language=lang_enum,
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )

    separators = CUSTOM_SEPARATORS.get(lang_label, ["\n\n", "\n", " "])
    return RecursiveCharacterTextSplitter(
        separators=separators,
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
    )


# ── Core: Scan and Chunk Source Code ──────────────────────────────────────────

def scan_source_code(
    folder_path: str,
    project_name: str | None = None,
) -> tuple[list[Document], dict[str, int]]:
    """
    Scan a source code directory and chunk all recognized files.

    Args:
        folder_path: Absolute path to the source code folder.
        project_name: Human-readable project name (defaults to folder basename).

    Returns:
        (chunks, lang_stats) where:
          - chunks: list of LangChain Document objects ready for embedding
          - lang_stats: dict mapping language label → file count
    """
    folder = Path(folder_path)
    if not folder.is_dir():
        raise FileNotFoundError(f"Source code folder not found: {folder_path}")

    proj_name = project_name or folder.name
    all_chunks: list[Document] = []
    lang_stats: dict[str, int] = {}
    files_processed = 0

    md_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=MD_HEADERS)

    for root, dirs, files in os.walk(folder_path):
        # Filter out excluded directories in-place
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS and not d.startswith(".")]

        for fname in sorted(files):
            file_path = os.path.join(root, fname)

            # Skip excluded files
            if _is_excluded(file_path):
                continue

            # Skip unknown extensions
            lang_label, lang_enum = _detect_language(file_path)
            if lang_label == "unknown":
                continue

            # Skip oversized files
            try:
                fsize = os.path.getsize(file_path)
                if fsize > MAX_FILE_SIZE_BYTES:
                    logger.debug("[CODE SKIP] {} — too large ({:.0f}KB)", fname, fsize / 1024)
                    continue
                if fsize == 0:
                    continue
            except OSError:
                continue

            # Read file content
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception as exc:
                logger.error("[CODE ERROR] reading {}: {}", file_path, exc)
                continue

            if not content.strip():
                continue

            # Relative path for cleaner metadata
            rel_path = os.path.relpath(file_path, folder_path)

            # Split based on language
            if lang_label == "markdown":
                md_splits = md_splitter.split_text(content)
                text_splitter = RecursiveCharacterTextSplitter(
                    chunk_size=settings.chunk_size,
                    chunk_overlap=settings.chunk_overlap,
                )
                chunks = (
                    text_splitter.split_documents(md_splits)
                    if md_splits
                    else text_splitter.create_documents([content])
                )
            else:
                splitter = _get_splitter(lang_label, lang_enum)
                chunks = splitter.create_documents([content])

            # Annotate each chunk
            for chunk in chunks:
                chunk.metadata.update({
                    "source": file_path,
                    "file_name": fname,
                    "rel_path": rel_path,
                    "language": lang_label,
                    "project": proj_name,
                    "content_type": "source_code",
                })

                prefix = f"[PROJECT: {proj_name}]\n[FILE: {rel_path}]\n[LANG: {lang_label}]"
                chunk.page_content = prefix + "\n\n" + chunk.page_content

            all_chunks.extend(chunks)
            lang_stats[lang_label] = lang_stats.get(lang_label, 0) + 1
            files_processed += 1

            logger.debug("[CODE OK] {} ({}) → {} chunks", rel_path, lang_label, len(chunks))

    logger.info(
        "[CODE SCAN] {} — {} files → {} chunks | langs: {}",
        proj_name, files_processed, len(all_chunks),
        ", ".join(f"{k}:{v}" for k, v in sorted(lang_stats.items())),
    )
    return all_chunks, lang_stats


def resolve_sibling_folder(folder_name: str) -> str:
    """
    Resolve a folder name to an absolute path as a sibling of this RAG project.
    The RAG project is at: .../rag-production-system/
    Sibling folders are at: .../
    """
    rag_root = Path(__file__).resolve().parent.parent.parent  # core/ingestion/ → project root
    parent = rag_root.parent  # go up one level to the common parent
    target = parent / folder_name

    if not target.is_dir():
        available = [
            d.name for d in parent.iterdir()
            if d.is_dir() and d.name != rag_root.name and not d.name.startswith(".")
        ]
        raise FileNotFoundError(
            f"Folder '{folder_name}' not found at {parent}.\n"
            f"Available folders: {', '.join(available) or 'none'}"
        )

    return str(target)


def list_sibling_folders() -> list[str]:
    """List all sibling folders of this RAG project (excluding hidden dirs)."""
    rag_root = Path(__file__).resolve().parent.parent.parent
    parent = rag_root.parent
    return sorted([
        d.name for d in parent.iterdir()
        if d.is_dir()
        and d.name != rag_root.name
        and not d.name.startswith(".")
    ])
