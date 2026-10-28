import { NextRequest, NextResponse } from "next/server";
import fixture from "@/fixtures/trials.json";
import type { ApiError, TrialsResult } from "@/lib/contracts";
import { readDemo, trialsDemoKey } from "@/lib/demo";
import { getTrials, TrialsUnavailable } from "@/lib/trials";

// GET /api/trials?disease=&drugs=a,b,c   (candidate first; &mock=1 for the fixture, &demo=1 for the recording)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("mock") === "1") return NextResponse.json(fixture as unknown as TrialsResult);

  const disease = sp.get("disease")?.trim();
  if (!disease) return NextResponse.json<ApiError>({ error: "disease is required" }, { status: 400 });
  const drugs = (sp.get("drugs") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  if (sp.get("demo") === "1") {
    const recorded = await readDemo<TrialsResult>(trialsDemoKey(disease, drugs));
    if (recorded) return NextResponse.json(recorded);
  }

  try {
    return NextResponse.json<TrialsResult>(await getTrials(disease, drugs));
  } catch (e) {
    console.error(e);
    return NextResponse.json<ApiError>(
      { error: e instanceof TrialsUnavailable ? e.message : "ClinicalTrials.gov request failed — try again." },
      { status: 502 },
    );
  }
}
