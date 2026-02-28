"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ConstellationView from "@/components/ConstellationView";

function ConstellationsInner() {
  const searchParams = useSearchParams();

  return (
    <ConstellationView
      topic={searchParams.get("topic") || ""}
      paperTitle={searchParams.get("paperTitle") || undefined}
      paperUrl={searchParams.get("paperUrl") || undefined}
      debugMode={searchParams.get("debug") === "true"}
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
