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
        if (parsed.title && parsed.url) return parsed;
    } catch (err) {
        console.warn("[search] pickBestPaper JSON parse failed:", err);
        console.warn("[search] Falling back to first result");
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
        includeDomains: ["arxiv.org"],
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

export async function followUpSearch(
    parentPaperUrl: string,
    parentPaperTitle: string,
    followUpQuestion: string
): Promise<{ pickedPaper: PickedPaper | null; aiResponse: string }> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const exa = new Exa(process.env.EXA_API_KEY);

    // 1. Fetch parent paper content via Exa
    let parentContent = "";
    try {
        const contentsResp = await exa.getContents([parentPaperUrl], {
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

    const results: SearchResult[] = searchResp.results.map((r) => ({
        title: r.title ?? "Untitled",
        url: r.url,
        text: r.highlights?.join(" ") ?? "",
    }));

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
