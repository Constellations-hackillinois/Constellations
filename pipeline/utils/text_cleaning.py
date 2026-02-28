"""Regex-based section stripping for extracted PDF text."""

import re


def strip_references(text: str) -> str:
    """Remove the References / Bibliography section and everything after it."""
    pattern = re.compile(
        r"\n\s*(?:References|Bibliography|Works\s+Cited)\s*\n",
        re.IGNORECASE,
    )
    m = pattern.search(text)
    if m:
        return text[: m.start()].rstrip()
    return text


def strip_acknowledgements(text: str) -> str:
    """Remove Acknowledgements section (but keep text after it if non-ref)."""
    pattern = re.compile(
        r"\n\s*Acknowledg(?:e)?ments?\s*\n",
        re.IGNORECASE,
    )
    m = pattern.search(text)
    if not m:
        return text
    # Find next section header after acknowledgements
    next_section = re.search(r"\n\s*(?:\d+\.?\s+)?[A-Z][a-z]", text[m.end() :])
    if next_section:
        return text[: m.start()] + text[m.end() + next_section.start() :]
    return text[: m.start()].rstrip()


def strip_table_of_contents(text: str) -> str:
    """Remove table of contents if present near the start."""
    pattern = re.compile(
        r"\n\s*(?:Table\s+of\s+)?Contents?\s*\n",
        re.IGNORECASE,
    )
    m = pattern.search(text[:3000])  # Only look in first 3000 chars
    if not m:
        return text
    # Find next major section header
    next_section = re.search(
        r"\n\s*(?:1\.?\s+|Abstract|Introduction)",
        text[m.end() :],
        re.IGNORECASE,
    )
    if next_section:
        return text[: m.start()] + text[m.end() + next_section.start() :]
    return text


def strip_headers_footers(text: str) -> str:
    """Remove repeated page headers/footers (lines that appear on many pages)."""
    lines = text.split("\n")
    if len(lines) < 20:
        return text
    # Count line occurrences (exact match after stripping)
    from collections import Counter
    stripped = [l.strip() for l in lines]
    counts = Counter(stripped)
    # Lines appearing 3+ times and short (< 80 chars) are likely headers/footers
    repeated = {
        line
        for line, count in counts.items()
        if count >= 3 and 0 < len(line) < 80
    }
    cleaned = [l for l, s in zip(lines, stripped) if s not in repeated]
    return "\n".join(cleaned)


def clean_extracted_text(text: str) -> str:
    """Apply all cleaning steps to extracted PDF text."""
    text = strip_headers_footers(text)
    text = strip_table_of_contents(text)
    text = strip_acknowledgements(text)
    text = strip_references(text)
    # Collapse excessive whitespace
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()
