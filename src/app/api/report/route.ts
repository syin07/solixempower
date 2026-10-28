import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fixture from "@/fixtures/report.json";
import { generateReport } from "@/lib/agent/report";
import type { ApiError, BenchmarkResult, EvidenceReport, GraphResult, TrialsResult } from "@/lib/contracts";
import { readDemo, reportDemoKey } from "@/lib/demo";

// POST /api/report  body: { benchmark: BenchmarkResult, trials?: TrialsResult, graph?: GraphResult }   (?mock=1 for the fixture,
// ?demo=1 for the recording keyed by benchmark.query + resolved target)
export async function POST(req: NextRequest) {
  const mockReport = NextResponse.json(fixture as unknown as EvidenceReport);
  if (req.nextUrl.searchParams.get("mock") === "1") return mockReport;

  let body: { benchmark: BenchmarkResult; trials?: TrialsResult; graph?: GraphResult };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>({ error: "Body must be JSON: { benchmark, trials? }" }, { status: 400 });
  }
  const invalid = validateBody(body);
  if (invalid) return NextResponse.json<ApiError>({ error: invalid }, { status: 400 });

  if (req.nextUrl.searchParams.get("demo") === "1") {
    const { candidate, disease } = body.benchmark.query;
    const recorded = await readDemo<EvidenceReport>(reportDemoKey(candidate, disease, body.benchmark.target.chemblId));
    if (recorded) return NextResponse.json(recorded);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY not set — serving the mock report");
    return mockReport;
  }

  try {
    return NextResponse.json<EvidenceReport>(await generateReport(body.benchmark, body.trials ?? undefined, body.graph ?? undefined));
  } catch (e) {
    console.error(e);
    const message =
      e instanceof Anthropic.RateLimitError
        ? "AI service is busy — try again in a moment."
        : e instanceof Anthropic.APIError
          ? `AI service error (${e.status}).`
          : e instanceof Error
            ? e.message
            : "Report generation failed.";
    return NextResponse.json<ApiError>({ error: message }, { status: 502 });
  }
}

/** Shape check before anything dereferences the body; returns the error message, or null if OK. */
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
  if (body.graph != null && (!isObj(body.graph) || !Array.isArray(body.graph.hypotheses) || !Array.isArray(body.graph.sources)))
    return "graph, if sent, must be a GraphResult";
  return null;
}
