import { NextRequest, NextResponse } from "next/server";
import fixture from "@/fixtures/graph.json";
import type { ApiError, BenchmarkResult, GraphResult, TrialsResult } from "@/lib/contracts";
import { graphDemoKey, readDemo } from "@/lib/demo";
import { buildGraph } from "@/lib/kg/build";
import { enrichGraph } from "@/lib/kg/enrich";
import { generateHypotheses } from "@/lib/kg/hypotheses";

// POST /api/graph  body: { benchmark: BenchmarkResult, trials?: TrialsResult }   (?mock=1 for the fixture,
// ?demo=1 for the recording keyed by benchmark.query + resolved target). Builds the evidence graph
// (docs/KG_PRD.md §4) from the already-retrieved payloads, enriches it live (Open Targets, routes,
// indications, mechanisms) and runs the hypothesis templates. Enrichment and hypotheses never fail the
// request: a partial graph still renders.
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("mock") === "1") return NextResponse.json(fixture as unknown as GraphResult);

  let body: { benchmark: BenchmarkResult; trials?: TrialsResult };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>({ error: "Body must be JSON: { benchmark, trials? }" }, { status: 400 });
  }
  const invalid = validateBody(body);
  if (invalid) return NextResponse.json<ApiError>({ error: invalid }, { status: 400 });

  if (req.nextUrl.searchParams.get("demo") === "1") {
    const { candidate, disease } = body.benchmark.query;
    const recorded = await readDemo<GraphResult>(graphDemoKey(candidate, disease, body.benchmark.target.chemblId));
    if (recorded) return NextResponse.json(recorded);
  }

  try {
    let graph = buildGraph(body.benchmark, body.trials ?? undefined);
    try {
      graph = await enrichGraph(graph, body.benchmark);
    } catch (e) {
      console.warn("[graph] enrichment failed — serving the unenriched graph:", e);
    }
    try {
      graph = await generateHypotheses(graph, body.benchmark);
    } catch (e) {
      console.warn("[graph] hypothesis generation failed — serving the graph without hypotheses:", e);
      graph = { ...graph, hypotheses: [] };
    }
    return NextResponse.json<GraphResult>(graph);
  } catch (e) {
    console.error(e);
    return NextResponse.json<ApiError>(
      { error: e instanceof Error ? e.message : "Graph construction failed." },
      { status: 502 },
    );
  }
}

/** Same shape checks as /api/report: returns the error message, or null if OK. */
function validateBody(body: unknown): string | null {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(body) || !isObj(body.benchmark)) return "Body must be an object: { benchmark, trials? }";
  const b = body.benchmark;
  if (!isObj(b.candidate) || !isObj(b.candidate.compound)) return "benchmark.candidate.compound is required";
  if (!Array.isArray(b.comparators)) return "benchmark.comparators must be an array";
  if (!Array.isArray(b.matchedAssays)) return "benchmark.matchedAssays must be an array";
  if (!isObj(b.target)) return "benchmark.target is required";
  if (!isObj(b.query)) return "benchmark.query is required";
  if (body.trials != null && (!isObj(body.trials) || !Array.isArray(body.trials.trials)))
    return "trials, if sent, must be { trials: Trial[] }";
  return null;
}
