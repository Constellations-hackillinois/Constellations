"""Stage 2: Convert PDF to structured markdown via Gemini Flash."""

import asyncio
import logging

import fitz
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


def _split_pdf_into_chunks(pdf_bytes: bytes, pages_per_chunk: int = 5) -> list[bytes]:
    """Split a PDF into chunks of `pages_per_chunk` pages, returned as PDF bytes."""
    src = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(src)
    chunks: list[bytes] = []

    for start in range(0, total_pages, pages_per_chunk):
        end = min(start + pages_per_chunk, total_pages)
        chunk_doc = fitz.open()
        chunk_doc.insert_pdf(src, from_page=start, to_page=end - 1)
        chunks.append(chunk_doc.tobytes())
        chunk_doc.close()

    src.close()
    logger.info("[markdown] Split PDF (%d pages) into %d chunks of up to %d pages",
                total_pages, len(chunks), pages_per_chunk)
    return chunks


async def _convert_chunk(client: genai.Client, chunk_bytes: bytes, chunk_index: int) -> str:
    """Convert a single PDF chunk to markdown via Gemini."""
    logger.info("[markdown] Converting chunk %d (%d bytes)", chunk_index, len(chunk_bytes))

    pdf_part = types.Part.from_bytes(
        data=chunk_bytes,
        mime_type="application/pdf",
    )

    response = await client.aio.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[CONVERT_PROMPT, pdf_part],
    )

    result = response.text
    if not result or not result.strip():
        logger.warning("[markdown] Chunk %d returned empty markdown, skipping", chunk_index)
        return ""

    logger.info("[markdown] Chunk %d done: %d chars", chunk_index, len(result))
    return result.strip()


async def convert_pdf_to_markdown(pdf_bytes: bytes) -> str:
    """
    Send PDF to Gemini Flash and get back structured markdown.

    Splits large PDFs into 5-page chunks and processes them in parallel
    (max 3 concurrent) to avoid token limits and improve quality.
    """
    if not GEMINI_API_KEY:
        raise RuntimeError("No GEMINI_API_KEY set, cannot convert PDF")

    logger.info("[markdown] Sending PDF (%d bytes) to Gemini Flash for conversion", len(pdf_bytes))

    client = genai.Client(api_key=GEMINI_API_KEY)
    chunks = _split_pdf_into_chunks(pdf_bytes)

    if len(chunks) == 1:
        results = [await _convert_chunk(client, chunks[0], 0)]
    else:
        semaphore = asyncio.Semaphore(8)

        async def limited_convert(idx: int, chunk: bytes) -> str:
            async with semaphore:
                return await _convert_chunk(client, chunk, idx)

        results = await asyncio.gather(
            *(limited_convert(i, chunk) for i, chunk in enumerate(chunks))
        )

    empty_count = sum(1 for r in results if not r)
    if empty_count > len(results) // 2:
        raise RuntimeError(
            f"Too many empty chunks: {empty_count}/{len(results)} returned empty markdown"
        )
    if empty_count:
        logger.warning("[markdown] %d/%d chunks were empty, continuing with the rest",
                       empty_count, len(results))

    markdown = "\n\n".join(r for r in results if r)

    word_count = len(markdown.split())
    logger.info("[markdown] Conversion complete: %d chars, ~%d words", len(markdown), word_count)
    return markdown
