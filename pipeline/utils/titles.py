"""Helpers for canonical paper title and URL normalization."""

from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

from utils.arxiv import extract_arxiv_id

_LEADING_BRACKET_PREFIXES = re.compile(r"^(?:\s*\[[^\]]+\]\s*)+")


def normalize_paper_title(title: str | None) -> str | None:
    if title is None:
        return None

    trimmed = title.strip()
    if not trimmed:
        return None

    normalized = _LEADING_BRACKET_PREFIXES.sub("", trimmed).strip()
    return normalized or None


def normalize_paper_url(url: str | None) -> str | None:
    if url is None:
        return None

    trimmed = url.strip()
    return trimmed or None


def canonical_paper_key(url: str | None) -> str | None:
    normalized_url = normalize_paper_url(url)
    if not normalized_url:
        return None

    arxiv_id = extract_arxiv_id(normalized_url)
    if arxiv_id:
        return f"https://arxiv.org/pdf/{arxiv_id}.pdf".lower()

    parts = urlsplit(normalized_url)
    if parts.scheme and parts.netloc:
        scheme = parts.scheme.lower()
        hostname = parts.hostname.lower() if parts.hostname else ""
        port = parts.port
        if (scheme == "https" and port == 443) or (scheme == "http" and port == 80):
            netloc = hostname
        elif port:
            netloc = f"{hostname}:{port}"
        else:
            netloc = hostname

        path = parts.path.rstrip("/") or "/"
        return urlunsplit((scheme, netloc, path, parts.query, ""))

    return normalized_url
