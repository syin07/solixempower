"use client";

import { useMemo, useState } from "react";
import type { TrialsResult } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";
import { MockBanner } from "./MockBanner";
import { Section } from "./Section";

const prettyPhase = (p: string) => p.replace(/PHASE/g, "Phase ").replace(/_/g, " ").replace(/\//g, " / ") || "—";
const prettyStatus = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export function TrialsTable({ trials }: { trials: TrialsResult }) {
  const [phase, setPhase] = useState("all");
  const [resultsOnly, setResultsOnly] = useState(false);
  const phases = useMemo(() => [...new Set(trials.trials.map((t) => t.phase))].sort().reverse(), [trials]);
  const shown = trials.trials.filter((t) => (phase === "all" || t.phase === phase) && (!resultsOnly || t.hasResults));

  return (
    <Section title={`Clinical landscape (${trials.trials.length} trials)`} aside={<EvidenceBadge kind="clinical" />}>
      {trials.isMock && (
        <div className="mb-3">
          <MockBanner what="the trials list" />
        </div>
      )}
      <p className="mb-3 text-sm text-zinc-600">
        Trials for {trials.query.disease || "the disease"} and the comparator drugs, from ClinicalTrials.gov. This shows development
        stage, not head-to-head efficacy.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Phase
          <select className="rounded border border-zinc-300 px-2 py-1" value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="all">All</option>
            {phases.map((p) => (
              <option key={p} value={p}>
                {prettyPhase(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={resultsOnly} onChange={(e) => setResultsOnly(e.target.checked)} />
          Has posted results
        </label>
        <span className="text-zinc-500">{shown.length} shown</span>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">No trials match.</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-md border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Trial</th>
                <th className="px-3 py-2 font-medium">Phase</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Enrollment</th>
                <th
                  className="cursor-help whitespace-nowrap px-3 py-2 font-medium"
                  title="The sponsor posted a results summary to ClinicalTrials.gov. This says nothing about whether the trial succeeded."
                >
                  Results posted ⓘ
                </th>
                <th className="px-3 py-2 font-medium">Primary outcome</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.nctId} className="border-t border-zinc-100 align-top">
                  <td className="px-3 py-2">
                    <a href={t.source.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-700 underline">
                      {t.nctId}
                    </a>
                    <div className="text-zinc-800">{t.title}</div>
                    <div className="text-xs text-zinc-500">{t.interventions.join(", ")}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{prettyPhase(t.phase)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{prettyStatus(t.status)}</td>
                  <td className="px-3 py-2 text-right font-mono">{t.enrollment ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {/* Neutral styling on purpose: posted results ≠ a successful trial */}
                    {t.hasResults ? (
                      <a
                        href={`https://clinicaltrials.gov/study/${t.nctId}?tab=results`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 underline"
                      >
                        View results ↗
                      </a>
                    ) : (
                      <span className="text-zinc-400">Not posted</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-700">{t.primaryOutcomes[0] ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
