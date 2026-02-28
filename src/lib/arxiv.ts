const ARXIV_ID_PATTERN =
  /^(?:([a-z-]+(?:\.[a-z-]+)?\/\d{7})|(\d{4}\.\d{4,5}))(?:v\d+)?(?:\.pdf)?$/i;

function parseArxivId(value: string): string | null {
  const match = value.trim().match(ARXIV_ID_PATTERN);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

export function isArxivUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(^|\.)arxiv\.org$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Extract the arXiv ID from a URL or raw arXiv ID.
 * Handles formats like:
 *   https://arxiv.org/abs/2301.12345
 *   https://arxiv.org/pdf/2301.12345
 *   https://arxiv.org/pdf/2301.12345.pdf
 *   https://arxiv.org/pdf/2301.12345v2
 *   https://arxiv.org/pdf/2301.12345v2.pdf
 *   2301.12345
 */
export function extractArxivId(urlOrId: string): string | null {
  const directId = parseArxivId(urlOrId);
  if (directId) return directId;
  if (!isArxivUrl(urlOrId)) return null;

  try {
    const parsed = new URL(urlOrId);
    const pathname = parsed.pathname.replace(/^\/+/, "");
    const segments = pathname.split("/");
    if (segments.length < 2) return null;

    const [kind, ...rest] = segments;
    if (kind !== "abs" && kind !== "pdf") return null;
    return parseArxivId(rest.join("/"));
  } catch {
    return null;
  }
}

export function toCanonicalArxivPdfUrl(urlOrId: string): string | null {
  const arxivId = extractArxivId(urlOrId);
  if (!arxivId) return null;
  return `https://arxiv.org/pdf/${arxivId}.pdf`;
}
