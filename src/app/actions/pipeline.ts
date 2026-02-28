"use server";

import { storeDocument } from "@/app/actions/supermemory";

/**
 * Ingest a paper into Supermemory for RAG search.
 * Wraps storeDocument with an optional title parameter for future metadata use.
 */
export async function ingestPaper(
  paperUrl: string,
  _paperTitle: string | null,
  constellationId: string
): Promise<string> {
  return storeDocument(paperUrl, constellationId);
}
