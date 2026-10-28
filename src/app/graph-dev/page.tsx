"use client";

// TEMPORARY dev page for S4: renders src/fixtures/graph.json with the graph view, legend and drawer.
// Delete at S6 once KnowledgeGraph is wired into BenchmarkApp.
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import fixture from "@/fixtures/graph.json";
import type { GraphEdge, GraphResult } from "@/lib/contracts";
import { EdgeDrawer } from "@/components/EdgeDrawer";
import { GraphLegend } from "@/components/GraphLegend";

const KnowledgeGraph = dynamic(() => import("@/components/KnowledgeGraph"), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-zinc-500">Loading graph…</div>,
});

export default function GraphDevPage() {
  const graph = fixture as unknown as GraphResult;
  const [selected, setSelected] = useState<GraphEdge | null>(null);
  // ?hl=1 applies the sample path on load (for headless screenshots).
  const [highlight, setHighlight] = useState<string[]>([]);
  const [autoHl] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("hl") === "1");

  // A fake "hypothesis path": candidate → target, plus the candidate's first trial and its disease link.
  const samplePath = useMemo(() => {
    const cand = graph.nodes.find((n) => n.isCandidate);
    if (!cand) return [];
    const measured = graph.edges.find((e) => e.type === "measured_against" && e.from === cand.id);
    const tested = graph.edges.find((e) => e.type === "tested_in" && e.from === cand.id);
    const forDisease = tested && graph.edges.find((e) => e.type === "for_disease" && e.from === tested.to);
    return [measured, tested, forDisease].filter((e): e is GraphEdge => Boolean(e)).map((e) => e.id);
  }, [graph]);

  const effective = highlight.length ? highlight : autoHl ? samplePath : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-bold text-zinc-900">Evidence graph (dev fixture)</h1>
      <div className="flex gap-2 text-sm">
        <button className="rounded border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-50" onClick={() => setHighlight(samplePath)}>
          Highlight path
        </button>
        <button className="rounded border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-50" onClick={() => setHighlight([])}>
          Clear
        </button>
      </div>
      <GraphLegend graph={graph} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <KnowledgeGraph graph={graph} highlightEdgeIds={effective} onSelectEdge={setSelected} />
        </div>
        <EdgeDrawer edge={selected} graph={graph} onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}
