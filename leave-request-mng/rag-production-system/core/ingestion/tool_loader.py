"""
core/ingestion/tool_loader.py — 3-Layer chunking pipeline for Tool Specification Markdown files.

Auto-discovery:
  When no directory is supplied, _find_tool_specs_dir() searches for a folder
  named 'tool-specs' (case-insensitive) by walking downward from the project
  root and upward through 3 ancestor levels — identical strategy to how
  loader.py locates 'Output/' directories for requirement docs.

Implements the strategy for Mendix Model SDK Tool Specs:

  Layer 1 — Category (File Level):
    Derive a human-readable Category label from the file stem.
    e.g.  pages.md → "Pages"  |  microflows.md → "Microflows"

  Layer 2 — Tool (Primary Semantic Chunk):
    Regex-extract full content between:
      <!-- tool_start id="<int>" name="<str>" -->
      ...tool content...
      <!-- tool_end -->
    Each extracted tool → one independent Document chunk.

  Layer 3 — Section (Sub-chunk for large tools):
    If a tool's estimated token count exceeds TOKEN_THRESHOLD, further split
    using MarkdownHeaderTextSplitter on ### headers
    (e.g. ### Input, ### Behavior, ### Output, ### Error Cases).
    Sub-chunks INHERIT all parent metadata from Layer 2.

Metadata Schema (Pinecone-ready):
  {
    "file_name":  str   — e.g. "pages.md"
    "category":   str   — e.g. "Pages"
    "tool_id":    int   — e.g. 84
    "tool_name":  str   — e.g. "create_page"
    "chunk_type": str   — "full_tool" | "input_schema" | "behavior" | "output" | "error_cases" | ...
    "data_type":  str   — always "tool_spec"  (Pinecone filter: data_type == "tool_spec")
  }

─────────────────────────────────────────────────────────────────────────────────
Mock Input / Output Demo
─────────────────────────────────────────────────────────────────────────────────

  Input file: pages.md
  Raw content:
    <!-- BEGIN TOOL 84: create_page -->
    ## create_page

    Creates a new page in the Mendix model.

    ### Input
    | param | type   | required |
    |-------|--------|----------|
    | name  | string | yes      |
    | title | string | no       |

    ### Behavior
    Validates that `name` is unique across the module, then creates a new
    Page object and appends it to the module's pages list.

    ### Output
    Returns the newly created `pages.Page` object.

    ### Error Cases
    - `DUPLICATE_PAGE_NAME` — a page with the same name already exists.
    - `INVALID_NAME_FORMAT` — name contains illegal characters.
    <!-- END TOOL 84: create_page -->

  Output Documents (tool is small → single full_tool chunk):
    [
      Document(
        page_content="## create_page\n\nCreates a new page...\n\n### Input\n...",
        metadata={
          "file_name":  "pages.md",
          "category":   "Pages",
          "tool_id":    84,
          "tool_name":  "create_page",
          "chunk_type": "full_tool",
          "data_type":  "tool_spec"
        }
      )
    ]

  If the same tool exceeded TOKEN_THRESHOLD, the output would instead be:
    [
      Document(page_content="## create_page\n...\n### Input\n...", metadata={..., "chunk_type": "input_schema"}),
      Document(page_content="### Behavior\n...",                   metadata={..., "chunk_type": "behavior"}),
      Document(page_content="### Output\n...",                     metadata={..., "chunk_type": "output"}),
      Document(page_content="### Error Cases\n...",                metadata={..., "chunk_type": "error_cases"}),
    ]
─────────────────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from langchain_core.documents import Document
from langchain_text_splitters import MarkdownHeaderTextSplitter
from loguru import logger

# ── Constants ─────────────────────────────────────────────────────────────────

# Tools UNDER this threshold → 1 single "full_tool" chunk (no splitting).
# Tools ABOVE this → split into large parts (~MAX_PART_TOKENS each).
#
# Size analysis of all tools in microflows.md:
#   - 8/10 tools are 930-4027 tokens → fit in 1 chunk
#   - 1 tool (microflow_arrange) is 4027 tokens → 1 chunk
#   - 1 tool (create_microflow) is 22,623 tokens → MUST split
#
# Threshold of 6000 tokens ensures only genuinely huge tools get split.
TOKEN_THRESHOLD: int = 2_000
CHAR_THRESHOLD:  int = TOKEN_THRESHOLD * 4   # ~8,000 characters

# Max size per chunk part (for tools exceeding TOKEN_THRESHOLD).
# ~2000 tokens = ~8,000 chars
MAX_PART_CHARS: int = 8_000
PART_OVERLAP_CHARS: int = 200   # small overlap to avoid cutting mid-sentence

# MarkdownHeaderTextSplitter — kept for reference.
SECTION_HEADERS = [("###", "section_header")]

# Normalise raw ### heading text → canonical chunk_type label
SECTION_NAME_MAP: dict[str, str] = {
    "input":          "input_schema",
    "inputs":         "input_schema",
    "input schema":   "input_schema",
    "parameters":     "input_schema",
    "parameter":      "input_schema",
    "behavior":       "behavior",
    "behaviour":      "behavior",
    "logic":          "behavior",
    "output":         "output",
    "outputs":        "output",
    "return value":   "output",
    "return":         "output",
    "returns":        "output",
    "error cases":    "error_cases",
    "errors":         "error_cases",
    "error":          "error_cases",
    "exceptions":     "error_cases",
    "notes":          "notes",
    "note":           "notes",
    "example":        "example",
    "examples":       "example",
    "usage":          "example",
}

# ── Compiled regex patterns ───────────────────────────────────────────────────

# Matches the actual Mendix SDK tool block format:
# <!-- BEGIN TOOL 84: create_page --> ... <!-- END TOOL 84: create_page -->
_TOOL_BLOCK_RE = re.compile(
    r"<!--\s*BEGIN\s+TOOL\s+(\d+):\s*([A-Za-z0-9_\-]+)\s*-->(.*?)<!--\s*END\s+TOOL\b.*?-->",
    re.DOTALL | re.IGNORECASE,
)


# ── Private helpers ───────────────────────────────────────────────────────────

def _file_to_category(file_name: str) -> str:
    """
    Derive a human-readable Category label from the file stem.

    Examples
    --------
    >>> _file_to_category("pages.md")
    'Pages'
    >>> _file_to_category("domain_models.md")
    'Domain Models'
    >>> _file_to_category("cross-cutting-concerns.md")
    'Cross Cutting Concerns'
    """
    stem = Path(file_name).stem
    return stem.replace("_", " ").replace("-", " ").title()


def _normalise_section(raw_header: str) -> str:
    """
    Map a raw ### heading string to a canonical chunk_type label.
    Falls back to a slug-ified version of the header if not in SECTION_NAME_MAP.
    """
    key = raw_header.strip().lower()
    return SECTION_NAME_MAP.get(key, key.replace(" ", "_") or "section")


def _build_context_prefix(
    tool_name: str, category: str, section_label: str, tool_summary: str = "",
) -> str:
    """
    Build a contextual header that is prepended to each sub-chunk.

    This ensures the embedding vector captures the parent tool's identity,
    so searches for 'create_microflow ExclusiveSplit' will find the
    ExclusiveSplit sub-chunk even though the raw content doesn't mention
    'create_microflow'.
    """
    header = f"[TOOL: {tool_name} | CATEGORY: {category} | SECTION: {section_label}]"
    if tool_summary:
        header += f"\nThis section is part of the `{tool_name}` tool. {tool_summary}"
    header += "\n---\n"
    return header


def _extract_tool_summary(tool_content: str, max_chars: int = 200) -> str:
    """
    Extract a brief summary from the first paragraph of a tool block.
    Used as context in sub-chunk headers.
    """
    # Skip the ## heading line, take the first non-empty paragraph
    lines = tool_content.strip().split("\n")
    summary_lines: list[str] = []
    found_start = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if found_start:
                break  # end of first paragraph
            continue
        if stripped.startswith("#"):
            continue  # skip headings
        found_start = True
        summary_lines.append(stripped)
    summary = " ".join(summary_lines)[:max_chars]
    return summary


def _extract_section_names(text: str) -> str:
    """Extract all ### headings from a chunk and return as comma-separated list."""
    headings = re.findall(r"###\s+(.+)", text)
    if not headings:
        return "Overview"
    return ", ".join(h.strip() for h in headings[:8])  # cap at 8


