// Demo mode (PRD R11): with ?demo=1 the API routes serve pre-recorded REAL responses from
// src/fixtures/demo/ so the video never waits on ChEMBL or Claude. Record them with
// `npm run demo:record` — scripts/record-demo.mjs duplicates demoKey(), keep the two in sync.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DEMO_DIR = path.join(process.cwd(), "src", "fixtures", "demo");

const slug = (s: string | undefined) =>
  (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "none";

export const benchmarkDemoKey = (candidate: string, disease: string, target?: string) =>
  `benchmark--${slug(candidate)}--${slug(disease)}--${target ? slug(target) : "auto"}`;

/** Keyed on the RESOLVED target (benchmark.target.chemblId), so a target override gets its own report. */
export const reportDemoKey = (candidate: string, disease: string, targetChemblId: string) =>
  `report--${slug(candidate)}--${slug(disease)}--${slug(targetChemblId)}`;

/**
 * Keyed on disease + candidate (first drug) + a short hash of the whole drug list as sent. In demo mode
 * the benchmark is replayed too, so the UI sends the identical list; a different list falls through to live.
 */
export const trialsDemoKey = (disease: string, drugs: string[]) => {
  const list = drugs.map((d) => d.trim().toLowerCase()).join(",");
  const hash = createHash("sha1").update(list).digest("hex").slice(0, 10);
  return `trials--${slug(disease)}--${slug(drugs[0])}--${hash}`;
};

/** The recorded response for `key`, or null (with a warning) so the caller falls through to live. */
export async function readDemo<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(DEMO_DIR, `${key}.json`), "utf8")) as T;
  } catch {
    console.warn(`[demo] no recording for ${key} — serving live. Record it with npm run demo:record.`);
    return null;
  }
}
