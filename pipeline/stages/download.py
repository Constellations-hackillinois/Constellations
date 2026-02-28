"""Stage 1: Download PDF from arXiv."""

import logging

import httpx

from config import PDF_CACHE
from utils.arxiv import to_canonical_pdf_url

logger = logging.getLogger(__name__)


async def download_pdf(arxiv_id: str, paper_url: str) -> dict:
    """
    Download the arXiv PDF.

    Returns dict with keys: pdf_path, pdf_bytes.
    """
    pdf_url = to_canonical_pdf_url(paper_url)
    if not pdf_url:
        raise ValueError(f"Cannot derive PDF URL from: {paper_url}")

    pdf_path = PDF_CACHE / f"{arxiv_id.replace('/', '_')}.pdf"

    # Download if not cached
    if not pdf_path.exists():
        logger.info("[download] Downloading %s -> %s", pdf_url, pdf_path)
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
            resp = await client.get(pdf_url)
            resp.raise_for_status()
            pdf_path.write_bytes(resp.content)
            logger.info("[download] Downloaded %d bytes", len(resp.content))
    else:
        logger.info("[download] Using cached PDF: %s", pdf_path)

    pdf_bytes = pdf_path.read_bytes()
    logger.info("[download] PDF ready: %s (%d bytes)", pdf_path, len(pdf_bytes))

    return {
        "pdf_path": str(pdf_path),
        "pdf_bytes": pdf_bytes,
    }
