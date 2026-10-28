import { Suspense } from "react";
import { BenchmarkApp } from "@/components/BenchmarkApp";

// BenchmarkApp reads ?demo=1 / ?candidate= via useSearchParams, so it renders inside Suspense.
export default function Home() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading…</div>}>
      <BenchmarkApp />
    </Suspense>
  );
}