def _estimate_tokens(text: str) -> int:
    """
    Rough token count estimate (no external tokenizer needed).
    Uses the common approximation: 1 token ≈ 4 characters.
    """
    return len(text) // 4


# ── Public API ────────────────────────────────────────────────────────────────

def chunk_tool_file(raw_text: str, file_name: str) -> list[Document]:
    """
    Core 3-layer chunking function for a single Tool Specification Markdown file.

    Parameters
    ----------
    raw_text  : Full text content of the .md file.
    file_name : Base filename (e.g. "pages.md") used for Layer 1 category + metadata.

    Returns
    -------
    List of LangChain Document objects, each with page_content + Pinecone metadata.
    """
    category = _file_to_category(file_name)
    results: list[Document] = []

    tool_blocks = _TOOL_BLOCK_RE.findall(raw_text)
    if not tool_blocks:
        logger.warning(
            "[tool_loader] No <!-- tool_start ... --> blocks found in '{}'. "
            "Ensure tool blocks follow the format: "
            "<!-- tool_start id=\"N\" name=\"fn_name\" --> ... <!-- tool_end -->",
            file_name,
        )
        return results

    for match_id, match_name, tool_content in tool_blocks:
        tool_content = tool_content.strip()

        # ── Layer 1: derive metadata from file name ───────────────────────────
        # (already captured in `category` above)

        # ── Layer 2: parse tool_id and tool_name from HTML comment attrs ──────
        tool_id = int(match_id) if match_id.isdigit() else 0
        tool_name = match_name.strip() or "unknown"

        # Base metadata inherited by all sub-chunks (Layer 3)
        base_meta: dict[str, Any] = {
            "file_name": file_name,
            "category":  category,
            "tool_id":   tool_id,
            "tool_name": tool_name,
            "data_type": "tool_spec",   # discriminator for Pinecone filter
        }

        estimated_tokens = _estimate_tokens(tool_content)
        logger.debug(
            "[tool_loader] Tool id={} name='{}' | ~{} tokens | file='{}'",
            tool_id, tool_name, estimated_tokens, file_name,
        )

        # ── Layer 3: Split large tools into 2-4 BIG parts ────────────────────
        if estimated_tokens > TOKEN_THRESHOLD:
            tool_summary = _extract_tool_summary(tool_content)

            # Use RecursiveCharacterTextSplitter to create 2-4 large parts
            # instead of 35 tiny chunks by ### headers.
            from langchain_text_splitters import RecursiveCharacterTextSplitter

            part_splitter = RecursiveCharacterTextSplitter(
                chunk_size=MAX_PART_CHARS,
                chunk_overlap=PART_OVERLAP_CHARS,
                separators=["\n### ", "\n## ", "\n---\n", "\n\n", "\n"],
                keep_separator=True,
            )
            parts = part_splitter.split_text(tool_content)
            total_parts = len(parts)

            logger.info(
                "[tool_loader] Tool '{}' (~{} tokens) exceeds threshold {} — "
                "splitting into {} large parts (~{} tokens each).",
                tool_name, estimated_tokens, TOKEN_THRESHOLD,
                total_parts, estimated_tokens // max(total_parts, 1),
            )

            for i, part_text in enumerate(parts, 1):
                section_names = _extract_section_names(part_text)
                context_prefix = _build_context_prefix(
                    tool_name=tool_name,
                    category=category,
                    section_label=f"Part {i}/{total_parts}: {section_names}",
                    tool_summary=tool_summary,
                )
                enriched_content = context_prefix + part_text.strip()

                results.append(Document(
                    page_content=enriched_content,
                    metadata={
                        **base_meta,
                        "chunk_type": "tool_part",
                        "part_number": i,
                        "total_parts": total_parts,
                    },
                ))

            logger.info(
                "[tool_loader] Tool '{}' → {} part(s) (with contextual headers).",
                tool_name, total_parts,
            )

        # ── Layer 2: Full tool fits within token limit — one chunk ────────────
        else:
            results.append(Document(
                page_content=tool_content,
                metadata={**base_meta, "chunk_type": "full_tool"},
            ))
            logger.debug("[tool_loader] Tool '{}' → 1 full_tool chunk.", tool_name)

    logger.info(
        "[tool_loader] '{}' complete — {} tool(s) found, {} chunk(s) produced (category='{}').",
        file_name, len(tool_blocks), len(results), category,
    )
    return results


