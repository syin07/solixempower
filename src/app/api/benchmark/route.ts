import { NextRequest, NextResponse } from "next/server";
import fixture from "@/fixtures/benchmark.json";
import { buildBenchmark } from "@/lib/benchmark";
import { ChemblNotFound } from "@/lib/chembl/client";
import type { ApiError, BenchmarkResult } from "@/lib/contracts";

// GET /api/benchmark?candidate=&disease=&target=   (add &mock=1 for the fixture)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("mock") === "1") return NextResponse.json(fixture as unknown as BenchmarkResult);

  const candidate = sp.get("candidate")?.trim();
  if (!candidate) return NextResponse.json<ApiError>({ error: "candidate is required" }, { status: 400 });

  try {
    const result = await buildBenchmark({
      candidate,
      disease: sp.get("disease")?.trim() ?? "",
      target: sp.get("target")?.trim() || undefined,
    });
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
