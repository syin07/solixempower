import type { GraphResult } from "@/lib/contracts";
import { drawnTrialIds } from "@/lib/kg/layout";
import { EDGE_COLORS, REGULATORY_COLOR } from "./KnowledgeGraph";

const EDGE_ROWS: { label: string; color: string; dashed?: boolean; note: string }[] = [
  { label: "Measured", color: EDGE_COLORS.measured, note: "ChEMBL activity; width = median pChEMBL" },
  { label: "Computed", color: EDGE_COLORS.computed, dashed: true, note: "Open Targets association; width = score" },
  { label: "Clinical", color: EDGE_COLORS.clinical, note: "indication or trial record" },
  { label: "Regulatory", color: REGULATORY_COLOR, note: "route of administration, drug warning" },
  { label: "Not found", color: EDGE_COLORS.absent, dashed: true, note: "checked on the date shown, no record" },
  { label: "AI summary", color: EDGE_COLORS.ai_summary, note: "hypothesis link" },
];

const NODE_ROWS: { label: string; shape: string }[] = [
  { label: "Drug", shape: "h-3.5 w-3.5 rounded-full bg-zinc-200 border border-zinc-400" },
  { label: "Target", shape: "h-3.5 w-3.5 rotate-45 bg-slate-300 border border-zinc-400" },
  { label: "Disease", shape: "h-3 w-4 rounded bg-zinc-100 border border-zinc-400" },
  { label: "Trial", shape: "h-2.5 w-2.5 bg-zinc-50 border border-zinc-400" },
];

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/** Legend for the evidence graph: text + swatch for every edge kind and node shape, never color alone. */
export function GraphLegend({ graph, expansions = 0 }: { graph: GraphResult; expansions?: number }) {
  const nodes = graph.nodes.filter((n) => n.type !== "hypothesis").length;
  const trials = graph.nodes.filter((n) => n.type === "trial").length;
  const drawnTrials = drawnTrialIds(graph).size;
  const trialNote = drawnTrials < trials ? ` · showing ${drawnTrials} of ${trials} trials (candidate's first)` : "";
  const expandNote = expansions > 0 ? ` · expanded ×${expansions}` : "";
  const provenance = `${nodes} nodes · ${graph.edges.length} edges${trialNote} · ${
    graph.isMock ? "replayed recording" : `built ${hhmm(graph.builtAt)} from live APIs`
  }${expandNote}`;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-700">
      {EDGE_ROWS.map((r) => (
        <span key={r.label} className="inline-flex items-center gap-1.5" title={r.note}>
          <span
            aria-hidden
            className="inline-block h-0 w-6"
            style={{ borderTop: `3px ${r.dashed ? "dashed" : "solid"} ${r.color}` }}
          />
          {r.label}
        </span>
      ))}
      <span className="mx-1 h-4 border-l border-zinc-300" aria-hidden />
      {NODE_ROWS.map((r) => (
        <span key={r.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`inline-block ${r.shape}`} />
          {r.label}
        </span>
      ))}
      <span className="text-zinc-500">comparator indications and trials are faded; hover to raise them</span>
      <span className="ml-auto text-zinc-500">{provenance}</span>
    </div>
  );
}
