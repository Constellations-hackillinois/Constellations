"use server";

import { GoogleGenAI, Type } from "@google/genai";
import { extractArxivId, toCanonicalArxivPdfUrl } from "@/lib/arxiv";

const SUPERMEMORY_BASE = "https://api.supermemory.ai";
const SUPERMEMORY_CONTAINER_TAG =
  process.env.SUPERMEMORY_CONTAINER_TAG || "sm_project_constellations";

async function supermemoryRequest(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: object
) {
  const res = await fetch(`${SUPERMEMORY_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supermemory ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function withContainerTag<T extends object>(body: T): T & { containerTags: string[] } {
  return {
    ...body,
    containerTags: [SUPERMEMORY_CONTAINER_TAG],
  };
}

/**
 * Derive a stable document key from a URL.
 * Uses the versionless arXiv ID when available.
 */
function docKeyFromUrl(url: string): string | null {
  return extractArxivId(url);
}

/**
 * Sanitize a key for use as supermemory customId.
 * Only alphanumeric, hyphens, and underscores allowed.
 */
function sanitizeCustomId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Store a document in supermemory, tagged with a constellation ID.
 *
 * Uses customId for deduplication. First tries to find an existing doc
 * to append the constellation ID; falls back to creating a new one.
 */
export async function storeDocument(docUrl: string, constellationId: string): Promise<string> {
  const key = docKeyFromUrl(docUrl);
  const canonicalDocUrl = toCanonicalArxivPdfUrl(docUrl);

  if (!key || !canonicalDocUrl) {
    return `skipped:non-arxiv:${docUrl}`;
  }

  try {
    // Try to find existing document to append constellation ID
    let patched = false;
    try {
      const listResult = await supermemoryRequest("/v3/documents/list", "POST", {
        containerTags: [SUPERMEMORY_CONTAINER_TAG],
        filters: {
          AND: [{ filterType: "metadata", key: "doc_key", value: key }],
        },
      });
      const docs = listResult.documents ?? listResult.results ?? [];
      if (docs.length > 0) {
        const existing = docs[0];
        const ids: string[] = existing.metadata?.constellation_ids ?? [];
        if (ids.includes(constellationId)) {
          return `already-tagged:${key}`;
        }
        await supermemoryRequest(`/v3/documents/${existing.id}`, "PATCH", {
          metadata: {
            doc_key: key,
            constellation_ids: [...ids, constellationId],
          },
        });
        patched = true;
        return `patched:${key}`;
      }
    } catch (listErr) {
      const msg = listErr instanceof Error ? listErr.message : String(listErr);
      return await createNew(canonicalDocUrl, key, constellationId, `list-failed:${msg}`);
    }

    if (!patched) {
      return await createNew(canonicalDocUrl, key, constellationId);
    }
    return `done:${key}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `error:${msg}`;
  }
}

async function createNew(docUrl: string, key: string, constellationId: string, note?: string): Promise<string> {
  const result = await supermemoryRequest("/v3/documents", "POST", {
    content: docUrl,
    containerTag: SUPERMEMORY_CONTAINER_TAG,
    customId: sanitizeCustomId(key),
    metadata: { doc_key: key, constellation_ids: [constellationId] },
  });
  return `${note ? note + " → " : ""}created:${key} id=${result.id}`;
}

/**
 * Remove a constellation ID tag from a document. If no constellation IDs remain, the doc is left
 * (still useful for other constellations). We only untag, never delete documents outright.
 */