# Target folder names for auto-discovery (all checked case-insensitively)
_TOOL_SPEC_TARGET_NAMES: set[str] = {"tool-specs", "tool_specs", "toolspecs", "tools"}

# Directories to skip during filesystem walks
_WALK_EXCLUDED: set[str] = {
    "node_modules", ".github", ".vscode", "__pycache__",
    "dist", "build", ".git", "coverage", ".idea", "out", "target", ".venv", "venv",
}


def _find_tool_specs_dir(start_dir: str | None = None) -> str | None:
    """
    Auto-discover a directory named 'tool-specs' (case-insensitive).

    Search strategy (mirrors loader.py _find_output_dirs):
      1. Downward from start_dir — unlimited depth (skipping excluded dirs).
      2. Upward through up to 3 ancestor levels, each scanned 3 levels deep.

    Returns the absolute path of the first match, or None if not found.
    """
    script_dir = start_dir or str(Path(__file__).resolve().parent.parent.parent)
    excluded_lower = {e.lower() for e in _WALK_EXCLUDED}

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
    logger.debug("[tool_loader] Auto-discover: scanning downward from '{}'", script_dir)
    for root, dirs, _ in _walk_bounded(script_dir, max_depth=999):
        for d in dirs:
            if d.strip().lower() in _TOOL_SPEC_TARGET_NAMES:
                found = os.path.join(root, d)
                logger.info("[tool_loader] Auto-discovered tool-specs dir (downward): {}", found)
                return found

    # ── 2. Upward scan ────────────────────────────────────────────────────────
    ancestor = script_dir
    for _ in range(3):
        parent = os.path.dirname(ancestor)
        if parent == ancestor:
            break
        try:
            for root, dirs, _ in _walk_bounded(parent, max_depth=3):
                abs_root  = os.path.abspath(root)
                abs_start = os.path.abspath(script_dir)
                try:
                    if os.path.commonpath([abs_root, abs_start]) == abs_start:
                        dirs[:] = []
                        continue
                except ValueError:
                    pass
                for d in dirs:
                    if d.strip().lower() in _TOOL_SPEC_TARGET_NAMES:
                        found = os.path.join(root, d)
                        logger.info(
                            "[tool_loader] Auto-discovered tool-specs dir (upward): {}", found
                        )
                        return found
        except PermissionError:
            pass
        ancestor = parent

    return None


