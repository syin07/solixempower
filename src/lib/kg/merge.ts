// Pure merge of an expand-on-click delta into a GraphResult (docs/KG_PRD.md R1). Dedupes by id, keeps
// the existing element when ids collide, appends new sources and stamps builtAt.
import type { GraphEdge, GraphNode, GraphResult, SourceRef } from "@/lib/contracts";

export interface GraphDelta {
  nodes: GraphNode[];
  edges: GraphEdge[];
  sources: SourceRef[];
  /** Human notes about what was skipped (e.g. "no EFO id, ChEMBL indications skipped") */
  notes?: string[];
}

export function mergeDelta(graph: GraphResult, delta: GraphDelta): GraphResult {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  const sourceIds = new Set(graph.sources.map((s) => s.id));
  const nodes = [...graph.nodes, ...delta.nodes.filter((n) => !nodeIds.has(n.id) && (nodeIds.add(n.id), true))];
  const edges = [...graph.edges, ...delta.edges.filter((e) => !edgeIds.has(e.id) && (edgeIds.add(e.id), true))];
  const sources = [...graph.sources, ...delta.sources.filter((s) => !sourceIds.has(s.id) && (sourceIds.add(s.id), true))];
  return { ...graph, nodes, edges, sources, builtAt: new Date().toISOString() };
}

/** Elements of `after` that `before` does not have (by id). */
export function diffGraphs(before: GraphResult, after: GraphResult): GraphDelta {
  const nodeIds = new Set(before.nodes.map((n) => n.id));
  const edgeIds = new Set(before.edges.map((e) => e.id));
  const sourceIds = new Set(before.sources.map((s) => s.id));
  return {
    nodes: after.nodes.filter((n) => !nodeIds.has(n.id)),
    edges: after.edges.filter((e) => !edgeIds.has(e.id)),
    sources: after.sources.filter((s) => !sourceIds.has(s.id)),
  };
}
