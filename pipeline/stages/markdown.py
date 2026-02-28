"""Stage 2: Convert PDF to structured markdown via Gemini Flash."""

import base64
import logging

from google import genai
from google.genai import types

from config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

CONVERT_PROMPT = """Convert this academic PDF into clean, well-structured markdown. Follow these rules:

1. Use proper markdown headers (# for title, ## for sections, ### for subsections)
2. Preserve all technical content: equations, formulas, data, metrics, method names
3. Format tables as markdown tables
4. Skip these sections entirely: References, Bibliography, Acknowledgements, Table of Contents
5. Skip page headers, footers, and page numbers
6. Keep figure/table captions but note them as [Figure X] or [Table X]

Return ONLY the markdown content, no explanations."""


async def convert_pdf_to_markdown(pdf_bytes: bytes) -> str:
    """
    Send PDF to Gemini Flash and get back structured markdown.

    Returns the markdown string.
    """
    if not GEMINI_API_KEY:
        raise RuntimeError("No GEMINI_API_KEY set, cannot convert PDF")

    logger.info("[markdown] Sending PDF (%d bytes) to Gemini Flash for conversion", len(pdf_bytes))

    client = genai.Client(api_key=GEMINI_API_KEY)

    pdf_part = types.Part.from_bytes(
        data=pdf_bytes,
        mime_type="application/pdf",
    )

    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[CONVERT_PROMPT, pdf_part],
    )

    markdown = response.text
    if not markdown or not markdown.strip():
        raise RuntimeError("Gemini returned empty markdown for PDF")

    word_count = len(markdown.split())
    logger.info("[markdown] Conversion complete: %d chars, ~%d words", len(markdown), word_count)
    return markdown