def chunk_tool_directory(tool_docs_dir: str | None = None) -> list[Document]:
    """
    Discover and chunk all *.md files under `tool_docs_dir`.

    If `tool_docs_dir` is None or empty, automatically searches for a folder
    named 'tool-specs' (case-insensitive) near the project root.

    Returns a combined list of Document objects ready for Pinecone upsert.

    Raises
    ------
    FileNotFoundError if the directory cannot be found or does not exist.
    """
    # ── Auto-discovery when no path given ────────────────────────────────────
    if not tool_docs_dir:
        logger.info("[tool_loader] No directory specified — auto-discovering 'tool-specs'...")
        discovered = _find_tool_specs_dir()
        if discovered:
            logger.info("[tool_loader] Using auto-discovered dir: '{}'", discovered)
            tool_docs_dir = discovered
        else:
            searched = str(Path(__file__).resolve().parent.parent.parent)
            raise FileNotFoundError(
                "\n"
                "╔══════════════════════════════════════════════════════════╗\n"
                "║     ❌  NO 'tool-specs' DIRECTORY FOUND                  ║\n"
                "╠══════════════════════════════════════════════════════════╣\n"
                "║  Auto-discovery scanned up/down from:                    ║\n"
                f"║    {searched:<56}║\n"
                "║                                                          ║\n"
                "║  Looking for any folder named (case-insensitive):        ║\n"
                "║    tool-specs  |  tool_specs  |  toolspecs  |  tools     ║\n"
                "║                                                          ║\n"
                "║  ✅ FIX — choose one:                                    ║\n"
                "║    a) Create a folder named 'tool-specs' in your project ║\n"
                "║       and place your .md tool-spec files inside it.      ║\n"
                "║    b) Set TOOL_DOCS_DIR=/path/to/dir in your .env        ║\n"
                "║    c) Pass --tool-dir /path/to/dir on the CLI            ║\n"
                "╚══════════════════════════════════════════════════════════╝"
            )

    tool_dir = Path(tool_docs_dir)
    if not tool_dir.exists():
        raise FileNotFoundError(
            "\n"
            "╔══════════════════════════════════════════════════════════╗\n"
            "║         ❌  TOOL DOCS DIRECTORY NOT FOUND                ║\n"
            "╠══════════════════════════════════════════════════════════╣\n"
            f"║  Path: {str(tool_dir):<54}║\n"
            "║                                                          ║\n"
            "║  Set TOOL_DOCS_DIR in your .env                          ║\n"
            "║  or pass --tool-dir /path/to/tool/specs on the CLI.     ║\n"
            "╚══════════════════════════════════════════════════════════╝"
        )

    md_files = sorted(tool_dir.rglob("*.md"))
    if not md_files:
        logger.warning("[tool_loader] No .md files found in '{}' (or its subdirectories).", tool_docs_dir)
        return []

    all_chunks: list[Document] = []
    for md_file in md_files:
        try:
            content = md_file.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            try:
                content = md_file.read_text(encoding="utf-16")
            except Exception as exc:
                logger.error("[tool_loader] Cannot read '{}' as utf-16: {}", md_file.name, exc)
                continue
        except Exception as exc:
            logger.error("[tool_loader] Cannot read '{}': {}", md_file.name, exc)
            continue
            continue
        chunks = chunk_tool_file(content, md_file.name)
        all_chunks.extend(chunks)

    logger.info(
        "[tool_loader] Scanned {} file(s) under '{}' → {} total tool chunk(s).",
        len(md_files), tool_docs_dir, len(all_chunks),
    )
    return all_chunks


