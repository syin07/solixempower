"use client";

// IP status for the candidate (owner: patent agent). Reads the candidate's "patent" node and its
// has_patent_status edge from the graph; renders nothing until that data exists.
import type { GraphResult } from "@/lib/contracts";

export function PatentCard({ graph }: { graph: GraphResult }) {
  const node = graph.nodes.find((n) => n.type === "patent");
  if (!node) return null;
  return <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">{node.label}</div>;
}
