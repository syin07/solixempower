import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fixture from "@/fixtures/report.json";
import { generateReport } from "@/lib/agent/report";
import type { ApiError, BenchmarkResult, EvidenceReport, TrialsResult } from "@/lib/contracts";

// POST /api/report  body: { benchmark: BenchmarkResult, trials?: TrialsResult }   (?mock=1 for the fixture)
export async function POST(req: NextRequest) {
  const mockReport = NextResponse.json(fixture as unknown as EvidenceReport);
  if (req.nextUrl.searchParams.get("mock") === "1") return mockReport;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY not set — serving the mock report");
    return mockReport;
  }

  let body: { benchmark?: BenchmarkResult; trials?: TrialsResult };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>({ error: "Body must be JSON: { benchmark, trials? }" }, { status: 400 });
  }
  if (!body.benchmark?.candidate) {
    return NextResponse.json<ApiError>({ error: "benchmark is required" }, { status: 400 });
  }

  try {
    return NextResponse.json<EvidenceReport>(await generateReport(body.benchmark, body.trials));
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
