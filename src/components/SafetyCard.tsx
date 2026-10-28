"use client";

// FAERS safety summary for the candidate: report totals, serious share, and the top reactions as
// bars. Reads the candidate's "safety" node (added by addSafety in src/lib/kg/enrich.ts); renders
// nothing until that data exists. Spontaneous reports, not incidence — the note says so.
import type { GraphResult } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";

const BARS = 8;

export function SafetyCard({ graph }: { graph: GraphResult }) {
  const candidate = graph.nodes.find((n) => n.type === "drug" && n.isCandidate);
  const edge = graph.edges.find((e) => e.type === "has_adverse_events" && (!candidate || e.from === candidate.id));
  const node = edge ? graph.nodes.find((n) => n.id === edge.to) : graph.nodes.find((n) => n.type === "safety");
  if (!node) return null;

  const total = Number(node.meta?.total ?? 0);
  const serious = Number(node.meta?.serious ?? 0);
  const pct = Number(node.meta?.seriousPct ?? 0);
  const query = typeof node.meta?.query === "string" ? node.meta.query : undefined;
  const reactions = (Array.isArray(node.meta?.topReactions) ? (node.meta!.topReactions as string[]) : [])
    .map((s) => {
      const i = s.lastIndexOf("|");
      return { term: s.slice(0, i), count: Number(s.slice(i + 1)) };
    })
    .filter((r) => r.term && Number.isFinite(r.count))
    .slice(0, BARS);
  const max = reactions.reduce((m, r) => Math.max(m, r.count), 0);

  return (
    <div className="rounded-md border border-orange-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-orange-100 bg-orange-50/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          Safety signals — FAERS <EvidenceBadge kind="clinical" />
        </div>
        {edge && (
          <a href={edge.source.url} target="_blank" rel="noreferrer" className="text-xs text-blue-700 underline">
            Open query
          </a>
        )}
      </div>
      <div className="px-4 py-3 text-sm">
        {total === 0 ? (
          <p className="text-zinc-600">
            No adverse-event reports found in FAERS for {candidate?.label.toLowerCase() ?? "this drug"}. Expected for a drug that is not
            marketed; it is not evidence of safety.
          </p>
        ) : (
          <>
            <p className="text-zinc-800">
              <span className="font-semibold">{total.toLocaleString("en-US")}</span> reports,{" "}
              <span className="font-semibold">{serious.toLocaleString("en-US")}</span> ({pct}%) marked serious
              {typeof node.meta?.field === "string" && node.meta.field === "medicinalproduct" ? " (matched on free-text product name)" : ""}.
            </p>
            {reactions.length > 0 && (
              <ol className="mt-2 flex flex-col gap-1">
                {reactions.map((r) => (
                  <li key={r.term} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2 text-xs">
                    <span className="truncate text-zinc-700" title={r.term}>
                      {r.term}
                    </span>
                    <span className="h-2 rounded bg-orange-100">
                      <span className="block h-2 rounded bg-orange-500" style={{ width: `${max ? Math.max(2, (100 * r.count) / max) : 0}%` }} />
                    </span>
                    <span className="font-mono text-zinc-600">{r.count.toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          Spontaneous reports, not incidence; &ldquo;drug ineffective&rdquo; and &ldquo;death&rdquo; appear for most drugs. Read as signals to check, not
          rates.
        </p>
        {query && total === 0 && null}
      </div>
    </div>
  );
}
