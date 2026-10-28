"use client";

import { useMemo, type ReactNode } from "react";
import type { EvidenceLayer, EvidenceReport as Report, Hypothesis, SourceRef } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";
import { MockBanner } from "./MockBanner";
import { ReportHypotheses } from "./ReportHypotheses";
import { Section } from "./Section";
import { SourceChips } from "./SourceChips";

const VERDICT: Record<Report["verdict"], { label: string; className: string }> = {
  promising: { label: "Promising", className: "bg-emerald-600 text-white" },
  mixed: { label: "Mixed", className: "bg-amber-400 text-amber-950" },
  insufficient_evidence: { label: "Insufficient evidence", className: "bg-zinc-500 text-white" },
  unfavorable: { label: "Unfavorable", className: "bg-red-600 text-white" },
};

const LAYER: Record<EvidenceLayer, string> = {
  molecular: "Molecular potency",
  preclinical: "Preclinical (functional assays)",
  clinical: "Clinical landscape",
  safety: "Safety & properties",
};

const isHypClaim = (c: { sourceIds: string[] }) => c.sourceIds.some((id) => /^hyp:\w+$/.test(id));

export function EvidenceReport({
  report,
  sources,
  hypotheses = [],
}: {
  report: Report;
  sources: Map<string, SourceRef>;
  /** The evidence graph's hypotheses; claims citing them render in the repurposing block */
  hypotheses?: Hypothesis[];
}) {
  const v = VERDICT[report.verdict];
  const links = useMemo(() => linkTargets(sources), [sources]);
  const linked = (text: string) => linkify(text, links);
  const hypClaims = report.sections.flatMap((s) => s.claims.filter(isHypClaim));
  return (
    <Section title="AI evidence report" aside={<EvidenceBadge kind="ai_summary" />}>
      {report.isMock && (
        <div className="mb-3">
          <MockBanner what="this report" />
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold uppercase tracking-wide ${v.className}`}>{v.label}</span>
        <p className="text-base font-medium text-zinc-900">{report.headline}</p>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Written by Claude from the retrieved evidence only. Every claim cites its source. Click a chip to open the record.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {report.sections.map((s) => (
          <div key={s.layer} className={`rounded-md border border-zinc-200 p-4 ${s.layer === "molecular" ? "lg:col-span-3" : ""}`}>
            <h3 className="font-semibold text-zinc-900">{LAYER[s.layer] ?? s.layer}</h3>
            <p className="mt-1 text-sm text-zinc-700">{linked(s.summary)}</p>
            {s.claims.some((c) => !isHypClaim(c)) && (
              <ul className="mt-3 flex flex-col gap-2.5">
                {s.claims.filter((c) => !isHypClaim(c)).map((c, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-start gap-2">
                      <EvidenceBadge kind={c.kind} />
                      <span className="text-zinc-800">{linked(c.text)}</span>
                    </div>
                    <SourceChips ids={c.sourceIds} sources={sources} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <ReportHypotheses hypotheses={hypotheses} claims={hypClaims} sources={sources} render={linked} />

      {(report.openQuestions.length > 0 || report.nextSteps.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <List title="Open questions" items={report.openQuestions} render={linked} />
          <List title="Suggested next steps" items={report.nextSteps} render={linked} />
        </div>
      )}
    </Section>
  );
}

function List({ title, items, render }: { title: string; items: string[]; render: (text: string) => ReactNode }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <ul className="mt-1 list-disc pl-5 text-sm text-zinc-700">
        {items.map((q) => (
          <li key={q}>{render(q)}</li>
        ))}
      </ul>
    </div>
  );
}

// Database codes the AI writes in prose: NCT IDs, ChEMBL IDs, and our own source IDs (chembl-act:123)
const CODE = /\b(NCT\d{8}|CHEMBL\d+|hyp:\w+|(?:chembl-(?:act|mol|target|warn|ind|mech)|nct):[A-Za-z0-9]+)\b/g;

/** Code → URL, from the retrieved sources (ChEMBL IDs resolve to their compound/target/assay page). */
function linkTargets(sources: Map<string, SourceRef>): Map<string, string> {
  const links = new Map<string, string>();
  for (const s of sources.values()) {
    links.set(s.id, s.url);
    const m = s.url.match(/\/explore\/(?:compound|target|assay)\/(CHEMBL\d+)/);
    if (m && !links.has(m[1])) links.set(m[1], s.url);
  }
  return links;
}

/** Turns known database codes in AI text into links; unknown codes stay plain text. */
function linkify(text: string, links: Map<string, string>): ReactNode[] {
  return text.split(CODE).map((part, i) => {
    // split() with a capture group puts the matched codes at odd indices
    const url =
      i % 2
        ? (links.get(part) ??
          (/^NCT\d{8}$/.test(part) ? `https://clinicaltrials.gov/study/${part}` : /^hyp:\w+$/.test(part) ? `#${part.replace(":", "-")}` : undefined))
        : undefined;
    return url ? (
      <a key={i} href={url} {...(url.startsWith("#") ? {} : { target: "_blank", rel: "noreferrer" })} className="font-mono text-[0.92em] text-blue-700 underline">
        {part}
      </a>
    ) : (
      part
    );
  });
}
