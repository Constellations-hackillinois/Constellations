"use server";

import Exa from "exa-js";
import { GoogleGenAI } from "@google/genai";
import { isArxivUrl, toCanonicalArxivPdfUrl } from "@/lib/arxiv";

export interface SearchResult {
    title: string;
    url: string;
    text: string;
}

export interface PickedPaper {
    title: string;
    url: string;
}

function normalizeTitle(title: string): string {
    return title.trim().toLowerCase();
}

function normalizeSearchResults(
    results: { title?: string | null; url: string; highlights?: string[] | null }[],
    excludedUrls: string[] = []
): SearchResult[] {
    const excluded = new Set(excludedUrls);
    const seen = new Set<string>();

    return results.flatMap((result) => {
        if (!result.url || !isArxivUrl(result.url)) return [];

        const canonicalUrl = toCanonicalArxivPdfUrl(result.url);
        if (!canonicalUrl || excluded.has(canonicalUrl) || seen.has(canonicalUrl)) return [];

        seen.add(canonicalUrl);
        return [{
            title: result.title ?? "Untitled",
            url: canonicalUrl,
            text: result.highlights?.join(" ") ?? "",
        }];
    });
}

function matchPickedPaper(
    candidate: Partial<PickedPaper>,
    results: SearchResult[]
): PickedPaper | null {
    const byUrl = new Map(results.map((result) => [result.url, result]));
    const byTitle = new Map(results.map((result) => [normalizeTitle(result.title), result]));

    const canonicalUrl = candidate.url ? toCanonicalArxivPdfUrl(candidate.url) : null;
    if (canonicalUrl) {
        const matchedByUrl = byUrl.get(canonicalUrl);
        if (matchedByUrl) {
            return { title: matchedByUrl.title, url: matchedByUrl.url };
        }
    }

    if (candidate.title) {
        const matchedByTitle = byTitle.get(normalizeTitle(candidate.title));
        if (matchedByTitle) {
            return { title: matchedByTitle.title, url: matchedByTitle.url };
        }
    }

    return null;
}

async function rewriteQuery(userQuery: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Given the following research topic, generate a single web search query specifically aimed at finding the most foundational or seminal academic paper on this subject. The query should target the original, landmark paper that established or defined the field. Return only the search query with no explanation or extra text.\n\nResearch topic: ${userQuery}`,
    });
    return response.text?.trim() ?? userQuery;
}

async function pickBestPaper(
    userQuery: string,
    results: SearchResult[]
): Promise<PickedPaper | null> {
    if (results.length === 0) return null;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const listText = results
        .map(
            (r, i) =>
                `[${i + 1}] Title: ${r.title}\n    URL: ${r.url}\n    Excerpt: ${r.text.slice(0, 200)}`
        )
        .join("\n\n");

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a research assistant. Given the user's research topic and a list of academic papers returned by a search engine, pick the single most relevant and foundational paper.

Research topic: "${userQuery}"

Papers:
${listText}

Reply with ONLY a JSON object with two keys: "title" and "url". No explanation, no markdown fences, just raw JSON.`,
    });

    const raw = response.text?.trim() ?? "";
    console.log("[search] pickBestPaper raw response:", raw);
    try {
        const parsed = JSON.parse(raw) as { title: string; url: string };
        const matched = matchPickedPaper(parsed, results);
        if (matched) return matched;
    } catch (err) {
        console.warn("[search] pickBestPaper JSON parse failed:", err);
    }
    console.warn("[search] Falling back to first result");
    return { title: results[0].title, url: results[0].url };
}

export async function searchTopic(query: string): Promise<SearchResult[]> {
    const refinedQuery = await rewriteQuery(query);
    console.log(`[search] Original: "${query}" → Refined: "${refinedQuery}"`);

    const exa = new Exa(process.env.EXA_API_KEY);
    const response = await exa.searchAndContents(refinedQuery, {
        numResults: 5,
        type: "auto",
        category: "research paper",
        includeDomains: ["arxiv.org"],
        highlights: { numSentences: 3, highlightsPerUrl: 1 },
    });

    return normalizeSearchResults(response.results);
}

export async function searchTopicWithPaper(
    query: string
): Promise<{ results: SearchResult[]; pickedPaper: PickedPaper | null }> {
    const results = await searchTopic(query);
    const pickedPaper = await pickBestPaper(query, results);
    console.log(`[search] Picked paper: "${pickedPaper?.title}" → ${pickedPaper?.url}`);
    return { results, pickedPaper };
}

