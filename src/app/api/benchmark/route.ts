import { NextRequest, NextResponse } from "next/server";
import fixture from "@/fixtures/benchmark.json";
import { buildBenchmark } from "@/lib/benchmark";
import { ChemblNotFound } from "@/lib/chembl/client";
import type { ApiError, BenchmarkResult } from "@/lib/contracts";
import { benchmarkDemoKey, readDemo } from "@/lib/demo";

// GET /api/benchmark?candidate=&disease=&target=   (&mock=1 for the fixture, &demo=1 for the recording)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("mock") === "1") return NextResponse.json(fixture as unknown as BenchmarkResult);

  const candidate = sp.get("candidate")?.trim();
  if (!candidate) return NextResponse.json<ApiError>({ error: "candidate is required" }, { status: 400 });

  const disease = sp.get("disease")?.trim() ?? "";
  const target = sp.get("target")?.trim() || undefined;
  if (sp.get("demo") === "1") {
    const recorded = await readDemo<BenchmarkResult>(benchmarkDemoKey(candidate, disease, target));
    if (recorded) return NextResponse.json(recorded);
  }

  try {
    const result = await buildBenchmark({ candidate, disease, target });
    return NextResponse.json<BenchmarkResult>(result);
  } catch (e) {
    const notFound = e instanceof ChemblNotFound;
    console.error(e);
    return NextResponse.json<ApiError>(
      { error: notFound ? e.message : "ChEMBL request failed — try again." },
      { status: notFound ? 404 : 502 },
    );
  }
}
