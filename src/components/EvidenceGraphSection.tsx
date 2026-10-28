"use client";

// Evidence graph section (docs/KG_PRD.md §3 step 5): legend + lane graph on the left, hypotheses and the
// selected edge's record on the right. Cytoscape needs `window`, so the graph is loaded client-only.
import dynamic from "next/dynamic";
import { useState } from "react";
import type { GraphEdge, GraphResult, SourceRef } from "@/lib/contracts";
import { graphHeight } from "@/lib/kg/layout";
import { EdgeDrawer } from "./EdgeDrawer";
import { GraphLegend } from "./GraphLegend";
import { MockBanner } from "./MockBanner";
import { Section } from "./Section";

const KnowledgeGraph = dynamic(() => import("./KnowledgeGraph"), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-zinc-500">Loading graph view…</div>,
});

export function EvidenceGraphSection({
  graph,
  sources,
  highlightEdgeIds,
  onHoverHypothesis,
}: {
  graph: GraphResult;
  /** Every SourceRef retrieved so far, for the hypothesis panel's source chips */
  sources: Map<string, SourceRef>;
  /** Externally controlled path highlight (falls back to the internal hypothesis-hover state) */
  highlightEdgeIds?: string[];
  onHoverHypothesis?: (id: string | null) => void;
}) {
  const [selected, setSelected] = useState<GraphEdge | null>(null);
  const [hovered, setHovered] = useState<string[]>([]);
  void sources; // used by HypothesisPanel once M3 lands
  void onHoverHypothesis;
  const highlight = highlightEdgeIds?.length ? highlightEdgeIds : hovered;
  const setHighlight = (ids: string[]) => setHovered(ids);
  void setHighlight; // HypothesisPanel's onHover → setHighlight(hypothesis.pathEdgeIds)

  return (
    <Section
      title="Evidence graph"
      aside={<span className="text-xs text-zinc-500">{graph.hypotheses.length} repurposing hypotheses</span>}
    >
      {graph.isMock && <MockBanner what="this graph" />}
      <p className="mb-3 text-sm text-zinc-600">
        Every edge is a retrieved record. Lanes: drugs → targets → diseases → trials. Hover a node; click an edge to open
        its source.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <GraphLegend graph={graph} />
          <KnowledgeGraph graph={graph} highlightEdgeIds={highlight} onSelectEdge={setSelected} height={graphHeight(graph)} />
        </div>
        <div className="flex flex-col gap-3">
          {/* M3: <HypothesisPanel hypotheses={graph.hypotheses} sources={sources} onHover={(id) => setHighlight(id ? graph.hypotheses.find((h) => h.id === id)?.pathEdgeIds ?? [] : [])} /> goes here */}
          {graph.hypotheses.length === 0 && (
            <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
              <div className="font-semibold text-zinc-700">Repurposing hypotheses</div>
              None generated yet (hypothesis engine pending).
            </div>
          )}
          <EdgeDrawer edge={selected} graph={graph} onClose={() => setSelected(null)} />
        </div>
      </div>
    </Section>
  );
}
