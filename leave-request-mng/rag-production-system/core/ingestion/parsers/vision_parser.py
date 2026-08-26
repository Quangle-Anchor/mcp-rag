"""
core/ingestion/parsers/vision_parser.py — PDF & Image → Markdown via Vision LLM.

Pipeline per file:
  PDF:
    1. Open with PyMuPDF (fitz)
    2. Classify each page by text density:
       - Digital (chars > 50, image_ratio < 0.3) → extract text directly
       - Scanned/Hybrid → render 300 DPI image → Gemini Vision OCR
    3. Concatenate all pages → single Markdown string

  Image (png/jpg/webp):
    1. Load with Pillow
    2. Send to Gemini Vision → return Markdown

Uses the same Google API key + tenacity retry pattern as embeddings.py.
"""
from __future__ import annotations

import io
import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

import pymupdf  # PyMuPDF
from loguru import logger
from PIL import Image
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from config import get_settings

settings = get_settings()

# ── Constants ─────────────────────────────────────────────────────────────────

RENDER_DPI: int = 300  # Quality-first: 300 DPI for best OCR accuracy

# Page classification thresholds
DIGITAL_MIN_CHARS: int = 50      # Minimum extractable chars for "digital" page
DIGITAL_MAX_IMG_RATIO: float = 0.3  # Max image area ratio for "digital" page
SCANNED_MIN_IMG_RATIO: float = 0.7  # Min image area ratio for "scanned" page
SCANNED_MAX_CHARS: int = 10      # Max chars for "scanned" page

# Supported file extensions
PDF_EXTENSIONS: set[str] = {".pdf"}
IMAGE_EXTENSIONS: set[str] = {".png", ".jpg", ".jpeg", ".webp"}
VISUAL_EXTENSIONS: set[str] = PDF_EXTENSIONS | IMAGE_EXTENSIONS


# ── Vision OCR System Prompt ──────────────────────────────────────────────────

VISION_SYSTEM_PROMPT = """You are an expert document parsing and OCR extraction engine specialized in high-precision layout recognition.

Your task is to analyze the provided page image and extract all content into structured, clean Markdown format. Follow these strict rules:

1. Text Accuracy & Completeness:
- Transcribe all text verbatim without summarizing, rephrasing, or omitting any sentences.
- Maintain full accuracy for Vietnamese diacritics, special characters, and numeric values.

2. Structure & Visual Hierarchy:
- Identify headings and apply appropriate Markdown headers (#, ##, ###) corresponding to the visual hierarchy on the page.
- Preserve paragraphs, lists (bulleted/numbered), and indentation where applicable.

3. Tables & Key-Value Pairs:
- Extract all tabular data into standard Markdown table format (| Column 1 | Column 2 |).
- Align columns properly and retain exact table headers.
- If a table has merged cells or complex structures, represent them as accurately as possible within Markdown table constraints or structured nested lists.

4. Noise Filtering (Signatures, Stamps, Artifacts):
- Completely ignore and filter out physical stamps (e.g., red corporate seals), ink marks, background watermarks, and handwritten signatures overlaid on printed text.
- Extract only the underlying printed or written textual content.

5. Output Format:
- Return ONLY the clean Markdown content.
- Do NOT wrap your response in introductory phrases, explanations, or concluding remarks (e.g., do not write "Here is the extracted text:")."""


# ── Page Classification ───────────────────────────────────────────────────────

class PageType(str, Enum):
    digital = "digital"    # Text-rich, extract directly
    scanned = "scanned"    # Image-only, needs Vision OCR
    hybrid = "hybrid"      # Mixed, send to Vision for layout preservation


@dataclass
class PageAnalysis:
    page_num: int
    page_type: PageType
    char_count: int
    image_area_ratio: float


def classify_page(page: pymupdf.Page) -> PageAnalysis:
    """
    Classify a PDF page by measuring text density vs image coverage.

    Returns PageAnalysis with the classification and metrics.
    """
    # Count extractable text characters
    text = page.get_text("text")
    char_count = len(text.strip())

    # Calculate image area ratio
    page_rect = page.rect
    page_area = page_rect.width * page_rect.height

    image_area = 0.0
    for img in page.get_images(full=True):
        try:
            bbox = page.get_image_bbox(img)
            if bbox:
                image_area += bbox.width * bbox.height
        except Exception:
            pass

    image_ratio = image_area / page_area if page_area > 0 else 0.0

    # Classify
    if char_count > DIGITAL_MIN_CHARS and image_ratio < DIGITAL_MAX_IMG_RATIO:
        page_type = PageType.digital
    elif char_count < SCANNED_MAX_CHARS and image_ratio >= SCANNED_MIN_IMG_RATIO:
        page_type = PageType.scanned
    else:
        page_type = PageType.hybrid

    return PageAnalysis(
        page_num=page.number + 1,
        page_type=page_type,
        char_count=char_count,
        image_area_ratio=round(image_ratio, 3),
    )


# ── Gemini Vision OCR ─────────────────────────────────────────────────────────

def _is_rate_limit_error(exc: BaseException) -> bool:
    """Reuse the same detection logic as embeddings.py."""
    msg = str(exc).lower()
    return (
        "429" in msg
        or "quota" in msg
        or "rate limit" in msg
        or "resource exhausted" in msg
        or "too many requests" in msg
    )


