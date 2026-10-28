import { NextRequest, NextResponse } from "next/server";
import type { ApiError, GraphResult } from "@/lib/contracts";
import { expandNode } from "@/lib/kg/expand";
import type { GraphDelta } from "@/lib/kg/merge";

// POST /api/graph/expand  body: { graph: GraphResult, nodeId: string }  → the delta { nodes, edges, sources, notes }
// of the next hop around that node (docs/KG_PRD.md R1). The client merges it with mergeDelta() from
// src/lib/kg/merge.ts. Only target and disease nodes expand; others return an empty delta with a note.
export async function POST(req: NextRequest) {
  let body: { graph: GraphResult; nodeId: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>({ error: "Body must be JSON: { graph, nodeId }" }, { status: 400 });
  }
  const invalid = validateBody(body);
  if (invalid) return NextResponse.json<ApiError>({ error: invalid }, { status: 400 });

  try {
    return NextResponse.json<GraphDelta>(await expandNode(body.graph, body.nodeId));
  } catch (e) {
    console.error(e);
    return NextResponse.json<ApiError>({ error: e instanceof Error ? e.message : "Expansion failed." }, { status: 502 });
  }
}

function validateBody(body: unknown): string | null {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(body) || !isObj(body.graph)) return "Body must be an object: { graph, nodeId }";
  const g = body.graph;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return "graph.nodes and graph.edges must be arrays";
  if (!Array.isArray(g.sources)) return "graph.sources must be an array";
  if (typeof body.nodeId !== "string" || !body.nodeId) return "nodeId is required";
  if (!g.nodes.some((n) => isObj(n) && n.id === body.nodeId)) return `nodeId ${body.nodeId} is not in graph.nodes`;
  return null;
}
