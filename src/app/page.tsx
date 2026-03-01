"use client";

import { useState, useEffect, useRef } from "react";
import { searchTopicWithPaper, resolveUrlToPaper } from "@/app/actions/search";
import ConstellationView from "@/components/ConstellationView";
import ConstellationSidebar from "@/components/ConstellationSidebar";
import { normalizePaperTitle, normalizeRequiredTitle } from "@/lib/papers";
import styles from "./home.module.css";


function easeInCubic(t: number): number {
  return t * t * t;
}

const PARALLAX_STRENGTH = 70;

function Starfield({
  collapseProgress = 0,
  mouseOffsetRef,
}: {
  collapseProgress?: number;
  mouseOffsetRef?: React.RefObject<{ x: number; y: number } | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const canvas = canvasEl as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;

    const STAR_TINTS = [
      [255, 255, 255],
      [255, 255, 255],
      [255, 248, 240],
      [255, 216, 102],
      [200, 230, 255],
      [126, 200, 227],
      [220, 200, 255],
    ];

    let stars: { x: number; y: number; r: number; phase: number; speed: number; base: number; tint: number[]; spiral: number; depth: number }[] = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const w = canvas.width;
      const h = canvas.height;
      const count = Math.floor((w * h) / 450);
      stars = Array.from({ length: count }, () => {
        const tint = STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)];
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.3 + 0.2,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.5 + 0.2,
          base: Math.random() * 0.35 + 0.08,
          tint,
          spiral: (Math.random() - 0.5) * 2,
          depth: Math.random() * 0.14 + 0.02,
        };
      });
    }
    resize();
    window.addEventListener("resize", resize);

    let raf: number;
    function draw(t: number) {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      const mouse = mouseOffsetRef?.current;
      const mx = mouse ? mouse.x * PARALLAX_STRENGTH : 0;
      const my = mouse ? mouse.y * PARALLAX_STRENGTH : 0;

      ctx.clearRect(0, 0, w, h);

      const progress = Math.min(1, collapseProgress);
      const eased = easeInCubic(progress);

      for (const s of stars) {
        let dx: number;
        let dy: number;
        let a: number;
        if (eased <= 0) {
          dx = s.x + mx * s.depth;
          dy = s.y + my * s.depth;
          a = s.base + Math.sin(t * 0.001 * s.speed + s.phase) * 0.15;
        } else {
          const spiralAngle = s.spiral * eased * Math.PI * 2;
          const perpX = s.x - cx;
          const perpY = s.y - cy;
          const rotatedX = cx + perpX * Math.cos(spiralAngle) - perpY * Math.sin(spiralAngle);
          const rotatedY = cy + perpX * Math.sin(spiralAngle) + perpY * Math.cos(spiralAngle);
          dx = s.x + (rotatedX - s.x) * eased + mx * s.depth;
          dy = s.y + (rotatedY - s.y) * eased + my * s.depth;
          a = (s.base + Math.sin(t * 0.001 * s.speed + s.phase) * 0.15) * (1 - eased);
        }
        ctx.beginPath();
        ctx.arc(dx, dy, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.tint[0]},${s.tint[1]},${s.tint[2]},${Math.max(0.03, a)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [collapseProgress, mouseOffsetRef]);

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
  const [constellationId, setConstellationId] = useState<string | undefined>();
  const [displayTopic, setDisplayTopic] = useState("");
  const [collapseProgress, setCollapseProgress] = useState(0);
  const [transitionStarActive, setTransitionStarActive] = useState(false);
  const [searchInFlight, setSearchInFlight] = useState(false);
  const mouseOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    setMounted(true);
    function handleMouseMove(e: MouseEvent) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      mouseOffsetRef.current = {
        x: (e.clientX - w / 2) / (w / 2),
        y: (e.clientY - h / 2) / (h / 2),
      };
    }
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    if (phase === "landing") {
      setCollapseProgress(0);
      setTransitionStarActive(false);
      setSearchInFlight(false);
      return;
    }
    if (phase !== "collapsing") return;
    const starDelay = setTimeout(() => setTransitionStarActive(true), 400);
    return () => clearTimeout(starDelay);
  }, [phase]);

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
    setSearchInFlight(true);

    const inputIsUrl = isUrl(query.trim());

    const search = inputIsUrl
      ? resolveUrlToPaper(query.trim()).then((paper) =>
          paper ? { results: [], pickedPaper: paper } : null
        ).catch(() => null)
      : searchTopicWithPaper(query).catch(() => null);
    search.finally(() => setSearchInFlight(false));

    const minDelay = new Promise<void>((r) => setTimeout(r, 1600));

    Promise.all([search, minDelay]).then(([data]) => {
      const pickedPaper = data?.pickedPaper
        ? {
            ...data.pickedPaper,
            title: normalizePaperTitle(data.pickedPaper.title) ?? data.pickedPaper.title,
          }
        : null;

      if (pickedPaper) setPaperData(pickedPaper);

      const resolvedTopic = inputIsUrl && pickedPaper
        ? normalizeRequiredTitle(pickedPaper.title, pickedPaper.title)
        : normalizeRequiredTitle(query, query);
      setDisplayTopic(resolvedTopic);

      setPhase("constellation");

      setTimeout(() => setStarFading(true), 150);

      setTimeout(() => {
        const params = new URLSearchParams();
        params.set("topic", resolvedTopic);
        params.set("id", id);
        if (pickedPaper) {
          params.set("paperTitle", pickedPaper.title);
          params.set("paperUrl", pickedPaper.url);
        }
        window.history.replaceState(null, "", `/constellations?${params.toString()}`);
      }, 800);
    });
  }

  const showLanding = phase !== "constellation";
  const showStar = phase === "collapsing" || (phase === "constellation" && !starFading);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#060a14]">
      {/* ─── Sidebar (landing only) ─── */}
      {phase === "landing" && <ConstellationSidebar />}

      {/* ─── Constellation layer (mounts after transition) ─── */}
      {phase === "constellation" && (
        <div className={styles.constellationWrapper}>
          <ConstellationView
            topic={displayTopic || query}
            paperTitle={paperData?.title}
            paperUrl={paperData?.url}
            constellationId={constellationId}
          />
        </div>
      )}

      {/* ─── Landing layer ─── */}
      {showLanding && (
        <>
          <Starfield collapseProgress={collapseProgress} mouseOffsetRef={mouseOffsetRef} />

          <div
            className="relative z-[2] flex min-h-screen flex-col items-center justify-center px-6"
          >
            <h1
              className={`mb-3 text-4xl font-semibold tracking-tight text-white/90 sm:text-5xl transition-all duration-700 ${
                phase === "collapsing" ? "opacity-0 -translate-y-10 scale-95" : ""
              }`}
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted ? "translateY(0)" : "translateY(16px)",
                transition: "opacity 800ms cubic-bezier(0.16,1,0.3,1), transform 800ms cubic-bezier(0.16,1,0.3,1)",
                transitionDelay: "100ms",
              }}
            >
              Constellation
            </h1>

            {/* Input bar */}
            <div
              className="relative w-full max-w-[680px] mt-5"
              style={{
                height: 56,
                opacity: mounted ? 1 : 0,
                transform: mounted ? "translateY(0)" : "translateY(10px)",
                transition: "opacity 700ms ease, transform 700ms ease",
                transitionDelay: "400ms",
              }}
            >
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

          </div>
        </>
      )}

      {/* ─── Transition star (bridges landing → constellation) ─── */}
      {(showStar || starFading) && (
          <div
            className={`${styles.starWrapper} ${starFading ? styles.starWrapperFading : ""}`}
          >
          <div
            className={`${styles.transitionStarInner} ${transitionStarActive ? styles.starWrapperActive : ""}`}
          >
            <div className={styles.transitionStarFlash} aria-hidden />
            <div className={styles.transitionStarRing} aria-hidden />
            <div className={`${styles.transitionStarSpinLayer} ${transitionStarActive && searchInFlight ? styles.starSpinActive : ""}`}>
              <div
                className={`${styles.transitionStar} ${transitionStarActive ? styles.starActive : ""} ${transitionStarActive && searchInFlight ? styles.starSearching : ""}`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
