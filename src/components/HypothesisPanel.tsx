"use client";

// Repurposing hypothesis cards (docs/KG_PRD.md §3 step 6, KG_PLAN M3). Each card is a path through the
// graph: statement, status, an evidence ladder shown one row per kind (never summed), the suggested
// test, the path's edges (click → edge drawer) and source chips. The query-disease card ("Your
// question") is pinned first. Hovering a card highlights its path in the graph; "pin path" keeps it.
import { useState } from "react";
import type { GraphEdge, GraphEdgeKind, GraphResult, Hypothesis, HypothesisStatus, HypothesisTemplate, SourceRef } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";
import { SourceChips } from "./SourceChips";

const STATUS: Record<HypothesisStatus, { label: string; className: string }> = {
  proposed: { label: "Proposed", className: "border-emerald-600 bg-emerald-50 text-emerald-800" },
  already_tested: { label: "Already tested", className: "border-amber-500 bg-amber-50 text-amber-900" },
  already_indicated: { label: "Already indicated", className: "border-zinc-400 bg-zinc-100 text-zinc-700" },
  no_path: { label: "No path found", className: "border-red-500 bg-red-50 text-red-800" },
};

export const TEMPLATE: Record<HypothesisTemplate, string> = {
  target_hop: "via the main target",
  comparator_hop: "via a comparator drug",
  off_target_hop: "via a secondary target",
  route_hop: "formulation / route",
  query_disease: "for the disease you asked about",
};

/** Edge type → short word for the path chips. */
const STEP: Record<string, string> = {
  measured_against: "measured",
  mechanism: "mechanism",
  associated_with: "Open Targets",
  indicated_for: "indication",
  tested_in: "trial",
  for_disease: "trial for",
  absent: "not found",
};

export function StatusChip({ status }: { status: HypothesisStatus }) {
  const s = STATUS[status];
  return (
    <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.className}`}>{s.label}</span>
  );
}

/** EvidenceBadge, plus the graph-only "absent" kind (checked, not found). */
export function LadderBadge({ kind }: { kind: GraphEdgeKind }) {
  if (kind !== "absent") return <EvidenceBadge kind={kind} />;
  return (
    <span className="inline-flex shrink-0 items-center rounded border border-dashed border-red-500 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
      Not found
    </span>
  );
}

export function HypothesisPanel({
  hypotheses,
  graph,
  sources,
  pinnedId,
  onHover,
  onPin,
  onSelectEdge,
  expanded = false,
}: {
  hypotheses: Hypothesis[];
  /** For resolving path edge ids to edges and node labels */
  graph: GraphResult;
  sources: Map<string, SourceRef>;
  pinnedId?: string | null;
  onHover: (id: string | null) => void;
  onPin?: (id: string | null) => void;
  onSelectEdge?: (edge: GraphEdge) => void;
  /** The graph was expanded after the hypotheses were generated */
  expanded?: boolean;
}) {
  const query = hypotheses.find((h) => h.template === "query_disease");
  const rest = hypotheses.filter((h) => h.template !== "query_disease");
  const [open, setOpen] = useState<string | null>(query?.id ?? rest[0]?.id ?? null);
  const proposed = rest.filter((h) => h.status === "proposed").length;
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

  const item = (h: Hypothesis, isQuestion: boolean) => {
    const pinned = pinnedId === h.id;
    const path = h.pathEdgeIds.map((id) => graph.edges.find((e) => e.id === id)).filter((e): e is GraphEdge => Boolean(e));
    return (
      <li
        key={h.id}
        className={`px-4 py-3 hover:bg-blue-50/40 ${isQuestion ? "border-l-4 border-l-blue-600 bg-blue-50/20" : ""} ${pinned ? "ring-1 ring-inset ring-blue-500" : ""}`}
        onMouseEnter={() => onHover(h.id)}
        onMouseLeave={() => onHover(null)}
      >
        <button type="button" className="w-full text-left" onClick={() => setOpen(open === h.id ? null : h.id)} aria-expanded={open === h.id}>
          <div className="flex items-start gap-2">
            <StatusChip status={h.status} />
            <span className="text-sm font-medium text-zinc-900">{h.statement}</span>
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{TEMPLATE[h.template]}</div>
        </button>
        {open === h.id && (
          <div className="mt-2 flex flex-col gap-2">
            <dl className="flex flex-col gap-1.5 text-xs">
              {h.ladder.map((row, i) => (
                <div key={i} className="rounded border border-zinc-100 px-2 py-1">
                  <dt className="flex flex-wrap items-center gap-1.5 text-zinc-600">
                    <LadderBadge kind={row.kind} />
                    {row.label}
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-900">{row.value}</dd>
                  {row.sourceIds.length > 0 && <SourceChips ids={row.sourceIds} sources={sources} />}
                </div>
              ))}
            </dl>
            <div className="rounded border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs text-blue-900">
              <span className="font-semibold">Suggested test: </span>
              {h.suggestedTest}
            </div>
            {path.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-zinc-600">
                <span className="text-zinc-500">Path:</span>
                {path.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelectEdge?.(e)}
                    title={`${label(e.from)} → ${label(e.to)}: ${e.label} (open the record)`}
                    className={`max-w-48 truncate rounded border px-1.5 py-0.5 hover:border-blue-500 hover:text-blue-700 ${
                      e.kind === "absent" ? "border-dashed border-red-400 text-red-700" : "border-zinc-300"
                    }`}
                  >
                    {STEP[e.type] ?? e.type} → {label(e.to)}
                  </button>
                ))}
                {onPin && (
                  <button
                    type="button"
                    onClick={() => onPin(pinned ? null : h.id)}
                    className="ml-auto text-zinc-500 hover:text-blue-700"
                    title="Keep this path highlighted in the graph"
                  >
                    {pinned ? "unpin path" : "pin path"}
                  </button>
                )}
              </div>
            )}
            <SourceChips ids={h.sourceIds} sources={sources} />
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="rounded-md border border-zinc-200 bg-white">
      {query && (
        <>
          <div className="border-b border-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-900">Your question</div>
          <ol className="border-b border-zinc-200">{item(query, true)}</ol>
        </>
      )}
      <div className="flex items-baseline justify-between border-b border-zinc-100 px-4 py-2.5">
        <div className="text-sm font-semibold text-zinc-900">Repurposing hypotheses</div>
        <span
          className="cursor-help text-xs text-zinc-500"
          title="Ordered by status, then genetic evidence, then clinical score; never summed into one score"
        >
          {rest.length} found · {proposed} open
        </span>
      </div>
      <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
        Generated by code from graph paths: each is a traceable gap in public evidence, not a prediction of efficacy.
        {expanded && " Computed on the initial graph; expanded nodes add context but are not gap-checked."}
      </p>
      {rest.length === 0 ? (
        <p className="px-4 py-3 text-sm text-zinc-500">
          No repurposing gap found within two hops. Expand a target or disease node to look further.
        </p>
      ) : (
        // Scrolls on its own so a long list never pushes the page far below the graph
        <ol className="divide-y divide-zinc-100 lg:max-h-[1100px] lg:overflow-y-auto">{rest.map((h) => item(h, false))}</ol>
      )}
    </div>
  );
}