export async function expandSearch(
    paperUrl: string,
    paperTitle: string
): Promise<PickedPaper[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const exa = new Exa(process.env.EXA_API_KEY);
    const canonicalPaperUrl = toCanonicalArxivPdfUrl(paperUrl) ?? paperUrl;

    // 1. Fetch paper content for context
    let paperContent = "";
    try {
        const contentsResp = await exa.getContents([canonicalPaperUrl], {
            text: { maxCharacters: 2000 },
        });
        paperContent = contentsResp.results?.[0]?.text ?? "";
    } catch (err) {
        console.warn("[expand] Could not fetch paper content:", err);
    }

    const paperContext = paperContent
        ? `Paper title: "${paperTitle}"\nExcerpt:\n${paperContent.slice(0, 1500)}`
        : `Paper title: "${paperTitle}"`;

    // 2. Ask Gemini to generate a search query for related/cited papers
    const refineResp = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: `You are a research assistant. Given a paper, generate a single search query that will find the most important related academic papers — papers it cites, papers that cite it, or papers exploring similar ideas.

${paperContext}

Generate a single, broad search query to find 3-5 closely related academic papers. Return ONLY the search query, no explanation.`,
    });

    const refinedQuery = refineResp.text?.trim() ?? paperTitle;
    console.log(`[expand] Paper: "${paperTitle}" → Query: "${refinedQuery}"`);

    // 3. Search Exa for related papers
    const searchResp = await exa.searchAndContents(refinedQuery, {
        numResults: 8,
        type: "auto",
        category: "research paper",
        includeDomains: ["arxiv.org"],
        highlights: { numSentences: 2, highlightsPerUrl: 1 },
    });

    const results = normalizeSearchResults(searchResp.results, [canonicalPaperUrl]);

    // 4. Ask Gemini to pick the 3-5 most relevant distinct papers
    if (results.length === 0) return [];

    const listText = results
        .map(
            (r, i) =>
                `[${i + 1}] Title: ${r.title}\n    URL: ${r.url}\n    Excerpt: ${r.text.slice(0, 150)}`
        )
        .join("\n\n");

    const pickResp = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: `You are a research assistant. Given a source paper and a list of search results, pick the 3 to 5 most relevant and diverse related papers. Prefer papers that cover different aspects or branches of the topic.

Source paper: "${paperTitle}"

Search results:
${listText}

Reply with ONLY a JSON array of objects, each with "title" and "url" keys. No explanation, no markdown fences, just raw JSON array.`,
    });

    const raw = pickResp.text?.trim() ?? "[]";
    try {
        const parsed = JSON.parse(raw) as PickedPaper[];
        if (Array.isArray(parsed)) {
            const matched: PickedPaper[] = [];
            const seen = new Set<string>();

            for (const candidate of parsed) {
                const paper = matchPickedPaper(candidate, results);
                if (!paper || seen.has(paper.url)) continue;
                seen.add(paper.url);
                matched.push(paper);
                if (matched.length === 5) break;
            }

            if (matched.length > 0) return matched;
        }
    } catch {
        console.warn("[expand] JSON parse failed, returning first 3 results");
    }
    return results.slice(0, 3).map((r) => ({ title: r.title, url: r.url }));
}

export async function followUpSearch(
    parentPaperUrl: string,
    parentPaperTitle: string,
    followUpQuestion: string
): Promise<{ pickedPaper: PickedPaper | null; aiResponse: string }> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const exa = new Exa(process.env.EXA_API_KEY);
    const canonicalParentUrl = toCanonicalArxivPdfUrl(parentPaperUrl) ?? parentPaperUrl;

    // 1. Fetch parent paper content via Exa
    let parentContent = "";
    try {
        const contentsResp = await exa.getContents([canonicalParentUrl], {
            text: { maxCharacters: 2000 },
        });
        parentContent =
            contentsResp.results?.[0]?.text ?? "";
    } catch (err) {
        console.warn("[followUp] Could not fetch parent paper content:", err);
    }

    const parentContext = parentContent
        ? `Paper title: "${parentPaperTitle}"\nPaper content excerpt:\n${parentContent.slice(0, 1500)}`
        : `Paper title: "${parentPaperTitle}"`;

    // 2. Ask Gemini to craft a refined Exa search query
    const refineResp = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a research assistant. A user is exploring a constellation of research papers. They are currently reading a paper and have a follow-up question. Your job is to generate a single search query that will find the most relevant academic paper related to their question.

Current paper context:
${parentContext}

User's follow-up question: "${followUpQuestion}"

Generate a single, targeted web search query to find the most relevant related academic/research paper. Return ONLY the search query, no explanation.`,
    });

    const refinedQuery = refineResp.text?.trim() ?? followUpQuestion;
    console.log(`[followUp] Follow-up: "${followUpQuestion}" → Query: "${refinedQuery}"`);

    // 3. Search Exa
    const searchResp = await exa.searchAndContents(refinedQuery, {
        numResults: 5,
        type: "auto",
        category: "research paper",
        includeDomains: ["arxiv.org"],
        highlights: { numSentences: 3, highlightsPerUrl: 1 },
    });

    const results = normalizeSearchResults(searchResp.results, [canonicalParentUrl]);

    // 4. Pick best paper
    const pickedPaper = await pickBestPaper(followUpQuestion, results);
    console.log(`[followUp] Picked: "${pickedPaper?.title}" → ${pickedPaper?.url}`);

    // 5. Generate a short AI response for the chat
    const summaryResp = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a research assistant. A user asked "${followUpQuestion}" while reading "${parentPaperTitle}". You found a related paper: "${pickedPaper?.title ?? "none"}". Write a single brief sentence (max 30 words) explaining why this paper is relevant to their question. Be conversational and informative.`,
    });

    const aiResponse =
        summaryResp.text?.trim() ??
        `I found a related paper: ${pickedPaper?.title ?? "unknown"}`;

    return { pickedPaper, aiResponse };
}
