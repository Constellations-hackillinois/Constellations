"use server";

const PIPELINE_URL = process.env.PIPELINE_URL || "http://localhost:8000";

/**
 * Trigger the PDF ingestion pipeline for a paper.
 * Fire-and-forget: returns immediately, pipeline runs in background.
 * Returns true if the pipeline accepted the request, false if unavailable.
 */
export async function ingestPaper(
  paperUrl: string,
  paperTitle: string | null,
  constellationId: string
): Promise<boolean> {
  console.log("[pipeline] ingesting paper:", paperUrl, "constellation:", constellationId);
  try {
    const res = await fetch(`${PIPELINE_URL}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paper_url: paperUrl,
        paper_title: paperTitle,
        constellation_id: constellationId,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("[pipeline] ingest failed:", res.status, await res.text());
      return false;
    }
    const data = await res.json();
    console.log("[pipeline] ingest response:", data);
    return true;
  } catch (err) {
    console.error("[pipeline] service unavailable — paper will not be indexed:", paperUrl, err);
    return false;
  }
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

