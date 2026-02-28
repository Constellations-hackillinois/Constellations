"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import {
  searchTopicWithPaper,
  SearchResult,
  PickedPaper,
} from "@/app/actions/search";

const SUGGESTIONS = [
  "Transformer architecture",
  "CRISPR gene editing",
  "Reinforcement learning",
  "Quantum computing",
  "Diffusion models",
  "Graph neural networks",
];

function MiniStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const stars = Array.from({ length: 200 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.2,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.5 + 0.2,
      base: Math.random() * 0.35 + 0.08,
    }));

    let raf: number;
    function draw(t: number) {
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      for (const s of stars) {
        const a = s.base + Math.sin(t * 0.001 * s.speed + s.phase) * 0.15;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0.03, a)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pickedPaper, setPickedPaper] = useState<PickedPaper | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setPickedPaper(null);
    try {
      const data = await searchTopicWithPaper(query);
      setResults(data.results);
      setPickedPaper(data.pickedPaper);
    } catch (e) {
      setError("Something went wrong. Check your API keys.");
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

  function handleEnterConstellation() {
    const params = new URLSearchParams();
    params.set("topic", query);
    if (pickedPaper) {
      params.set("paperTitle", pickedPaper.title);
      params.set("paperUrl", pickedPaper.url);
    }
    router.push(`/constellations?${params.toString()}`);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#060a14]">
      <MiniStarfield />

      {/* Ambient gradient orbs */}
      <div className="pointer-events-none fixed inset-0" style={{ zIndex: 1 }}>
        <div className="absolute left-1/4 top-1/4 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,216,102,0.06)_0%,transparent_70%)]" />
        <div className="absolute right-1/4 bottom-1/3 h-[500px] w-[500px] translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(126,200,227,0.05)_0%,transparent_70%)]" />
      </div>

      <div
        className={`relative flex min-h-screen flex-col items-center justify-start px-6 pt-20 pb-24 transition-all duration-1000 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
        style={{ zIndex: 2 }}
      >
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="mb-12 text-center">
            <h1 className="mb-3 text-4xl font-bold tracking-tight text-white/95 sm:text-5xl">
              Constellations
            </h1>
            <p className="text-base text-white/40">
              Explore the research universe, one paper at a time
            </p>
          </div>

          {/* Search area */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-xl shadow-[0_8px_60px_rgba(0,0,0,0.4)]">
            <label className="mb-3 block text-sm font-medium tracking-wide text-white/60 uppercase">
              What do you want to research?
            </label>

            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe a research topic..."
              className="min-h-28 resize-none border-white/[0.06] bg-white/[0.04] text-[15px] text-white/90 placeholder:text-white/25 focus:border-[#ffd866]/30 focus:ring-[#ffd866]/10 transition-colors duration-300"
              disabled={loading}
            />

            {/* Suggestion chips */}
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs text-white/40 transition-all duration-200 hover:border-[#ffd866]/30 hover:bg-[#ffd866]/[0.06] hover:text-[#ffd866]/80"
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSearch}
                disabled={loading || !query.trim()}
                className="group relative overflow-hidden rounded-lg bg-white/[0.08] px-6 py-2.5 text-sm font-medium text-white/80 transition-all duration-300 hover:bg-white/[0.14] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <span className="relative z-10">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                      Searching
                    </span>
                  ) : (
                    "Search"
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-6 animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-400/90">
              {error}
            </div>
          )}

          {/* Picked paper */}
          {pickedPaper && (
            <div className="mt-6 animate-in fade-in slide-in-from-bottom-3 rounded-xl border border-[#ffd866]/20 bg-[#ffd866]/[0.04] p-5 backdrop-blur-sm">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#ffd866]/70">
                Origin paper
              </p>
              <p className="text-[15px] font-semibold leading-snug text-white/90">
                {pickedPaper.title}
              </p>
              <a
                href={pickedPaper.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 block truncate text-xs text-[#7ec8e3]/70 transition-colors hover:text-[#7ec8e3]"
              >
                {pickedPaper.url}
              </a>
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div className="mt-8 space-y-3 animate-in fade-in slide-in-from-bottom-4">
              <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-white/40">
                All results
              </h2>
              {results.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.04]"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <p className="mb-1 text-sm font-medium text-white/80 transition-colors group-hover:text-white/95">
                    {r.title}
                  </p>
                  <p className="mb-1.5 truncate text-[11px] text-white/25">
                    {r.url}
                  </p>
                  {r.text && (
                    <p className="text-[13px] leading-relaxed text-white/35 line-clamp-2">
                      {r.text}
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}

          {/* Enter constellation button */}
          {(pickedPaper || query.trim()) && (
            <div className="mt-10 flex justify-center animate-in fade-in zoom-in-95">
              <button
                onClick={handleEnterConstellation}
                disabled={loading}
                className="group relative rounded-full bg-gradient-to-r from-[#ffd866] to-[#ffcc33] px-8 py-3.5 text-sm font-semibold text-[#0a0e1a] shadow-[0_0_40px_rgba(255,216,102,0.15)] transition-all duration-500 hover:shadow-[0_0_60px_rgba(255,216,102,0.3)] hover:scale-[1.03] active:scale-[0.98] disabled:opacity-30 disabled:hover:scale-100 disabled:hover:shadow-none"
              >
                Enter Constellation
                <span className="ml-2 inline-block transition-transform duration-300 group-hover:translate-x-0.5">
                  →
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
