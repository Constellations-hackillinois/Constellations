"use server";

import Exa from "exa-js";
import { GoogleGenAI } from "@google/genai";
import { isArxivUrl, extractArxivId, toCanonicalArxivPdfUrl } from "@/lib/arxiv";
import { fetchPaperExcerpts } from "@/app/actions/supermemory";

export interface SearchResult {
    title: string;
    url: string;
    text: string;
}

export interface PickedPaper {
    title: string;
    url: string;
}

export interface FrontierEvaluation {
    isFrontier: boolean;
    reason: string;
}

export interface ExpandSearchResult {
    papers: PickedPaper[];
    frontier: FrontierEvaluation | null;
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
    const t0 = performance.now();
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Given the following research topic, generate a single web search query specifically aimed at finding the most foundational or seminal academic paper on this subject. The query should target the original, landmark paper that established or defined the field. Return only the search query with no explanation or extra text.\n\nResearch topic: ${userQuery}`,
    });
    console.log(`[gemini] rewriteQuery took ${(performance.now() - t0).toFixed(0)}ms`);
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

    const t0 = performance.now();
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a research assistant. Given the user's research topic and a list of academic papers returned by a search engine, pick the single most relevant and foundational paper.

Research topic: "${userQuery}"

Papers:
${listText}

Reply with ONLY a JSON object with two keys: "title" and "url". No explanation, no markdown fences, just raw JSON.`,
    });
    console.log(`[gemini] pickBestPaper took ${(performance.now() - t0).toFixed(0)}ms`);

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

export async function resolveUrlToPaper(
    url: string
): Promise<PickedPaper | null> {
    const exa = new Exa(process.env.EXA_API_KEY);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const canonicalUrl = toCanonicalArxivPdfUrl(url);

    // If it's an arXiv URL, resolve the title
    if (canonicalUrl) {
        const arxivId = extractArxivId(url);

        // Try getContents first
        try {
            const contentsResp = await exa.getContents([canonicalUrl], {
                text: { maxCharacters: 500 },
            });
            const result = contentsResp.results?.[0];
            if (result?.title) {
                console.log(`[resolveUrl] arXiv resolved via getContents: "${result.title}" → ${canonicalUrl}`);
                return { title: result.title, url: canonicalUrl };
            }
        } catch (err) {
            console.warn("[resolveUrl] Exa getContents failed for arXiv URL:", err);
        }

        // Fallback: search for the arXiv ID to get the title
        try {
            const searchResp = await exa.searchAndContents(`arxiv ${arxivId}`, {
                numResults: 1,
                type: "auto",
                includeDomains: ["arxiv.org"],
                highlights: { numSentences: 1, highlightsPerUrl: 1 },
            });
            const found = searchResp.results?.[0];
            if (found?.title) {
                const cleanTitle = found.title.replace(/^\[[\d.]+\]\s*/, "");
                console.log(`[resolveUrl] arXiv resolved via search: "${cleanTitle}" → ${canonicalUrl}`);
                return { title: cleanTitle, url: canonicalUrl };
            }
        } catch (err) {
            console.warn("[resolveUrl] Exa search fallback failed:", err);
        }

        return { title: `arXiv:${arxivId ?? url}`, url: canonicalUrl };
    }

    // Non-arXiv URL: use Exa to find it, then search for related arXiv paper
    try {
        const searchResp = await exa.searchAndContents(url, {
            numResults: 1,
            type: "auto",
            highlights: { numSentences: 2, highlightsPerUrl: 1 },
        });
        const found = searchResp.results?.[0];
        const pageTitle = found?.title ?? "Untitled";
        const highlights = (found as { highlights?: string[] })?.highlights ?? [];
        const excerpt = highlights.join(" ") || "";

        // Ask Gemini to derive a research topic from the page content
        const t0 = performance.now();
        const topicResp = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Given this article, extract the core research topic in 2-5 words. Return ONLY the topic, nothing else.\n\nTitle: ${pageTitle}\nExcerpt: ${excerpt}`,
        });
        console.log(`[gemini] resolveUrl extractTopic took ${(performance.now() - t0).toFixed(0)}ms`);
        const topic = topicResp.text?.trim() ?? pageTitle;

        // Search for a related arXiv paper
        const arxivResp = await exa.searchAndContents(topic, {
            numResults: 3,
            type: "auto",
            category: "research paper",
            includeDomains: ["arxiv.org"],
            highlights: { numSentences: 2, highlightsPerUrl: 1 },
        });
        const arxivResults = normalizeSearchResults(arxivResp.results);
        if (arxivResults.length > 0) {
            const picked = await pickBestPaper(topic, arxivResults);
            if (picked) {
                console.log(`[resolveUrl] Non-arXiv → topic "${topic}" → paper "${picked.title}"`);
                return picked;
            }
        }

        // No arXiv paper found; return the original URL as-is
        console.log(`[resolveUrl] Non-arXiv fallback: "${pageTitle}" → ${url}`);
        return { title: pageTitle, url };
    } catch (err) {
        console.error("[resolveUrl] Failed to resolve non-arXiv URL:", err);
        return { title: "Untitled", url };
    }
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
    paperTitle: string,
    constellationId?: string,
    depth?: number
): Promise<ExpandSearchResult> {
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
    const depthGuidance = depth !== undefined && depth <= 1
        ? "Find broad, foundational papers — survey papers, seminal/classic works, and accessible overviews. Avoid niche follow-ups or highly specialized extensions."
        : depth === 2
            ? "Find important related papers that explore key branches and subtopics of this area. Prefer well-known papers over obscure ones."
            : "Find the most important related academic papers — papers it cites, papers that cite it, or papers exploring similar ideas.";

    const t0 = performance.now();
    const refineResp = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a research assistant. Given a paper, generate a single search query that will find related academic papers.

Guidance: ${depthGuidance}

${paperContext}

Generate a single, broad search query to find closely related academic papers. Return ONLY the search query, no explanation.`,
    });
    console.log(`[gemini] expand refineQuery took ${(performance.now() - t0).toFixed(0)}ms`);

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
    if (results.length === 0) return { papers: [], frontier: null };

    const listText = results
        .map(
            (r, i) =>
                `[${i + 1}] Title: ${r.title}\n    URL: ${r.url}\n    Excerpt: ${r.text.slice(0, 150)}`
        )
        .join("\n\n");

    const pickInstruction = depth !== undefined && depth <= 2
        ? "Pick 3 to 5 of the most relevant and diverse related papers. Prefer foundational, well-cited, and broadly accessible papers over narrow follow-ups."
        : "Pick 2 to 5 of the most relevant and diverse related papers. Prefer papers that cover different aspects or branches of the topic.";

    const t1 = performance.now();
    const pickResp = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a research assistant. Given a source paper and a list of search results, ${pickInstruction}

