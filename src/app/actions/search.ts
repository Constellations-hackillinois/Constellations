"use server";

import Exa from "exa-js";
import { GoogleGenAI } from "@google/genai";

export interface SearchResult {
    title: string;
    url: string;
    text: string;
}

async function rewriteQuery(userQuery: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: `Given the following research topic, generate a single web search query specifically aimed at finding the most foundational or seminal academic paper on this subject. The query should target the original, landmark paper that established or defined the field. Return only the search query with no explanation or extra text.\n\nResearch topic: ${userQuery}`,
    });
    return response.text?.trim() ?? userQuery;
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
