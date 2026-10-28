"use client";

// Evidence graph section (docs/KG_PRD.md §3 step 5): legend + lane graph on the left, hypotheses and the
// selected edge's record on the right. Cytoscape needs `window`, so the graph is loaded client-only.
// Expand-on-click (R1): clicking a target or disease node fetches its next hop live and merges it in.
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import type { GraphEdge, GraphNode, GraphResult, SourceRef } from "@/lib/contracts";
import { graphHeight } from "@/lib/kg/layout";
import { mergeDelta, type GraphDelta } from "@/lib/kg/merge";
import { EdgeDrawer } from "./EdgeDrawer";
import { GraphLegend } from "./GraphLegend";
import { AskGraph } from "./AskGraph";
import { HypothesisPanel } from "./HypothesisPanel";
import { PatentCard } from "./PatentCard";
import { SafetyCard } from "./SafetyCard";
import { MockBanner } from "./MockBanner";
import { Section } from "./Section";

const KnowledgeGraph = dynamic(() => import("./KnowledgeGraph"), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-zinc-500">Loading graph view…</div>,
});

const EXPANDABLE = new Set<GraphNode["type"]>(["target", "disease"]);
const isExpandable = (n: GraphNode) => EXPANDABLE.has(n.type);

const PLURAL: Record<string, string> = { drug: "drugs", target: "targets", disease: "diseases", trial: "trials", route: "routes", warning: "warnings" };

