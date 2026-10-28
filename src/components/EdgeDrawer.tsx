import type { EvidenceKind, GraphEdge, GraphNode, GraphResult } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";

const isEvidenceKind = (k: string): k is EvidenceKind => k === "measured" || k === "computed" || k === "clinical" || k === "ai_summary";

const TYPE_LABEL: Record<string, string> = {
  measured_against: "Measured against",
  mechanism: "Mechanism of action",
  indicated_for: "Indicated for",
  tested_in: "Tested in",
  for_disease: "Trial for",
  associated_with: "Associated with",
  administered_by: "Administered by",
  has_warning: "Drug warning",
  absent: "Checked, not found",
};

function MetaValue({ v }: { v: string | number | boolean | string[] | null }) {
  if (v == null) return <span className="text-zinc-400">—</span>;
  if (Array.isArray(v)) return <span>{v.join(", ")}</span>;
  if (typeof v === "boolean") return <span>{v ? "yes" : "no"}</span>;
  return <span>{String(v)}</span>;
}

/** Detail panel for a selected edge: kind badge, endpoints, every meta row (sub-scores as bars), and the record link. */
export function EdgeDrawer({ edge, graph, onClose }: { edge: GraphEdge | null; graph: GraphResult; onClose?: () => void }) {
  if (!edge) {
    return (
      <aside className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
        Click an edge to see the record behind it. Hover a node to see its neighbors.
      </aside>
    );
  }
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const meta = Object.entries(edge.meta ?? {});
  const subScores = meta.filter(([k, v]) => k.startsWith("ot_") && typeof v === "number") as [string, number][];
  const rest = meta.filter(([k]) => !k.startsWith("ot_") && k !== "alsoValid");
  return (
    <aside className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">{TYPE_LABEL[edge.type] ?? edge.type}</div>
          <div className="font-medium text-zinc-900">{edge.label}</div>
        </div>
        {isEvidenceKind(edge.kind) ? (
          <EvidenceBadge kind={edge.kind} />
        ) : (
          <span className="inline-flex shrink-0 items-center rounded border border-red-600 border-dashed bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
            Not found
          </span>
        )}
      </div>
      <div className="text-zinc-700">
        <span className="font-medium">{label(edge.from)}</span> <span className="text-zinc-400">→</span>{" "}
        <span className="font-medium">{label(edge.to)}</span>
      </div>
      {subScores.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-zinc-500">Evidence sub-scores (shown separately, never summed)</div>
          <ul className="flex flex-col gap-1">
            {subScores.map(([k, v]) => (
              <li key={k} className="flex items-center gap-2 text-xs">
                <span className="w-36 shrink-0 text-zinc-700">{k.replace(/^ot_/, "").replace(/_/g, " ")}</span>
                <span className="h-2 flex-1 rounded bg-zinc-100">
                  <span className="block h-2 rounded bg-violet-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%` }} />
                </span>
                <span className="w-10 text-right tabular-nums text-zinc-700">{v.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rest.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rest.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-zinc-500">{k}</dt>
              <dd className="text-zinc-800">
                <MetaValue v={v} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-zinc-100 pt-2 text-xs">
        <span className="text-zinc-500">
          {edge.source.database} · {edge.source.label}
        </span>
        {edge.source.url ? (
          <a href={edge.source.url} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">
            Open record ↗
          </a>
        ) : (
          <span className="text-zinc-400">no record URL (a search, not a database entry)</span>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-800">
            Close
          </button>
        )}
      </div>
    </aside>
  );
}

export type { GraphNode };
