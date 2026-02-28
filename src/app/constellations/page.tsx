"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ConstellationView from "@/components/ConstellationView";
import { normalizePaperTitle, normalizeRequiredTitle } from "@/lib/papers";

function ConstellationsInner() {
  const searchParams = useSearchParams();

  const topic = normalizeRequiredTitle(searchParams.get("topic"), "") || "";
  const constellationId = searchParams.get("id") || undefined;
  const paperTitle = normalizePaperTitle(searchParams.get("paperTitle")) || undefined;
  const paperUrl = searchParams.get("paperUrl") || undefined;

  if (!topic) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#060a14] text-white/40">
        No topic specified. <a href="/" className="ml-2 underline text-white/60 hover:text-white/80">Go home</a>
      </div>
    );
  }

  return (
    <ConstellationView
      topic={topic}
      paperTitle={paperTitle}
      paperUrl={paperUrl}
      constellationId={constellationId}
    />
  );
}

export default function ConstellationsPage() {
  return (
    <Suspense>
      <ConstellationsInner />
    </Suspense>
  );
}
