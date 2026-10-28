"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BenchmarkResult, EvidenceReport as Report, GraphResult, TrialsResult } from "@/lib/contracts";
import { CompoundCard } from "./CompoundCard";
import { DrugWarningsPanel } from "./DrugWarningsPanel";
import { EvidenceGraphSection } from "./EvidenceGraphSection";
import { EvidenceReport } from "./EvidenceReport";
import { MatchedAssayTable } from "./MatchedAssayTable";
import { MockBanner } from "./MockBanner";
import { PotencyChart } from "./PotencyChart";
import { PreclinicalTable } from "./PreclinicalTable";
import { SearchBar } from "./SearchBar";
import { ErrorNote, Loading, Section } from "./Section";
import { indexSources } from "./sources";
import { TrialsTable } from "./TrialsTable";
import { WarningsPanel } from "./WarningsPanel";

type Load<T> = { state: "idle" } | { state: "loading" } | { state: "error"; error: string } | { state: "done"; data: T };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BenchmarkApp() {
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

      // Never let the AI summarize placeholder trials: mock trials are shown (bannered) but not sent.
      const realTrials = t && !t.isMock ? t : undefined;

      // Evidence graph: built from the benchmark + trials, enriched server-side. Runs before the report,
      // which will consume its hypotheses.
      setGraph({ state: "loading" });
      let g: GraphResult | undefined;
      try {
        g = await fetchJson<GraphResult>(`/api/graph${demo ? "?demo=1" : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ benchmark: b, trials: realTrials }),
        });
        if (live()) setGraph({ state: "done", data: g });
      } catch (e) {
        if (live()) setGraph({ state: "error", error: message(e) });
      }
      if (!live()) return;

      setReport({ state: "loading" });
      try {
        const r = await fetchJson<Report>(`/api/report${demo ? "?demo=1" : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ benchmark: b, trials: realTrials, graph: g && !g.isMock ? g : undefined }),
        });
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Candidate Benchmark</h1>
          <p className="text-sm text-zinc-600">
            Measured potency vs. drugs on the same target, the clinical landscape, and an AI report where every claim cites its source.
          </p>
        </div>
        {demo && (
          <span className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-600">
            Demo mode: replaying recorded real responses
          </span>
        )}
      </header>

      <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <SearchBar
          initialCandidate={initialCandidate}
          initialDisease={initialDisease}
          busy={benchmark.state === "loading"}
          onSubmit={(c, d) => void run(c, d)}
        />
      </div>

      {benchmark.state === "loading" && (
        <Section title="Benchmark">
          <Loading label="Querying ChEMBL for the candidate, its target, and comparator drugs… (live queries can take a minute)" />
        </Section>
      )}
      {benchmark.state === "error" && <ErrorNote message={benchmark.error} />}

      {b && (
        <>
          {b.isMock && <MockBanner what="this benchmark" />}
          <CompoundCard
            benchmark={b}
            busy={report.state === "loading"}
            onTargetChange={(target) => void run(b.query.candidate, b.query.disease, target)}
          />
          <PotencyChart benchmark={b} />
          <div className="grid gap-5 lg:grid-cols-2">
            <MatchedAssayTable benchmark={b} />
            <WarningsPanel warnings={b.warnings} />
          </div>
          {(b.preclinical || b.drugWarnings) && (
            <div className="grid gap-5 lg:grid-cols-3">
              <div className={b.drugWarnings ? "lg:col-span-2" : "lg:col-span-3"}>
                <PreclinicalTable benchmark={b} />
              </div>
              <DrugWarningsPanel benchmark={b} />
            </div>
          )}

          {trials.state === "loading" && (
            <Section title="Clinical landscape">
              <Loading label="Searching ClinicalTrials.gov…" />
            </Section>
          )}
          {trials.state === "error" && (
            <Section title="Clinical landscape">
              <ErrorNote message={`Trials unavailable: ${trials.error}`} />
            </Section>
          )}
          {t && <TrialsTable trials={t} />}

          {graph.state === "loading" && (
            <Section title="Evidence graph">
              <Loading label="Building the evidence graph from ChEMBL, Open Targets and ClinicalTrials.gov…" />
            </Section>
          )}
          {graph.state === "error" && (
            <Section title="Evidence graph">
              <ErrorNote message={`Graph unavailable: ${graph.error}`} />
            </Section>
          )}
          {g && <EvidenceGraphSection graph={g} sources={sources} />}

          {report.state === "loading" && (
            <Section title="AI evidence report">
              <Loading label="Claude is summarizing the retrieved evidence…" />
            </Section>
          )}
          {report.state === "error" && (
            <Section title="AI evidence report">
              <ErrorNote message={report.error} />
            </Section>
          )}
          {report.state === "done" && <EvidenceReport report={report.data} sources={sources} />}
        </>
      )}
    </div>
  );
}
