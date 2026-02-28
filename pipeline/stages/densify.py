"""Stage 3: Section-by-section densification via Gemini."""

import asyncio
import logging
import re

from google import genai

from config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

DENSIFY_PROMPT = """You are a scientific text densifier. Your job is to compress this section of an academic paper while preserving ALL:
- Key findings, results, and conclusions
- Numerical data, metrics, and measurements
- Mathematical formulas and equations
- Method names and technical terminology
- Comparisons and rankings

Remove:
- Filler phrases ("It is well known that...", "In this section we...")
- Redundant explanations of basic concepts
- Verbose transitions between ideas
- Self-referential text ("As shown in Table 3...")

Return ONLY the densified text in markdown format. Keep section headers. Aim for ~40-60% of the original length.

Section to densify:
"""


def _split_by_headers(markdown: str) -> list[tuple[str, str]]:
    """Split markdown into (header, body) pairs by # or ## headers."""
    sections: list[tuple[str, str]] = []
    current_header = ""
    current_body: list[str] = []

    for line in markdown.split("\n"):
        if re.match(r"^#{1,2}\s+", line):
            if current_header or current_body:
                sections.append((current_header, "\n".join(current_body).strip()))
            current_header = line
            current_body = []
        else:
            current_body.append(line)

    if current_header or current_body:
        sections.append((current_header, "\n".join(current_body).strip()))

    return sections


async def _densify_section(client: genai.Client, header: str, body: str) -> str:
    """Densify a single section via Gemini."""
    section_text = f"{header}\n{body}" if header else body
    try:
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=DENSIFY_PROMPT + section_text,
        )
        result = response.text
        if result and result.strip():
            return result.strip()
        return section_text
    except Exception as e:
        logger.warning("Densification failed for section '%s': %s", header[:50], e)
        return section_text


async def densify_markdown(markdown: str) -> str:
    """
    Densify markdown section-by-section using Gemini.

    Processes sections in parallel (max 3 concurrent).
    Falls back to original markdown if Gemini fails.
    """
    if not GEMINI_API_KEY:
        logger.warning("No GEMINI_API_KEY set, skipping densification")
        return markdown

    sections = _split_by_headers(markdown)
    if not sections:
        return markdown

    client = genai.Client(api_key=GEMINI_API_KEY)
    semaphore = asyncio.Semaphore(4)

    async def process_section(header: str, body: str) -> str:
        if len(body) < 100:
            if header:
                return f"{header}\n{body}"
            return body
        async with semaphore:
            return await _densify_section(client, header, body)

    results = await asyncio.gather(
        *(process_section(header, body) for header, body in sections)
    )

    return "\n\n".join(results)
