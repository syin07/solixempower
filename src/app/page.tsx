"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  BenchmarkResult,
  EvidenceReport,
} from "@/lib/contracts";

function BenchmarkPage() {
  const searchParams = useSearchParams();
  const [candidate, setCandidate] = useState("imatinib");
  const [disease, setDisease] = useState("leukemia");
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [report, setReport] = useState<EvidenceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runBenchmark = useCallback(async () => {
    const demo = searchParams.get("demo") === "1" ? "&demo=1" : "";
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const benchmarkResponse = await fetch(
        `/api/benchmark?candidate=${encodeURIComponent(candidate)}&disease=${encodeURIComponent(disease)}${demo}`,
      );
      if (!benchmarkResponse.ok) {
        throw new Error(`Benchmark request failed (${benchmarkResponse.status})`);
      }

      const nextBenchmark = (await benchmarkResponse.json()) as BenchmarkResult;
      setBenchmark(nextBenchmark);

      const reportResponse = await fetch(`/api/report?${demo.slice(1)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ benchmark: nextBenchmark }),
      });
      if (!reportResponse.ok) {
        throw new Error(`Report request failed (${reportResponse.status})`);
      }
      setReport((await reportResponse.json()) as EvidenceReport);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The benchmark request failed.",
      );
    } finally {
      setLoading(false);
    }
  }, [candidate, disease, searchParams]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">
          Solix Empower
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Drug evidence benchmark
        </h1>
        <p className="max-w-2xl text-zinc-600">
          Compare a candidate compound against measured evidence for a disease.
        </p>
      </header>

      <form
        className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void runBenchmark();
        }}
      >
        <label className="grid gap-2 text-sm font-medium">
          Candidate
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2 font-normal"
            value={candidate}
            onChange={(event) => setCandidate(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Disease
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2 font-normal"
            value={disease}
            onChange={(event) => setDisease(event.target.value)}
          />
        </label>
        <button
          className="self-end rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading ? "Loading..." : "Run benchmark"}
        </button>
      </form>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}

      {benchmark && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">{benchmark.target.name}</h2>
          <p className="mt-2 text-zinc-600">
            Candidate: {benchmark.candidate.compound.name} ·{" "}
            {benchmark.candidate.n} measurements · median pChEMBL{" "}
            {benchmark.candidate.medianPchembl}
          </p>
          {benchmark.isMock && (
            <p className="mt-4 text-sm font-medium text-amber-700">
              Demo data
            </p>
          )}
        </section>
      )}

      {report && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Evidence report
          </p>
          <h2 className="mt-2 text-2xl font-semibold">{report.headline}</h2>
          <p className="mt-2 text-zinc-600">{report.verdict}</p>
        </section>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="p-12">Loading benchmark...</main>}>
      <BenchmarkPage />
    </Suspense>
  );
}