/** "+6 diseases, +2 targets, +10 edges" for the part of a delta that was actually new. */
function describeDelta(before: GraphResult, delta: GraphDelta): string {
  const had = new Set(before.nodes.map((n) => n.id));
  const hadEdges = new Set(before.edges.map((e) => e.id));
  const counts = new Map<string, number>();
  delta.nodes.filter((n) => !had.has(n.id)).forEach((n) => counts.set(n.type, (counts.get(n.type) ?? 0) + 1));
  const edges = delta.edges.filter((e) => !hadEdges.has(e.id)).length;
  const parts = [...counts].map(([t, c]) => `+${c} ${c === 1 ? t : (PLURAL[t] ?? t)}`);
  if (edges) parts.push(`+${edges} edge${edges === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export function EvidenceGraphSection({
  graph,
  sources,
  highlightEdgeIds,
  onHoverHypothesis,
  demo = false,
}: {
  graph: GraphResult;
  /** Every SourceRef retrieved so far, for the hypothesis panel's source chips */
  sources: Map<string, SourceRef>;
  /** Externally controlled path highlight (falls back to the internal hypothesis-hover state) */
  highlightEdgeIds?: string[];
  onHoverHypothesis?: (id: string | null) => void;
  /** Forward ?demo=1 to the expand call (no recording exists for it; the route falls through to live) */
  demo?: boolean;
}) {
  // Local copy of the graph that expansions merge into; reset whenever a new graph arrives from the parent.
  const [current, setCurrent] = useState<GraphResult>(graph);
  const [expansions, setExpansions] = useState(0);
  const [expanding, setExpanding] = useState<string | null>(null);
  const [growFrom, setGrowFrom] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [hoveredHyp, setHoveredHyp] = useState<string | null>(null);
  // Edges cited by the latest "ask the graph" answer (lowest priority highlight)
  const [askHighlight, setAskHighlight] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string | null>(null);
  // "Adjust state when a prop changes" (react.dev): a new graph from the parent replaces the local copy.
  const [seed, setSeed] = useState(graph);
  if (seed !== graph) {
    setSeed(graph);
    setCurrent(graph);
    setExpansions(0);
    setExpanding(null);
    setGrowFrom(null);
    setToast(null);
    setPinned(null);
    setHoveredHyp(null);
  }

  const [selected, setSelected] = useState<GraphEdge | null>(null);
  // Hovered card wins over the pinned one. Expansions only add elements (mergeDelta), so every
  // hypothesis path edge is still in `current` after an expand.
  const activeHyp = current.hypotheses.find((h) => h.id === (hoveredHyp ?? pinned));
  const highlight = highlightEdgeIds?.length ? highlightEdgeIds : activeHyp ? activeHyp.pathEdgeIds : askHighlight;
  const hoverHypothesis = (id: string | null) => {
    setHoveredHyp(id);
    onHoverHypothesis?.(id);
  };

  const expand = useCallback(
    async (node: GraphNode) => {
      if (expanding) return;
      setExpanding(node.id);
      setToast(null);
      try {
        const res = await fetch(`/api/graph/expand${demo ? "?demo=1" : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ graph: current, nodeId: node.id }),
        });
        const body = (await res.json().catch(() => null)) as (GraphDelta & { error?: string }) | null;
        if (!res.ok || !body || body.error) throw new Error(body?.error ?? `Expand failed (${res.status})`);
        const summary = describeDelta(current, body);
        if (!summary) {
          setToast({ text: body.notes?.length ? `${node.label}: ${body.notes.join("; ")}` : `${node.label}: nothing new within reach of this node.` });
          return;
        }
        setGrowFrom(node.id);
        setCurrent((g) => mergeDelta(g, body));
        setExpansions((n) => n + 1);
        setToast({ text: `Expanded ${node.label}: ${summary}${body.notes?.length ? ` (${body.notes.join("; ")})` : ""}` });
      } catch (e) {
        setToast({ text: `Could not expand ${node.label}: ${e instanceof Error ? e.message : String(e)}`, error: true });
      } finally {
        setExpanding(null);
      }
    },
    [current, demo, expanding],
  );

  return (
    <Section
      title="Evidence graph"
      aside={<span className="text-xs text-zinc-500">{current.hypotheses.length} repurposing hypotheses</span>}
    >
      {current.isMock && <MockBanner what="this graph" />}
      {!current.edges.some((e) => e.type === "associated_with") && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No Open Targets associations were retrieved (service unavailable or no links) — hypotheses are limited to
          indications and trials.
        </p>
      )}
      <p className="mb-3 text-sm text-zinc-600">
        Every edge is a retrieved record. Lanes: drugs → targets → diseases → trials. Hover a node; click an edge to open
        its source; click a target or disease and press <span className="font-medium text-violet-700">Expand +</span> to
        fetch its next hop live.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <GraphLegend graph={current} expansions={expansions} />
          {toast && (
            <p
              role="status"
              className={`rounded-md border px-3 py-1.5 text-xs ${
                toast.error ? "border-red-200 bg-red-50 text-red-700" : "border-violet-200 bg-violet-50 text-violet-800"
              }`}
            >
              {toast.text}
            </p>
          )}
          <KnowledgeGraph
            graph={current}
            highlightEdgeIds={highlight}
            onSelectEdge={setSelected}
            height={graphHeight(current)}
            expandable={isExpandable}
            onExpand={expand}
            expandingNodeId={expanding}
            growFrom={growFrom}
          />
        </div>
        <div className="flex flex-col gap-3">
          <HypothesisPanel
            hypotheses={current.hypotheses}
            graph={current}
            sources={sources}
            pinnedId={pinned}
            onHover={hoverHypothesis}
            onPin={setPinned}
            onSelectEdge={(e) => {
              setSelected(e);
              // The drawer sits below the cards: bring it into view
              requestAnimationFrame(() => document.getElementById("edge-drawer")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
            }}
            expanded={expansions > 0}
          />
          <SafetyCard graph={current} />
          <PatentCard graph={current} />
          <AskGraph graph={current} onHighlight={setAskHighlight} />
          <div id="edge-drawer" className="scroll-mt-4">
            <EdgeDrawer edge={selected} graph={current} onClose={() => setSelected(null)} />
          </div>
        </div>
      </div>
    </Section>
  );
}
