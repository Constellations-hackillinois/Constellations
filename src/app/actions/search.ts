"use server";

import Exa from "exa-js";
import { GoogleGenAI } from "@google/genai";

export interface SearchResult {
    title: string;
    url: string;
    text: string;
}

export interface PickedPaper {
    title: string;
    url: string;
}

async function rewriteQuery(userQuery: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
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
        model: "gemini-2.0-flash",
        contents: `You are a research assistant. Given the user's research topic and a list of academic papers returned by a search engine, pick the single most relevant and foundational paper.

Research topic: "${userQuery}"

Papers:
${listText}

Reply with ONLY a JSON object with two keys: "title" and "url". No explanation, no markdown fences, just raw JSON.`,
    });

    const raw = response.text?.trim() ?? "";
    try {
        const parsed = JSON.parse(raw) as { title: string; url: string };
        if (parsed.title && parsed.url) return parsed;
    } catch {
        // fallback: return first result
        console.warn("[search] pickBestPaper JSON parse failed, using first result");
        return { title: results[0].title, url: results[0].url };
    }
    return null;
}

export async function searchTopic(query: string): Promise<SearchResult[]> {
    const refinedQuery = await rewriteQuery(query);
    console.log(`[search] Original: "${query}" → Refined: "${refinedQuery}"`);

    const exa = new Exa(process.env.EXA_API_KEY);
    const response = await exa.searchAndContents(refinedQuery, {
        numResults: 5,
        type: "auto",
        category: "research paper",
        highlights: { numSentences: 3, highlightsPerUrl: 1 },
    });

    return response.results.map((r) => ({
        title: r.title ?? "Untitled",
        url: r.url,
        text: r.highlights?.join(" ") ?? "",
    }));
}

export async function searchTopicWithPaper(
    query: string
): Promise<{ results: SearchResult[]; pickedPaper: PickedPaper | null }> {
    const results = await searchTopic(query);
    const pickedPaper = await pickBestPaper(query, results);
    console.log(`[search] Picked paper: "${pickedPaper?.title}" → ${pickedPaper?.url}`);
    return { results, pickedPaper };
}
