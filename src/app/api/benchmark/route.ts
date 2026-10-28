// STUB — Sandy replaces with the real ChEMBL pipeline. Keep the response shape (BenchmarkResult).
import { NextResponse } from "next/server";
import fixture from "@/fixtures/benchmark.json";
import type { BenchmarkResult } from "@/lib/contracts";

export async function GET() {
  return NextResponse.json(fixture as unknown as BenchmarkResult);
}
