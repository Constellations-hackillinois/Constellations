"use client";

import { useState, useEffect, useRef } from "react";
import { searchTopicWithPaper, resolveUrlToPaper } from "@/app/actions/search";
import ConstellationView from "@/components/ConstellationView";
import ConstellationSidebar from "@/components/ConstellationSidebar";
import styles from "./home.module.css";

const SUGGESTIONS = [
  "Transformer architecture",
  "CRISPR gene editing",
  "Reinforcement learning",
  "Quantum computing",
  "Diffusion models",
  "Graph neural networks",
];

function Starfield() {
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

    const stars = Array.from({ length: 220 }, () => ({
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

type Phase = "landing" | "collapsing" | "constellation";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const [paperData, setPaperData] = useState<{ title: string; url: string } | null>(null);
  const [starFading, setStarFading] = useState(false);
  const [debugMode, setDebugMode] = useState(true);
  const [constellationId, setConstellationId] = useState<string | undefined>();
  const [displayTopic, setDisplayTopic] = useState("");
  const landingGlowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setDebugMode(new URLSearchParams(window.location.search).get("debug") !== "false");

    function handleGlow(e: MouseEvent) {
      if (landingGlowRef.current) {
        landingGlowRef.current.style.background =
          `radial-gradient(600px circle at ${e.clientX}px ${e.clientY}px, rgba(255,216,102,0.04), rgba(126,200,227,0.018) 50%, transparent 80%)`;
      }
    }
    document.addEventListener("mousemove", handleGlow);
    return () => document.removeEventListener("mousemove", handleGlow);
  }, []);

  function isUrl(text: string): boolean {
    try {
      const u = new URL(text.trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function handleSubmit() {
    if (!query.trim() || phase !== "landing") return;
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    setConstellationId(id);
    setPhase("collapsing");

    const inputIsUrl = isUrl(query.trim());

    const search = inputIsUrl
      ? resolveUrlToPaper(query.trim()).then((paper) =>
          paper ? { results: [], pickedPaper: paper } : null
        ).catch(() => null)
      : debugMode
        ? new Promise<null>((r) => setTimeout(() => r(null), 800))
        : searchTopicWithPaper(query).catch(() => null);

    const minDelay = new Promise<void>((r) => setTimeout(r, 1600));

    Promise.all([search, minDelay]).then(([data]) => {
      if (data?.pickedPaper) setPaperData(data.pickedPaper);

      const resolvedTopic = inputIsUrl && data?.pickedPaper
        ? data.pickedPaper.title
        : query;
      setDisplayTopic(resolvedTopic);

      setPhase("constellation");

      setTimeout(() => setStarFading(true), 150);

      setTimeout(() => {
        const params = new URLSearchParams();
        params.set("topic", resolvedTopic);
        params.set("id", id);
        if (!debugMode) params.set("debug", "false");
        if (data?.pickedPaper) {
          params.set("paperTitle", data.pickedPaper.title);
          params.set("paperUrl", data.pickedPaper.url);
        }
        window.history.replaceState(null, "", `/constellations?${params.toString()}`);
      }, 800);
    });
  }

  const showLanding = phase !== "constellation";
  const showStar = phase === "collapsing" || (phase === "constellation" && !starFading);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#060a14]">
      {/* ─── Sidebar (always visible) ─── */}
      {phase === "landing" && <ConstellationSidebar />}

      {/* ─── Constellation layer (mounts after transition) ─── */}
      {phase === "constellation" && (
        <div className={styles.constellationWrapper}>
          <ConstellationView
            topic={displayTopic || query}
            paperTitle={paperData?.title}
            paperUrl={paperData?.url}
            debugMode={debugMode}
            constellationId={constellationId}
          />
        </div>
      )}

      {/* ─── Mouse glow (always active on landing) ─── */}
      {showLanding && (
        <div
          ref={landingGlowRef}
          className="fixed inset-0 z-[1] pointer-events-none"
        />
      )}

      {/* ─── Landing layer ─── */}
      {showLanding && (
        <>
          <Starfield />

          <div
            className={`relative z-[2] flex min-h-screen flex-col items-center justify-center px-6 transition-all duration-1000 ${
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <h1
              className={`mb-3 text-4xl font-semibold tracking-tight text-white/90 sm:text-5xl transition-all duration-700 ${
                phase === "collapsing" ? "opacity-0 -translate-y-10 scale-95" : ""
              }`}
            >
              Constellations
            </h1>
            <p
              className={`mb-10 text-base text-white/35 transition-all duration-500 ${
                phase === "collapsing" ? "opacity-0 -translate-y-6" : ""
              }`}
              style={phase === "collapsing" ? { transitionDelay: "75ms" } : undefined}
            >
              Explore the research universe, one paper at a time
            </p>

            {/* Input bar */}
            <div className="relative w-full max-w-[680px]" style={{ height: 52 }}>
              <div
                className={`${styles.inputBar} ${phase === "collapsing" ? styles.inputBarCollapsing : ""}`}
              >
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder="Search a topic or paste an article URL..."
                  className={styles.input}
                  disabled={phase !== "landing"}
                  autoComplete="off"
                />
                <button
                  onClick={handleSubmit}
                  disabled={!query.trim() || phase !== "landing"}
                  className={styles.sendBtn}
                  aria-label="Search"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Suggestion chips */}
            <div
              className={`mt-5 flex flex-wrap justify-center gap-2 transition-all duration-500 ${
                phase === "collapsing" ? "opacity-0 translate-y-4" : ""
              }`}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  disabled={phase !== "landing"}
                  className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-xs text-white/35 transition-all duration-200 hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white/60 disabled:pointer-events-none"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ─── Transition star (bridges landing → constellation) ─── */}
      {(showStar || starFading) && (
        <div
          className={`${styles.starWrapper} ${starFading ? styles.starWrapperFading : ""}`}
        >
          <div
            className={`${styles.transitionStar} ${phase !== "landing" ? styles.starActive : ""}`}
          />
        </div>
      )}
    </div>
  );
}
