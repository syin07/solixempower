import { Suspense } from "react";
import { GraphApp } from "@/components/GraphApp";

// GraphApp reads ?demo=1 / ?candidate= via useSearchParams, so it renders inside Suspense.
// The previous dashboard page lives on in BenchmarkApp.tsx (not routed).
export default function Home() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading…</div>}>
      <GraphApp />
    </Suspense>
  );
}