Source paper: "${paperTitle}"

Search results:
${listText}

Reply with ONLY a JSON array of objects, each with "title" and "url" keys. No explanation, no markdown fences, just raw JSON array.`,
    });
    console.log(`[gemini] expand pickPapers took ${(performance.now() - t1).toFixed(0)}ms`);

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

            if (matched.length > 0) {
                // Frontier evaluation — only at depth 4+
                if (depth !== undefined && depth >= 4) {
                    try {
                        const frontier = await evaluateFrontier(paperContext, matched, results, constellationId);
                        if (frontier.isFrontier) {
                            return { papers: [], frontier };
                        }
                    } catch (err) {
                        console.warn("[expand] frontier eval failed, proceeding normally:", err);
                    }
                }
                return { papers: matched, frontier: null };
            }
        }
    } catch {
        console.warn("[expand] JSON parse failed, returning first 3 results");
    }
    const fallback = results.slice(0, 3).map((r) => ({ title: r.title, url: r.url }));
    return { papers: fallback, frontier: null };
}

async function evaluateFrontier(
    parentPaperContext: string,
    pickedPapers: PickedPaper[],
    fullResults: SearchResult[],
    constellationId?: string
): Promise<FrontierEvaluation> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Get richer parent context from Supermemory if we have a constellation
    let enrichedParentContext = parentPaperContext;
    if (constellationId) {
        try {
            const parentTitle = parentPaperContext.match(/Paper title: "(.+?)"/)?.[1] ?? "";
            const parentUrl = parentPaperContext.match(/https?:\/\/[^\s"]+/)?.[0] ?? "";
            if (parentTitle && parentUrl) {
                const chunks = await fetchPaperExcerpts(parentTitle, parentUrl, constellationId);
                if (chunks.length > 0) {
                    enrichedParentContext += "\n\nAdditional excerpts from parent paper:\n" + chunks.join("\n\n---\n\n").slice(0, 2000);
                }
            }
        } catch {
            // Fall through with basic context
        }
    }

    // Build candidate context from Exa highlights already in fullResults
    const candidateContext = pickedPapers.map((p) => {
        const full = fullResults.find((r) => r.url === p.url);
        return `- "${p.title}": ${full?.text?.slice(0, 300) ?? "No excerpt available"}`;
    }).join("\n");

    const prompt = `You are a research frontier evaluation agent. Given a parent paper and its candidate successor papers, assess whether the candidates represent genuine research advances or merely incremental extensions.

