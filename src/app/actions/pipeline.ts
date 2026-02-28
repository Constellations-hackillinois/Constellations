"use server";

const PIPELINE_URL = process.env.PIPELINE_URL || "http://localhost:8000";

const INGEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;

type IngestResult = {
  accepted: boolean;
  reason: string;
  attempts: number;
};

/**
 * Trigger the PDF ingestion pipeline for a paper.
 * Fire-and-forget: returns immediately, pipeline runs in background.
 * Retries up to 3 times with exponential backoff on timeouts and 5xx errors.
 */
export async function ingestPaper(
  paperUrl: string,
  paperTitle: string | null,
  constellationId: string
): Promise<IngestResult> {
  console.log("[pipeline] ingesting paper:", paperUrl, "constellation:", constellationId);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${PIPELINE_URL}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paper_url: paperUrl,
          paper_title: paperTitle,
          constellation_id: constellationId,
        }),
        signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
      });

      if (res.ok) {
        const data = await res.json();
        console.log("[pipeline] ingest response:", data);
        return { accepted: true, reason: "accepted", attempts: attempt };
      }

      const body = await res.text();

      // Don't retry client errors (4xx) — they won't resolve on retry
      if (res.status >= 400 && res.status < 500) {
        console.error("[pipeline] ingest rejected (4xx):", res.status, body);
        return { accepted: false, reason: `rejected: ${res.status}`, attempts: attempt };
      }

      // 5xx — retryable
      console.warn(`[pipeline] ingest attempt ${attempt}/${MAX_ATTEMPTS} failed: ${res.status} ${body}`);
    } catch (err) {
      // Timeout or network error — retryable
      console.warn(`[pipeline] ingest attempt ${attempt}/${MAX_ATTEMPTS} error:`, err);
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[pipeline] retrying in ${delay}ms…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  console.error("[pipeline] service unavailable after retries — paper will not be indexed:", paperUrl);
  return { accepted: false, reason: "all attempts failed", attempts: MAX_ATTEMPTS };
}

/**
 * Check the processing status of a paper in the pipeline.
 */
export async function getPipelineStatus(
  arxivId: string
): Promise<{ found: boolean; status?: string; error_message?: string } | null> {
  try {
    const res = await fetch(`${PIPELINE_URL}/status/${encodeURIComponent(arxivId)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

