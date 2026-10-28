"use client";

// FAERS safety summary for the candidate (owner: safety agent). Reads the candidate's "safety" node
// and its has_adverse_events edge from the graph; renders nothing until that data exists.
import type { GraphResult } from "@/lib/contracts";

export function SafetyCard({ graph }: { graph: GraphResult }) {
  const node = graph.nodes.find((n) => n.type === "safety");
  if (!node) return null;
  return <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">{node.label}</div>;
}