# ── Self-contained demo / smoke test ─────────────────────────────────────────

if __name__ == "__main__":
    _DEMO_MD = """\
# Pages Tools

<!-- BEGIN TOOL 84: create_page -->
## create_page

Creates a new page in the Mendix model.

### Input
| param   | type   | required | description          |
|---------|--------|----------|----------------------|
| name    | string | yes      | Page identifier name |
| title   | string | no       | Human-readable title |
| layout  | string | no       | Layout template name |

### Behavior
Validates that `name` is unique across the module (raises DUPLICATE_PAGE_NAME if not).
Instantiates a `pages.Page` object, sets its `name` and `title` properties,
assigns the specified layout, then appends it to `module.pages`.

### Output
Returns the newly created `pages.Page` SDK object.

### Error Cases
- `DUPLICATE_PAGE_NAME` — a page with the same name already exists in the module.
- `INVALID_NAME_FORMAT` — the page name contains characters outside [A-Za-z0-9_].
- `LAYOUT_NOT_FOUND`    — the specified layout name does not exist.
<!-- END TOOL 84: create_page -->

<!-- BEGIN TOOL 85: delete_page -->
## delete_page

Removes an existing page from the module.

### Input
| param | type   | required |
|-------|--------|----------|
| name  | string | yes      |

### Output
Returns `True` on success.
<!-- END TOOL 85: delete_page -->
"""

    import json

    docs = chunk_tool_file(_DEMO_MD, "pages.md")
    print(f"\n{'=' * 65}")
    print(f"  chunk_tool_file() demo — {len(docs)} document(s) produced")
    print(f"{'=' * 65}\n")
    for i, doc in enumerate(docs, 1):
        print(f"-- Document {i} ----------------------------------------------")
        print(f"  metadata   : {json.dumps(doc.metadata, ensure_ascii=False)}")
        preview = doc.page_content[:120].replace("\n", "\\n")
        print(f"  page_content (preview): {preview!r}")
        print()
