// STUB — Medhansh replaces with the ClinicalTrials.gov v2 client. Keep the response shape (TrialsResult).
import { NextResponse } from "next/server";
import fixture from "@/fixtures/trials.json";
import type { TrialsResult } from "@/lib/contracts";

export async function GET() {
  return NextResponse.json(fixture as unknown as TrialsResult);
}
