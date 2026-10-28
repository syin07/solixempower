// STUB — Sandy builds the basic Claude report (Phase 1); Medhansh hardens it (Phase 2). Keep the response shape (EvidenceReport).
import { NextResponse } from "next/server";
import fixture from "@/fixtures/report.json";
import type { EvidenceReport } from "@/lib/contracts";

export async function POST() {
  return NextResponse.json(fixture as unknown as EvidenceReport);
}