<parent_paper>
${enrichedParentContext}
</parent_paper>

<candidate_papers>
${candidateContext}
</candidate_papers>

Score each candidate on these 8 dimensions (1-10 scale):
1. **Contribution type**: 1 = stronger implementation of existing idea, 10 = entirely new capability/theory/method
2. **Distance from prior work**: 1 = marginal improvement, 10 = solves previously unsolvable problem, opens new direction
3. **Fundamentality**: 1 = hyperparameter tuning/scaling/obvious combo, 10 = result matters even after implementation details age out
4. **Community impact**: 1 = ignorable by peers, 10 = other researchers must respond to it
5. **Surprise factor**: 1 = experts would say "of course", 10 = experts would say "that shouldn't work"
6. **Evidence robustness**: 1 = no baselines/narrow eval, 10 = strong ablations/reproducible/generalizes
7. **Insight vs resources**: 1 = just more compute/data, 10 = genuine conceptual breakthrough
8. **New capabilities**: 1 = benchmark score +0.7, 10 = qualitatively new behavior or task class

Classification based on average score:
- NOT_FRONTIER: avg < 5.0 — competent incremental extension
- POSSIBLY_FRONTIER: avg 5.0–7.0 — meaningful improvement or clever reframing
- CLEARLY_FRONTIER: avg > 7.0 — changes what researchers think is possible

CRITICAL: The parent paper is at the research frontier ONLY when ALL candidates are NOT_FRONTIER (avg < 5.0 for every candidate). Even one POSSIBLY_FRONTIER candidate means the parent has meaningful successors.

Reply with ONLY a JSON object (no markdown fences, no explanation):
{
  "assessments": [
    {
      "title": "Paper Title",
      "scores": { "contribution": N, "distance": N, "fundamental": N, "impact": N, "surprise": N, "evidence": N, "insight": N, "capabilities": N },
      "avg": N.N,
      "classification": "NOT_FRONTIER|POSSIBLY_FRONTIER|CLEARLY_FRONTIER",
      "reasoning": "1-2 sentences"
    }
  ],
  "parentIsFrontier": true/false,
  "reason": "1-2 sentence user-facing explanation of why the parent is or isn't at the frontier"
}`;

    const t0 = performance.now();
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
    });
    console.log(`[gemini] evaluateFrontier took ${(performance.now() - t0).toFixed(0)}ms`);

    const raw = response.text?.trim() ?? "";
    console.log("[expand] frontier eval raw:", raw);

    const parsed = JSON.parse(raw) as {
        assessments: { title: string; avg: number; classification: string; reasoning: string }[];
        parentIsFrontier: boolean;
        reason: string;
    };

    return {
        isFrontier: parsed.parentIsFrontier,
        reason: parsed.reason,
    };
}

async function pickBestPaperWithContext(
    followUpQuestion: string,
    results: SearchResult[],
    parentPaperTitle: string,
    ragExcerpts: string
): Promise<PickedPaper | null> {
    if (results.length === 0) return null;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const listText = results
        .map(
            (r, i) =>
                `[${i + 1}] Title: ${r.title || "Untitled"}\n    URL: ${r.url}\n    Excerpt: ${r.text.slice(0, 200)}`
        )
        .join("\n\n");

    const contextBlock = ragExcerpts
        ? `<reading_context>
The user is reading "${parentPaperTitle}". Relevant excerpts from that paper:
<excerpts>
${ragExcerpts}
</excerpts>
</reading_context>`
        : `<reading_context>
