"use server";

import { GoogleGenAI } from "@google/genai";
import { extractArxivId } from "@/lib/arxiv";

const SUPERMEMORY_BASE = "https://api.supermemory.ai";

async function supermemoryFetch(path: string, body: object) {
  const res = await fetch(`${SUPERMEMORY_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supermemory ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Derive a stable document key from a URL.
 * Uses arxiv ID if available, otherwise the full URL.
 */
function docKeyFromUrl(url: string): string {
  return extractArxivId(url) ?? url;
}

/**
 * Store a document in supermemory. Fire-and-forget — errors are logged only.
 */
export async function storeDocument(docUrl: string) {
  const key = docKeyFromUrl(docUrl);

  try {
    const storeResult = await supermemoryFetch("/v3/documents", {
      content: docUrl,
      metadata: { doc_key: key },
    });
    console.log("[supermemory] Stored document:", key, storeResult);
  } catch (err) {
    console.error("[supermemory] storeDocument failed:", err);
  }
}

/**
 * RAG search scoped to a single paper. Returns a synthesized answer string.
 */
export async function ragSearchPerPaper(
  query: string,
  paperUrl: string,
  paperTitle: string
): Promise<string> {
  const key = docKeyFromUrl(paperUrl);

  try {
    const searchResult = await supermemoryFetch("/v3/search", {
      q: query,
      filters: {
        AND: [{ filterType: "metadata", key: "doc_key", value: key }],
      },
      limit: 5,
    });

    const chunks: string[] = (searchResult.results ?? []).flatMap(
      (r: { chunks?: { content: string }[] }) =>
        (r.chunks ?? []).map((c) => c.content)
    );

    if (chunks.length === 0 || chunks.every((c) => !c.trim())) {
      return `This paper may still be indexing. Try again in a moment, or ask a different question about "${paperTitle}".`;
    }

    const context = chunks.join("\n\n---\n\n");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are a research assistant. Answer the user's question based ONLY on the following excerpts from the paper "${paperTitle}". Be concise and accurate. If the excerpts don't contain enough information, say so.

Paper excerpts:
${context}

User question: ${query}`,
    });

    return response.text?.trim() ?? "I couldn't generate an answer. Please try again.";
  } catch (err) {
    console.error("[supermemory] ragSearchPerPaper failed:", err);
    return "Something went wrong while searching this paper. Please try again.";
  }
}

/**
 * RAG search across all stored papers. Returns answer + source arxiv IDs.
 */
export async function ragSearchGlobal(
  query: string
): Promise<{ answer: string; sourceArxivIds: string[] }> {
  try {
    const searchResult = await supermemoryFetch("/v3/search", {
      q: query,
      limit: 10,
    });

    console.log("[supermemory] ragSearchGlobal raw response:", JSON.stringify(searchResult, null, 2));

    const results: { chunks?: { content: string }[]; metadata?: { doc_key?: string } | null }[] =
      searchResult.results ?? [];

    if (results.length === 0) {
      return {
        answer: "No results found. Try adding more papers to your constellation first.",
        sourceArxivIds: [],
      };
    }

    const chunks = results.flatMap(
      (r) => (r.chunks ?? []).map((c) => c.content)
    ).filter(Boolean);
    const sourceArxivIds = [
      ...new Set(
        results
          .map((r) => r.metadata?.doc_key)
          .filter((id): id is string => !!id)
      ),
    ];

    const context = chunks.join("\n\n---\n\n");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are a research assistant. Answer the user's question based on the following excerpts from multiple research papers. Be concise, accurate, and mention which papers (by topic) are relevant when possible.

Paper excerpts:
${context}

User question: ${query}`,
    });

    return {
      answer: response.text?.trim() ?? "I couldn't generate an answer. Please try again.",
      sourceArxivIds,
    };
  } catch (err) {
    console.error("[supermemory] ragSearchGlobal failed:", err);
    return {
      answer: "Something went wrong while searching. Please try again.",
      sourceArxivIds: [],
    };
  }
}