export async function removeDocumentFromConstellation(docUrl: string, constellationId: string): Promise<string> {
  const key = docKeyFromUrl(docUrl);
  if (!key) return `skipped:non-arxiv:${docUrl}`;

  try {
    const listResult = await supermemoryRequest("/v3/documents/list", "POST", {
      containerTags: [SUPERMEMORY_CONTAINER_TAG],
      filters: {
        AND: [{ filterType: "metadata", key: "doc_key", value: key }],
      },
    });
    const docs = listResult.documents ?? listResult.results ?? [];
    if (docs.length === 0) return `not-found:${key}`;

    const existing = docs[0];
    const ids: string[] = existing.metadata?.constellation_ids ?? [];
    const updated = ids.filter((id: string) => id !== constellationId);

    await supermemoryRequest(`/v3/documents/${existing.id}`, "PATCH", {
      metadata: {
        doc_key: key,
        constellation_ids: updated,
      },
    });
    return `untagged:${key}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[supermemory] removeDocumentFromConstellation failed:", msg);
    return `error:${msg}`;
  }
}

/**
 * Fetch raw RAG excerpts from a paper (no Gemini synthesis).
 * Used to enrich prompts in followUpSearch with relevant paper context.
 */
export async function fetchPaperExcerpts(
  query: string,
  paperUrl: string,
  constellationId: string
): Promise<string[]> {
  const key = docKeyFromUrl(paperUrl);
  if (!key) return [];

  try {
    const searchResult = await supermemoryRequest("/v3/search", "POST", withContainerTag({
      q: query,
      filters: {
        AND: [
          { filterType: "metadata", key: "doc_key", value: key },
          { filterType: "array_contains", key: "constellation_ids", value: constellationId },
        ],
      },
      limit: 5,
    }));

    const chunks: string[] = (searchResult.results ?? []).flatMap(
      (r: { chunks?: { content: string }[] }) =>
        (r.chunks ?? []).map((c) => c.content)
    ).filter(Boolean);

    console.log(`[supermemory] fetchPaperExcerpts query: "${query}" | doc_key: ${key} | chunks returned: ${chunks.length}`);
    chunks.forEach((chunk, i) => console.log(`[supermemory] chunk[${i}]:`, chunk.slice(0, 200)));

    return chunks;
  } catch (err) {
    console.warn("[supermemory] fetchPaperExcerpts failed:", err);
    return [];
  }
}

/**
 * Search the paper via supermemory RAG and return relevant excerpts.
 */
async function searchPaperChunks(
  searchQuery: string,
  docKey: string,
  constellationId: string
): Promise<string[]> {
  const searchResult = await supermemoryRequest("/v3/search", "POST", withContainerTag({
    q: searchQuery,
    filters: {
      AND: [
        { filterType: "metadata", key: "doc_key", value: docKey },
        { filterType: "array_contains", key: "constellation_ids", value: constellationId },
      ],
    },
    limit: 5,
  }));

  return (searchResult.results ?? []).flatMap(
    (r: { chunks?: { content: string }[] }) =>
      (r.chunks ?? []).map((c) => c.content)
  ).filter(Boolean);
}

// Tool declaration for Gemini function calling
const searchPaperTool = {
  functionDeclarations: [{
    name: "search_paper",
    description: "Search the current research paper for specific information. Use this when you need to find facts, data, methods, or details from the paper that aren't already in the conversation. Do NOT call this for follow-up questions where you already have enough context to answer.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "A specific, descriptive search query to find relevant passages in the paper. Should be a clear topic or question, not a vague reference.",
        },
      },
      required: ["query"],
    },
  }],
};

/**
 * Agentic RAG search scoped to a single paper.
 * Gemini decides whether to search the paper or answer from conversation context.
 */
export async function ragSearchPerPaper(
  query: string,
  paperUrl: string,
  paperTitle: string,
  constellationId: string,
  chatHistory?: { role: "user" | "ai"; text: string }[]
): Promise<string> {
  const key = docKeyFromUrl(paperUrl);
  if (!key) {
    return `I can only search arXiv papers right now. "${paperTitle}" doesn't have a canonical arXiv ID.`;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const systemPrompt = `You are a research assistant helping a user understand the paper "${paperTitle}". You have access to a search_paper tool that retrieves relevant excerpts from this paper. Use it when you need specific information from the paper. If the user asks a follow-up question and you already have enough context from the conversation to answer, respond directly without searching.`;

    // Build multi-turn contents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents: any[] = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Understood. I'll help answer questions about this paper, searching for specific information when needed." }] },
    ];

    // Append prior conversation turns (sliding window: last 10 messages)
    if (chatHistory && chatHistory.length > 0) {
      const recent = chatHistory.slice(-10);
      for (const msg of recent) {
        contents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.text }],
        });
      }
    }

    // Append the current query
    contents.push({ role: "user", parts: [{ text: query }] });

    const config = { tools: [searchPaperTool] };

    // First call: Gemini decides whether to search or answer directly
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config,
    });

    // If Gemini returned text directly (no tool call), it answered from context
    if (!response.functionCalls || response.functionCalls.length === 0) {
      console.log("[supermemory] Gemini answered from conversation context (no tool call)");
      return response.text?.trim() ?? "I couldn't generate an answer. Please try again.";
    }

    // Gemini wants to search the paper — execute the tool call
    const toolCall = response.functionCalls[0];
    const searchQuery = (toolCall.args as { query: string }).query;
    console.log(`[supermemory] Gemini called search_paper("${searchQuery}")`);

    const chunks = await searchPaperChunks(searchQuery, key, constellationId);

    if (chunks.length === 0 || chunks.every((c) => !c.trim())) {
      return `This paper may still be indexing. Try again in a moment, or ask a different question about "${paperTitle}".`;
    }

    const excerpts = chunks.join("\n\n---\n\n");

    // Send the tool result back to Gemini for the final answer
    contents.push(response.candidates![0].content);
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name: "search_paper", response: { excerpts } } }],
    });

    const finalResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config,
    });

    return finalResponse.text?.trim() ?? "I couldn't generate an answer. Please try again.";
  } catch (err) {
    console.error("[supermemory] ragSearchPerPaper failed:", err);
    return "Something went wrong while searching this paper. Please try again.";
  }
}

/**
 * RAG search across all stored papers in a constellation. Returns answer + source arxiv IDs.
 */
export async function ragSearchGlobal(
  query: string,
  constellationId: string
): Promise<{ answer: string; sourceArxivIds: string[] }> {
  try {
    const searchResult = await supermemoryRequest("/v3/search", "POST", withContainerTag({
      q: query,
      filters: {
        AND: [
          { filterType: "array_contains", key: "constellation_ids", value: constellationId },
        ],
      },
      limit: 10,
    }));

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
      model: "gemini-3-flash-preview",
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
