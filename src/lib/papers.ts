import { toCanonicalArxivPdfUrl } from "@/lib/arxiv";

const LEADING_BRACKET_PREFIXES = /^(?:\s*\[[^\]]+\]\s*)+/;

export interface PaperTitleRecord {
  depth?: number | null;
  paperTitle: string | null;
  paperUrl: string | null;
}

export function normalizePaperTitle(title: string | null | undefined): string | null {
  if (title == null) return null;
  const trimmed = title.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(LEADING_BRACKET_PREFIXES, "").trim();
  return normalized || null;
}

export function normalizeRequiredTitle(
  title: string | null | undefined,
  fallback = "Untitled"
): string {
  const normalized = normalizePaperTitle(title);
  if (normalized) return normalized;

  const trimmed = title?.trim() ?? "";
  if (trimmed && !LEADING_BRACKET_PREFIXES.test(trimmed)) {
    return trimmed;
  }

  return fallback;
}

export function normalizePaperUrl(url: string | null | undefined): string | null {
  if (url == null) return null;
  const trimmed = url.trim();
  return trimmed || null;
}

export function canonicalPaperKeyFromUrl(url: string | null | undefined): string | null {
  const normalizedUrl = normalizePaperUrl(url);
  if (!normalizedUrl) return null;

  const canonicalArxivUrl = toCanonicalArxivPdfUrl(normalizedUrl);
  if (canonicalArxivUrl) return canonicalArxivUrl.toLowerCase();

  try {
    const parsed = new URL(normalizedUrl);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")
    ) {
      parsed.port = "";
    }
    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString();
  } catch {
    return normalizedUrl;
  }
}

export function reconcilePaperTitleRecords<T extends PaperTitleRecord>(
  records: T[],
  rootOverride?: { paperTitle?: string | null; paperUrl?: string | null }
): T[] {
  const normalizedRecords = records.map((record) => ({
    ...record,
    paperTitle: normalizePaperTitle(record.paperTitle),
    paperUrl: normalizePaperUrl(record.paperUrl),
  }));

  const rootOverrideTitle = normalizePaperTitle(rootOverride?.paperTitle);
  const rootOverrideUrl = normalizePaperUrl(rootOverride?.paperUrl);
  const rootOverrideKey = canonicalPaperKeyFromUrl(rootOverrideUrl);

  const titleByKey = new Map<string, string>();
  if (rootOverrideTitle && rootOverrideKey) {
    titleByKey.set(rootOverrideKey, rootOverrideTitle);
  }

  for (const record of normalizedRecords) {
    const key = canonicalPaperKeyFromUrl(record.paperUrl);
    if (!key || !record.paperTitle || titleByKey.has(key)) continue;
    titleByKey.set(key, record.paperTitle);
  }

  return normalizedRecords.map((record) => {
    const next = { ...record };

    if (next.depth === 0 && rootOverrideUrl && !next.paperUrl) {
      next.paperUrl = rootOverrideUrl;
    }

    const key = canonicalPaperKeyFromUrl(next.paperUrl);
    if (
      next.depth === 0 &&
      rootOverrideTitle &&
      (!key || !rootOverrideKey || key === rootOverrideKey || !next.paperTitle)
    ) {
      next.paperTitle = rootOverrideTitle;
    }

    const canonicalKey = canonicalPaperKeyFromUrl(next.paperUrl);
    if (canonicalKey) {
      const canonicalTitle = titleByKey.get(canonicalKey);
      if (canonicalTitle) {
        next.paperTitle = canonicalTitle;
      }
    }

    next.paperTitle = normalizePaperTitle(next.paperTitle);
    next.paperUrl = normalizePaperUrl(next.paperUrl);
    return next;
  });
}
