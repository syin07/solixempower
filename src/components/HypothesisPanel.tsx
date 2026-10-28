"use client";

// Repurposing hypothesis cards (docs/KG_PRD.md §3 step 6). Each card is a path through the graph:
// statement, status, an evidence ladder shown one row per kind (never summed), the suggested test, and
// source chips. Hovering a card highlights its path in the graph.
import { useState } from "react";
import type { GraphEdgeKind, Hypothesis, HypothesisStatus, HypothesisTemplate, SourceRef } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";

const STATUS: Record<HypothesisStatus, { label: string; className: string }> = {
  proposed: { label: "Proposed", className: "border-emerald-600 bg-emerald-50 text-emerald-800" },
  already_tested: { label: "Already tested", className: "border-amber-500 bg-amber-50 text-amber-900" },
  already_indicated: { label: "Already indicated", className: "border-zinc-400 bg-zinc-100 text-zinc-700" },
};

const TEMPLATE: Record<HypothesisTemplate, string> = {
  target_hop: "via the main target",
  comparator_hop: "via a comparator drug",
  off_target_hop: "via a secondary target",
  route_hop: "formulation / route",
};

const CHIPS_SHOWN = 4;

export function HypothesisPanel({
  hypotheses,
  sources,
  onHover,
}: {
  hypotheses: Hypothesis[];
  sources: Map<string, SourceRef>;
  onHover: (id: string | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(hypotheses[0]?.id ?? null);
  const proposed = hypotheses.filter((h) => h.status === "proposed").length;

  return (
    <div className="rounded-md border border-zinc-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-zinc-100 px-4 py-2.5">
        <div className="text-sm font-semibold text-zinc-900">Repurposing hypotheses</div>
        <span
          className="text-xs text-zinc-500"
          title="Ordered by status, then genetic evidence, then clinical score; never summed into one score"
        >
          {hypotheses.length} found · {proposed} open
        </span>
      </div>
      {hypotheses.length === 0 ? (
        <p className="px-4 py-3 text-sm text-zinc-500">
          No repurposing gap found within two hops. Expand a target or disease node to look further.
        </p>
      ) : (
        <ol className="divide-y divide-zinc-100">
          {hypotheses.map((h) => (
            <li
              key={h.id}
              className="px-4 py-3 hover:bg-blue-50/40"
              onMouseEnter={() => onHover(h.id)}
              onMouseLeave={() => onHover(null)}
            >
              <button type="button" className="w-full text-left" onClick={() => setOpen(open === h.id ? null : h.id)}>
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS[h.status].className}`}>
                    {STATUS[h.status].label}
                  </span>
                  <span className="text-sm font-medium text-zinc-900">{h.statement}</span>
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{TEMPLATE[h.template]}</div>
              </button>
              {open === h.id && (
                <div className="mt-2 flex flex-col gap-2">
                  <dl className="flex flex-col gap-1.5 text-xs">
                    {h.ladder.map((row, i) => (
                      <RowBadge key={i} kind={row.kind} label={row.label} value={row.value} />
                    ))}
                  </dl>
                  <div className="rounded border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs text-blue-900">
                    <span className="font-semibold">Suggested test: </span>
                    {h.suggestedTest}
                  </div>
                  <SourceChips ids={h.sourceIds} sources={sources} />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RowBadge({ kind, label, value }: { kind: GraphEdgeKind; label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-100 px-2 py-1">
      <dt className="flex flex-wrap items-center gap-1.5 text-zinc-600">
        {kind === "absent" ? (
          <span className="inline-flex shrink-0 items-center rounded border border-red-500 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
            Not found
          </span>
        ) : (
          <EvidenceBadge kind={kind} />
        )}
        {label}
      </dt>
      <dd className="mt-0.5 break-words font-medium text-zinc-900">{value}</dd>
    </div>
  );
}

function SourceChips({ ids, sources }: { ids: string[]; sources: Map<string, SourceRef> }) {
  const [all, setAll] = useState(false);
  const shown = all ? ids : ids.slice(0, CHIPS_SHOWN);
  const hidden = ids.length - CHIPS_SHOWN;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((id) => {
        const s = sources.get(id);
        return s ? (
          <a
            key={id}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            title={`${s.database}: ${s.label}`}
            className="max-w-56 truncate rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-blue-700 hover:border-blue-500 hover:bg-blue-50"
          >
            {id}
          </a>
        ) : (
          <span key={id} title="Not in the retrieved evidence" className="rounded border border-red-400 bg-red-50 px-1.5 py-0.5 font-mono text-[11px] text-red-700">
            unverified: {id}
          </span>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-600 hover:border-blue-500 hover:text-blue-700"
        >
          {all ? "show fewer" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}
