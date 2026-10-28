"use client";

// Graph-first page: search bar → evidence graph (with hypotheses) → AI report tucked below.
// The benchmark / trials / report requests still run in sequence (the graph is built from them);
// only the dashboard panels (potency chart, tables) are left off this page.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BenchmarkResult, EvidenceReport as Report, GraphResult, TrialsResult } from "@/lib/contracts";
import { EvidenceGraphSection } from "./EvidenceGraphSection";
import { EvidenceReport } from "./EvidenceReport";
import { MockBanner } from "./MockBanner";
import { SearchBar } from "./SearchBar";
import { ErrorNote, Loading, Section } from "./Section";
import { indexSources, phaseLabel } from "./sources";

type Load<T> = { state: "idle" } | { state: "loading" } | { state: "error"; error: string } | { state: "done"; data: T };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function GraphApp() {
  const params = useSearchParams();
  const demo = params.get("demo") === "1";
  const initialCandidate = params.get("candidate") ?? "poziotinib";
  const initialDisease = params.get("disease") ?? "non-small cell lung cancer";

  const [benchmark, setBenchmark] = useState<Load<BenchmarkResult>>({ state: "idle" });
  const [trials, setTrials] = useState<Load<TrialsResult>>({ state: "idle" });
  const [graph, setGraph] = useState<Load<GraphResult>>({ state: "idle" });
  const [report, setReport] = useState<Load<Report>>({ state: "idle" });
  const runId = useRef(0);

  const run = useCallback(
    async (candidate: string, disease: string, target?: string) => {
      const id = ++runId.current;
      const live = () => id === runId.current; // ignore responses from a superseded search
      const flag = demo ? "&demo=1" : "";
      const post = (body: unknown) => ({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setBenchmark({ state: "loading" });
      setTrials({ state: "idle" });
      setGraph({ state: "idle" });
      setReport({ state: "idle" });

      let b: BenchmarkResult;
      try {
        const qs = new URLSearchParams({ candidate, disease, ...(target ? { target } : {}) });
        b = await fetchJson<BenchmarkResult>(`/api/benchmark?${qs}${flag}`);
      } catch (e) {
        if (live()) setBenchmark({ state: "error", error: message(e) });
        return;
      }
      if (!live()) return;
      setBenchmark({ state: "done", data: b });

      setTrials({ state: "loading" });
      let t: TrialsResult | undefined;
      try {
        const drugs = [b.candidate, ...b.comparators].map((c) => c.compound.name).join(",");
        t = await fetchJson<TrialsResult>(`/api/trials?${new URLSearchParams({ disease, drugs })}${flag}`);
        if (live()) setTrials({ state: "done", data: t });
      } catch (e) {
        if (live()) setTrials({ state: "error", error: message(e) });
      }
      if (!live()) return;
      const realTrials = t && !t.isMock ? t : undefined; // never build on placeholder trials

      setGraph({ state: "loading" });
      let g: GraphResult | undefined;
      try {
        g = await fetchJson<GraphResult>(`/api/graph${demo ? "?demo=1" : ""}`, post({ benchmark: b, trials: realTrials }));
        if (live()) setGraph({ state: "done", data: g });
      } catch (e) {
        if (live()) setGraph({ state: "error", error: message(e) });
      }
      if (!live()) return;

      setReport({ state: "loading" });
      try {
        const r = await fetchJson<Report>(
          `/api/report${demo ? "?demo=1" : ""}`,
          post({ benchmark: b, trials: realTrials, graph: g && !g.isMock ? g : undefined }),
        );
        if (live()) setReport({ state: "done", data: r });
      } catch (e) {
        if (live()) setReport({ state: "error", error: message(e) });
      }
    },
    [demo],
  );

  // A shared link with ?candidate= runs immediately (handy for the demo video).
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !params.get("candidate")) return;
    autoRan.current = true;
    void run(initialCandidate, initialDisease);
  }, [params, run, initialCandidate, initialDisease]);

  const b = benchmark.state === "done" ? benchmark.data : null;
  const t = trials.state === "done" ? trials.data : null;
  const g = graph.state === "done" ? graph.data : null;
  const sources = useMemo(() => indexSources(b, t, g), [b, t, g]);
  const busy = benchmark.state === "loading" || trials.state === "loading" || graph.state === "loading";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Evidence Graph</h1>
          <p className="text-sm text-zinc-600">
            Enter a drug. We build a live, fully cited evidence graph around it, find the diseases it could be repurposed
            for, and mark which of those ideas were already tried.
          </p>
        </div>
        {demo && (
          <span className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-600">
            Demo mode: replaying recorded real responses
          </span>
        )}
      </header>

      <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <SearchBar initialCandidate={initialCandidate} initialDisease={initialDisease} busy={busy} onSubmit={(c, d) => void run(c, d)} />
        {b && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-100 pt-3 text-sm text-zinc-700">
            {b.isMock && <MockBanner what="this benchmark" />}
            <span>
              <span className="font-semibold text-zinc-900">{b.candidate.compound.name}</span>{" "}
              <a href={b.candidate.compound.source.url} target="_blank" rel="noreferrer" className="font-mono text-blue-700 underline">
                {b.candidate.compound.chemblId}
              </a>{" "}
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-white">{phaseLabel(b.candidate.compound.maxPhase)}</span>
            </span>
            <span className="text-zinc-500">·</span>
            <label className="flex items-center gap-2">
              Target
              {(b.candidateTargets?.length ?? 0) > 1 ? (
                <select
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900"
                  value={b.target.chemblId}
                  disabled={busy}
                  onChange={(e) => void run(b.query.candidate, b.query.disease, e.target.value)}
                >
                  {b.candidateTargets!.map((x) => (
                    <option key={x.chemblId} value={x.chemblId}>
                      {x.name} ({x.chemblId}) — {x.n} measurement{x.n === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-semibold text-zinc-900">{b.target.name}</span>
              )}
            </label>
            <span className="text-zinc-500">·</span>
            <span>
              {b.candidate.n} comparable {b.activityType} measurement{b.candidate.n === 1 ? "" : "s"}, {b.comparators.length} comparator drug
              {b.comparators.length === 1 ? "" : "s"}
              {t ? `, ${t.trials.length} trials` : ""}
            </span>
          </div>
        )}
      </div>

      {benchmark.state === "loading" && (
        <Section title="Evidence graph">
          <Loading label="Resolving the candidate and its comparators in ChEMBL… (live queries can take a minute)" />
        </Section>
      )}
      {benchmark.state === "error" && <ErrorNote message={benchmark.error} />}
      {b && trials.state === "loading" && (
        <Section title="Evidence graph">
          <Loading label="Searching ClinicalTrials.gov…" />
        </Section>
      )}
      {b && graph.state === "loading" && (
        <Section title="Evidence graph">
          <Loading label="Building the evidence graph from ChEMBL, Open Targets and ClinicalTrials.gov…" />
        </Section>
      )}
      {graph.state === "error" && (
        <Section title="Evidence graph">
          <ErrorNote message={`Graph unavailable: ${graph.error}`} />
        </Section>
      )}
      {trials.state === "error" && <ErrorNote message={`Trials unavailable: ${trials.error} — the graph is built without them.`} />}
      {g && <EvidenceGraphSection graph={g} sources={sources} demo={demo} />}

      {b && (report.state === "loading" || report.state === "error" || report.state === "done") && (
        <details className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-zinc-800">
            AI evidence report {report.state === "loading" ? "— generating…" : ""}
          </summary>
          <div className="border-t border-zinc-100 p-5">
            {report.state === "loading" && <Loading label="Claude is summarizing the retrieved evidence…" />}
            {report.state === "error" && <ErrorNote message={report.error} />}
            {report.state === "done" && <EvidenceReport report={report.data} sources={sources} />}
          </div>
        </details>
      )}
    </div>
  );
}
