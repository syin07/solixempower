// Thin ClinicalTrials.gov API v2 client with an in-memory + on-disk cache (same pattern as
// src/lib/chembl/client.ts). Disk entries in .cache/trials are reused for a day, and an older entry
// is still served if the live API fails, so the cache doubles as an offline fallback for the demo.
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://clinicaltrials.gov/api/v2/studies";
const CACHE_DIR = path.join(process.cwd(), ".cache", "trials");
const FRESH_MS = 24 * 60 * 60 * 1000;
const memory = new Map<string, unknown>();

/** Only the fields we map — keeps a 30-study page around 25 KB instead of ~1 MB. */
export const STUDY_FIELDS = [
  "protocolSection.identificationModule.nctId",
  "protocolSection.identificationModule.briefTitle",
  "protocolSection.statusModule.overallStatus",
  "protocolSection.statusModule.startDateStruct.date",
  "protocolSection.designModule.phases",
  "protocolSection.designModule.enrollmentInfo.count",
  "protocolSection.conditionsModule.conditions",
  "protocolSection.armsInterventionsModule.interventions.name",
  "protocolSection.armsInterventionsModule.interventions.type",
  "protocolSection.outcomesModule.primaryOutcomes.measure",
  "hasResults",
].join(",");

/** The subset of a v2 study record that STUDY_FIELDS returns. */
export interface CtgovStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    statusModule?: { overallStatus?: string; startDateStruct?: { date?: string } };
    designModule?: { phases?: string[]; enrollmentInfo?: { count?: number } };
    conditionsModule?: { conditions?: string[] };
    armsInterventionsModule?: { interventions?: { name?: string; type?: string }[] };
    outcomesModule?: { primaryOutcomes?: { measure?: string }[] };
  };
  hasResults?: boolean;
}

export interface CtgovPage {
  studies?: CtgovStudy[];
  totalCount?: number;
  nextPageToken?: string;
}

export async function ctgovStudies(params: Record<string, string | number | undefined>): Promise<CtgovPage> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
  const url = `${BASE}?${qs}`;
  if (memory.has(url)) return memory.get(url) as CtgovPage;

  const file = path.join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".json");
  let stale: CtgovPage | undefined;
  try {
    const [raw, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const hit = JSON.parse(raw) as CtgovPage;
    if (Date.now() - info.mtimeMs < FRESH_MS) {
      memory.set(url, hit);
      return hit;
    }
    stale = hit;
  } catch {}

  let data: CtgovPage;
  try {
    data = await fetchWithRetry(url);
  } catch (e) {
    if (!stale) throw e;
    console.warn(`[trials] ClinicalTrials.gov failed, serving stale cache for ${url}`);
    data = stale;
  }
  memory.set(url, data);
  if (data !== stale)
    mkdir(CACHE_DIR, { recursive: true })
      .then(() => writeFile(file, JSON.stringify(data)))
      .catch(() => {});
  return data;
}

async function fetchWithRetry(url: string, attempts = 3): Promise<CtgovPage> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      // 4xx other than rate limiting won't get better on retry (bad query syntax etc.)
      if (res.status >= 400 && res.status < 500 && res.status !== 429)
        throw new BadRequest(`ClinicalTrials.gov ${res.status}: ${(await res.text()).slice(0, 200)}`);
      if (!res.ok) throw new Error(`ClinicalTrials.gov ${res.status} for ${url}`);
      return (await res.json()) as CtgovPage;
    } catch (e) {
      if (e instanceof BadRequest) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastError;
}

class BadRequest extends Error {}

export const ctgovStudyUrl = (nctId: string) => `https://clinicaltrials.gov/study/${nctId}`;
