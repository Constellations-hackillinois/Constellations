"use client";

import { useState } from "react";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";
import { searchTopic, SearchResult } from "@/app/actions/search";

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const data = await searchTopic(query);
      setResults(data);
    } catch (e) {
      setError("Something went wrong. Check your EXA_API_KEY.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-start bg-zinc-50 px-6 pt-24 dark:bg-black">
      <div className="w-full max-w-2xl">
        <label className="mb-4 block text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          What do you want to research?
        </label>

        <div className="flex flex-col gap-3">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your research topic… (Enter to search)"
            className="min-h-32 resize-none text-base"
            disabled={loading}
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="self-end rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {error && (
          <p className="mt-6 text-sm text-red-500">{error}</p>
        )}

        {results.length > 0 && (
          <div className="mt-8 flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
              Results
            </h2>
            {results.map((r, i) => (
              <a
                key={i}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-50">
                  {r.title}
                </p>
                <p className="mb-2 text-xs text-zinc-400 break-all">{r.url}</p>
                {r.text && (
                  <p className="text-sm text-zinc-600 line-clamp-3 dark:text-zinc-400">
                    {r.text}
                  </p>
                )}
              </a>
            ))}
          </div>
        )}

        <div className="mt-10 flex justify-center">
          <Link
            href="/constellations"
            className="rounded-full bg-[#ffd866] px-8 py-4 text-lg font-semibold text-[#0a0e1a] transition-transform hover:scale-105"
          >
            Enter Constellation Graph
          </Link>
        </div>
      </div>
    </div>
  );
}