def _get_vision_model():
    """Lazy-init Gemini Vision model (cached on first call)."""
    import google.generativeai as genai

    if settings.google_api_key:
        os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)
        genai.configure(api_key=settings.google_api_key)

    return genai.GenerativeModel(settings.vision_model)


# Module-level cache for the vision model instance
_vision_model = None


def _get_cached_vision_model():
    global _vision_model
    if _vision_model is None:
        _vision_model = _get_vision_model()
    return _vision_model


@retry(
    retry=retry_if_exception(_is_rate_limit_error),
    wait=wait_exponential(multiplier=2, min=16, max=120),
    stop=stop_after_attempt(6),
    reraise=True,
)
def _vision_ocr(image: Image.Image, page_label: str = "") -> str:
    """
    Send a single image to Gemini Vision and return extracted Markdown text.

    Uses tenacity retry with exponential backoff on 429 errors.
    """
    model = _get_cached_vision_model()

    response = model.generate_content(
        [VISION_SYSTEM_PROMPT, image],
        generation_config={
            "max_output_tokens": 8192,
            "temperature": 0.0,  # Deterministic extraction
        },
    )

    text = response.text.strip() if response.text else ""

    # Strip markdown code fences if the model wraps output in ```markdown ... ```
    if text.startswith("```markdown"):
        text = text[len("```markdown"):].strip()
    if text.startswith("```"):
        text = text[3:].strip()
    if text.endswith("```"):
        text = text[:-3].strip()

    logger.info(
        "[VISION] {} → {} chars extracted",
        page_label, len(text),
    )
    return text


# ── PDF Page Rendering ────────────────────────────────────────────────────────

def _render_page_to_image(page: pymupdf.Page) -> Image.Image:
    """Render a PDF page to a PIL Image at RENDER_DPI."""
    pixmap = page.get_pixmap(dpi=RENDER_DPI)
    img_data = pixmap.tobytes("png")
    return Image.open(io.BytesIO(img_data))


# ── Main Entry Points ─────────────────────────────────────────────────────────

def parse_pdf(file_path: str) -> str:
    """
    Parse a PDF file into Markdown using hybrid text density routing.

    Digital pages → direct text extraction (free, instant).
    Scanned/Hybrid pages → render 300 DPI → Gemini Vision OCR.

    Returns the full document as a single Markdown string.
    """
    doc = pymupdf.open(file_path)
    file_name = Path(file_path).name
    total_pages = len(doc)

    logger.info("[PDF] Opening '{}' — {} pages", file_name, total_pages)

    page_contents: list[str] = []
    stats = {"digital": 0, "scanned": 0, "hybrid": 0}

    for page in doc:
        analysis = classify_page(page)
        stats[analysis.page_type.value] += 1
        page_label = f"[{file_name} p{analysis.page_num}/{total_pages}]"

        if analysis.page_type == PageType.digital:
            # Direct text extraction — free, instant
            text = page.get_text("text").strip()
            logger.debug(
                "{} [DIGITAL] {} chars extracted directly",
                page_label, len(text),
            )
            if text:
                page_contents.append(text)

        else:
            # Scanned or Hybrid — render image → Vision OCR
            logger.info(
                "{} [{}] chars={}, img_ratio={:.1%} → sending to Vision OCR",
                page_label,
                analysis.page_type.value.upper(),
                analysis.char_count,
                analysis.image_area_ratio,
            )
            try:
                img = _render_page_to_image(page)
                ocr_text = _vision_ocr(img, page_label)
                if ocr_text:
                    page_contents.append(ocr_text)
            except Exception as exc:
                logger.error("{} Vision OCR failed: {}", page_label, exc)
                # Fallback: try direct text extraction even for scanned pages
                fallback_text = page.get_text("text").strip()
                if fallback_text:
                    page_contents.append(fallback_text)
                    logger.warning("{} Using fallback text ({} chars)", page_label, len(fallback_text))

    doc.close()

    logger.info(
        "[PDF] '{}' complete — {} digital, {} scanned, {} hybrid pages",
        file_name, stats["digital"], stats["scanned"], stats["hybrid"],
    )

    return "\n\n---\n\n".join(page_contents)


def parse_image(file_path: str) -> str:
    """
    Parse a standalone image file (PNG/JPG/WEBP) into Markdown via Vision OCR.
    """
    file_name = Path(file_path).name
    logger.info("[IMAGE] Processing '{}'", file_name)

    img = Image.open(file_path)

    # Convert RGBA to RGB if needed (Gemini doesn't accept RGBA)
    if img.mode == "RGBA":
        img = img.convert("RGB")

    return _vision_ocr(img, f"[{file_name}]")


def parse_visual_file(file_path: str) -> str:
    """
    Main entry point: parse a PDF or image file into Markdown.

    Dispatches to parse_pdf() or parse_image() based on file extension.

    Args:
        file_path: Absolute path to the PDF or image file.

    Returns:
        Full document content as a Markdown string, ready for chunking.

    Raises:
        ValueError: If the file extension is not supported.
    """
    ext = Path(file_path).suffix.lower()

    if ext in PDF_EXTENSIONS:
        return parse_pdf(file_path)
    elif ext in IMAGE_EXTENSIONS:
        return parse_image(file_path)
    else:
        raise ValueError(
            f"Unsupported visual file type '{ext}'. "
            f"Supported: {VISUAL_EXTENSIONS}"
        )