The user is reading "${parentPaperTitle}".
</reading_context>`;

    const pickPrompt = `You are an expert research assistant specializing in academic paper recommendation.

${contextBlock}

<user_question>
${followUpQuestion}
</user_question>

<candidate_papers>
${listText}
</candidate_papers>

<instructions>
Select the single most relevant paper from the candidates above.

To make your selection, reason through:
1. What specific concept or technique is the user asking about, given their question and reading context?
2. Which candidate paper most directly addresses that concept?
3. Is topical overlap strong enough, or is there a deeper conceptual match with another candidate?

Prioritize papers that:
- Directly address the method, technique, or phenomenon in the question
- Connect to the specific context established by the reading excerpts (if provided)
- Are the most precise match — not just broadly related, but specifically relevant

Deprioritize papers that:
- Share surface-level keywords but address a different problem
- Are only tangentially related to the question
</instructions>

<output_format>
Reply with ONLY a raw JSON object — no explanation, no markdown fences, no extra text.
Required keys: "title" (string) and "url" (string).
If the paper has no title, use an empty string.
Example: {"title": "Some Paper Title", "url": "https://arxiv.org/pdf/example.pdf"}
</output_format>`;

    console.log("[followUp] pickBestPaperWithContext prompt:\n", pickPrompt);

    const t0 = performance.now();
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: pickPrompt,
    });
    console.log(`[gemini] pickBestPaperWithContext took ${(performance.now() - t0).toFixed(0)}ms`);

    const raw = response.text?.trim() ?? "";
    console.log("[search] pickBestPaperWithContext raw response:", raw);
    try {
        const parsed = JSON.parse(raw) as { title: string; url: string };
        const matched = matchPickedPaper(parsed, results);
        if (matched) return matched;
    } catch (err) {
        console.warn("[search] pickBestPaperWithContext JSON parse failed:", err);
    }
    console.warn("[search] Falling back to first result");
    return { title: results[0].title, url: results[0].url };
}

export async function followUpSearch(
    parentPaperUrl: string,
    parentPaperTitle: string,
    followUpQuestion: string,
    constellationId: string
): Promise<{ pickedPaper: PickedPaper | null; aiResponse: string }> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const exa = new Exa(process.env.EXA_API_KEY);
    const canonicalParentUrl = toCanonicalArxivPdfUrl(parentPaperUrl) ?? parentPaperUrl;

    // 1. Fetch relevant excerpts from supermemory (RAG), fall back to Exa
    let ragExcerpts = "";
    try {
        const chunks = await fetchPaperExcerpts(followUpQuestion, canonicalParentUrl, constellationId);
        if (chunks.length > 0) {
            ragExcerpts = chunks.join("\n\n---\n\n").slice(0, 2000);
            console.log(`[followUp] RAG returned ${chunks.length} excerpts for "${parentPaperTitle}"`);
        }
    } catch (err) {
        console.warn("[followUp] fetchPaperExcerpts failed:", err);
    }

    // Fallback: fetch raw content from Exa if RAG returned nothing
    if (!ragExcerpts) {
        try {
            const contentsResp = await exa.getContents([canonicalParentUrl], {
                text: { maxCharacters: 2000 },
            });
            ragExcerpts = contentsResp.results?.[0]?.text ?? "";
            if (ragExcerpts) {
                console.log(`[followUp] Using Exa fallback content for "${parentPaperTitle}"`);
            }
        } catch (err) {
            console.warn("[followUp] Exa fallback also failed:", err);
        }
    }

    const contextBlock = ragExcerpts
        ? `Paper title: "${parentPaperTitle}"\nRelevant excerpts from the paper (related to the user's question):\n${ragExcerpts.slice(0, 1500)}`
        : `Paper title: "${parentPaperTitle}"`;

    // 2. Ask Gemini to craft a refined Exa search query
    const refinePrompt = `<role>
You are an expert academic research assistant that generates precise search queries for Exa, a real-time AI-powered semantic search engine with specialized academic paper indexing. You understand Exa's neural search model deeply: it finds content by semantic meaning and embedding similarity, not keyword matching. Exa's dedicated "research paper" category indexes arXiv, peer-reviewed journals, and major academic publishers with state-of-the-art retrieval.
</role>

<context>
A researcher is exploring a constellation of academic papers. They are currently reading a specific paper and have a follow-up question. Your task is to generate a single Exa-optimized search query targeting the "research paper" category that will surface the most semantically relevant academic paper.

How Exa's neural search works:
- Exa matches by conceptual meaning, not keyword frequency
- The best queries describe the *content and nature of the target document* — written as if you are describing the paper you want to find
- Queries should read like the opening sentence of the paper's abstract or a librarian's description of the ideal source
- Exa supports long, semantically rich descriptions — more descriptive is better than more sparse
- Do NOT use boolean operators, quotes, site: filters, or keyword-search syntax — these do not apply to Exa's neural model

Exa "research paper" category targets: academic papers, arXiv preprints, peer-reviewed research, and scientific publications.
</context>

<examples>
<example>
<user_question>What methods exist for aligning large language models with human preferences?</user_question>
<exa_query>Research paper on reinforcement learning from human feedback methods for aligning large language models with human values and preferences</exa_query>
</example>
<example>
<user_question>Are there papers that challenge transformer architectures for sequence modeling?</user_question>
<exa_query>Academic study proposing alternatives to transformer architecture for sequence modeling, such as state space models or recurrent approaches</exa_query>
</example>
<example>
<user_question>What do we know about cell regeneration in adult mammals?</user_question>
<exa_query>Research paper published in a major journal investigating mechanisms of cell regeneration and tissue repair in adult mammalian organisms</exa_query>
</example>
</examples>

<current_paper>
${contextBlock}
</current_paper>

<user_question>
${followUpQuestion}
</user_question>

<instructions>
1. Identify the core academic domain, methodology, and key concepts from the current paper
2. Determine exactly what type of paper would answer the user's follow-up question
3. Describe that ideal paper in natural language — write it as an opening sentence of its abstract or a librarian's description
4. Use field-specific terminology from the paper's domain to maximize semantic relevance
5. Frame the query to reflect the *content* of the target paper, not the user's question verbatim
</instructions>

<constraints>
- Return ONLY the search query string — no explanation, label, prefix, or surrounding text
- Write as a descriptive natural language phrase (10–25 words), not a keyword list
- Do not use boolean operators, quotes, or keyword-search syntax
- Do not include author names unless the question specifically requests a particular researcher's work
- Begin the query with a content descriptor like "Research paper on...", "Academic study examining...", or "Study published in..." to help Exa's category targeting
</constraints>

<output_format>
A single line containing only the Exa-optimized search query string.
</output_format>`;

    console.log("[followUp] refineQuery prompt:\n", refinePrompt);

    const t0 = performance.now();
    const refineResp = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: refinePrompt,
    });
    console.log(`[gemini] followUp refineQuery took ${(performance.now() - t0).toFixed(0)}ms`);

    const refinedQuery = refineResp.text?.trim() ?? followUpQuestion;
    console.log(`[followUp] Follow-up: "${followUpQuestion}" → Query: "${refinedQuery}"`);

    // 3. Search Exa
    const searchResp = await exa.searchAndContents(refinedQuery, {
        numResults: 25,
        type: "auto",
        highlights: { numSentences: 3, highlightsPerUrl: 1 },
    });

    const results = normalizeSearchResults(searchResp.results, [canonicalParentUrl]);
    console.log(`[followUp] Exa returned ${results.length} results:`, results.map(r => `"${r.title}" → ${r.url}`));

    // 4. Pick best paper with full context
    const pickedPaper = await pickBestPaperWithContext(
        followUpQuestion, results, parentPaperTitle, ragExcerpts
    );
    console.log(`[followUp] Picked: "${pickedPaper?.title}" → ${pickedPaper?.url}`);

    // 5. Generate a short AI response for the chat
    const t1 = performance.now();
    const summaryResp = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a research assistant. A user asked "${followUpQuestion}" while reading "${parentPaperTitle}". You found a related paper: "${pickedPaper?.title ?? "none"}". Write a single brief sentence (max 30 words) explaining why this paper is relevant to their question. Be conversational and informative.`,
    });
    console.log(`[gemini] followUp summary took ${(performance.now() - t1).toFixed(0)}ms`);

    const aiResponse =
        summaryResp.text?.trim() ??
        `I found a related paper: ${pickedPaper?.title ?? "unknown"}`;

    return { pickedPaper, aiResponse };
}

