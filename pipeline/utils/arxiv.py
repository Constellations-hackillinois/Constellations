"""arXiv ID parsing - Python port of src/lib/arxiv.ts."""

import re
from urllib.parse import urlparse

_ARXIV_ID_PATTERN = re.compile(
    r"^(?:([a-z-]+(?:\.[a-z-]+)?/\d{7})|(\d{4}\.\d{4,5}))(?:v\d+)?(?:\.pdf)?$",
    re.IGNORECASE,
)


def _parse_arxiv_id(value: str) -> str | None:
    m = _ARXIV_ID_PATTERN.match(value.strip())
    if not m:
        return None
    return m.group(1) or m.group(2) or None


def is_arxiv_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return bool(re.search(r"(^|\.)arxiv\.org$", parsed.hostname or "", re.IGNORECASE))
    except Exception:
        return False


def extract_arxiv_id(url_or_id: str) -> str | None:
    """Extract the arXiv ID from a URL or raw arXiv ID string."""
    direct = _parse_arxiv_id(url_or_id)
    if direct:
        return direct
    if not is_arxiv_url(url_or_id):
        return None
    try:
        parsed = urlparse(url_or_id)
        pathname = (parsed.path or "").lstrip("/")
        segments = pathname.split("/")
        if len(segments) < 2:
            return None
        kind = segments[0]
        if kind not in ("abs", "pdf"):
            return None
        return _parse_arxiv_id("/".join(segments[1:]))
    except Exception:
        return None


def to_canonical_pdf_url(url_or_id: str) -> str | None:
    """Normalize to standard arXiv PDF URL."""
    arxiv_id = extract_arxiv_id(url_or_id)
    if not arxiv_id:
        return None
    return f"https://arxiv.org/pdf/{arxiv_id}.pdf"
