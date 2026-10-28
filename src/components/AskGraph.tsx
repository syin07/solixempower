"use client";

// "Ask the graph" (owner: chat agent). Question box whose answers cite graph edge ids; cited edges are
// highlighted via onHighlight. Placeholder until the chat lands.
import type { GraphResult } from "@/lib/contracts";

export function AskGraph({ graph, onHighlight }: { graph: GraphResult; onHighlight: (edgeIds: string[]) => void }) {
  void graph;
  void onHighlight;
  return null;
}
