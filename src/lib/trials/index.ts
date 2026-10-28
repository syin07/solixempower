// Clinical landscape (PRD R8): ClinicalTrials.gov trials for the disease x each benchmark drug.
// This is development stage only — we never normalize or compare outcomes across trials (PRD §3).
import type { Trial, TrialsResult } from "@/lib/contracts";
import { ctgovStudies, ctgovStudyUrl, STUDY_FIELDS, type CtgovStudy } from "./client";

/** Studies fetched per drug. Sorted by enrollment so big pivotal trials come first for well-studied drugs. */
const PAGE_SIZE = 30;
/** Max trials in the response. */
const MAX_TRIALS = 60;
/** Each drug keeps at least this many of its best trials, so gefitinib/osimertinib can't crowd out the rest. */
const PER_DRUG_MIN = 3;
/** The candidate (first drug) gets a bigger guaranteed share — its programs are the point of the page. */
const CANDIDATE_MIN = 10;
const CONCURRENCY = 4;

/** Every ClinicalTrials.gov query failed (route → 502). */
export class TrialsUnavailable extends Error {}

export async function getTrials(disease: string, drugs: string[]): Promise<TrialsResult> {
  const t0 = performance.now();
  // No drugs → one disease-only query, so the panel still shows the landscape.
  const queries = drugs.length ? drugs : [undefined];

  const perQuery = await mapLimit(queries, CONCURRENCY, async (drug) => {
    try {
      const page = await ctgovStudies({
        "query.cond": disease,
        "query.intr": drug,
        "filter.advanced": "AREA[StudyType]INTERVENTIONAL",
        sort: "EnrollmentCount:desc",
        pageSize: PAGE_SIZE,
        fields: STUDY_FIELDS,
      });
      return (page.studies ?? []).map(toTrial).filter((t): t is Trial => t !== null);
    } catch (e) {
      console.warn(`[trials] query failed for ${drug ?? "(disease only)"} — skipping:`, e instanceof Error ? e.message : e);
      return null;
    }
  });
  if (perQuery.every((r) => r === null)) throw new TrialsUnavailable("ClinicalTrials.gov request failed — try again.");

  // Dedupe by NCT ID (the same trial often comes back for several drugs, e.g. a head-to-head).
  const byId = new Map<string, Trial>();
  const lists = perQuery.map((list) =>
    (list ?? [])
      .map((t) => {
        const seen = byId.get(t.nctId);
        if (!seen) {
          byId.set(t.nctId, t);
          return t;
        }
        seen.interventions = mergeNames(seen.interventions, t.interventions);
        return seen;
      })
      .sort(compareTrials),
  );

  // Guarantee each drug its top few, then fill by overall order.
  const picked = new Set<string>();
  lists.forEach((list, i) => {
    const quota = i === 0 ? CANDIDATE_MIN : PER_DRUG_MIN;
    for (const t of list.slice(0, quota)) picked.add(t.nctId);
  });
  const all = [...byId.values()].sort(compareTrials);
  for (const t of all) {
    if (picked.size >= MAX_TRIALS) break;
    picked.add(t.nctId);
  }
  const trials = all.filter((t) => picked.has(t.nctId));

  const failed = perQuery.filter((r) => r === null).length;
  console.log(
    `[trials] ${queries.length} queries (${failed} failed), ${byId.size} unique, returning ${trials.length} in ` +
      `${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
  return { query: { disease, drugs }, trials };
}

function toTrial(s: CtgovStudy): Trial | null {
  const p = s.protocolSection;
  const nctId = p?.identificationModule?.nctId;
  if (!p || !nctId) return null;
  return {
    nctId,
    title: p.identificationModule?.briefTitle?.trim() || nctId,
    phase: formatPhase(p.designModule?.phases),
    status: formatStatus(p.statusModule?.overallStatus),
    conditions: p.conditionsModule?.conditions ?? [],
    interventions: mergeNames(
      [],
      (p.armsInterventionsModule?.interventions ?? [])
        .filter((iv) => iv.type === "DRUG" || iv.type === "BIOLOGICAL")
        .map((iv) => iv.name ?? ""),
    ),
    enrollment: typeof p.designModule?.enrollmentInfo?.count === "number" ? p.designModule.enrollmentInfo.count : null,
    hasResults: s.hasResults === true,
    primaryOutcomes: (p.outcomesModule?.primaryOutcomes ?? [])
      .map((o) => clip((o.measure ?? "").replace(/\s+/g, " ").trim(), 200))
      .filter(Boolean)
      .slice(0, 3),
    startDate: p.statusModule?.startDateStruct?.date ?? null,
    source: { id: `nct:${nctId}`, database: "ClinicalTrials.gov", label: nctId, url: ctgovStudyUrl(nctId) },
  };
}

const PHASE_RANK: Record<string, number> = { EARLY_PHASE1: 0.5, PHASE1: 1, PHASE2: 2, PHASE3: 3, PHASE4: 4 };

/** ["PHASE2","PHASE3"] → "Phase 2/3", ["EARLY_PHASE1"] → "Early Phase 1", ["NA"]/[] → "N/A". */
export function formatPhase(phases: string[] = []): string {
  const real = phases.filter((ph) => ph in PHASE_RANK).sort((a, b) => PHASE_RANK[a] - PHASE_RANK[b]);
  if (!real.length) return "N/A";
  if (real.length === 1 && real[0] === "EARLY_PHASE1") return "Early Phase 1";
  return "Phase " + real.map((ph) => (ph === "EARLY_PHASE1" ? "0" : ph.replace("PHASE", ""))).join("/");
}

/** Sort key: "Phase 2/3" → 2.5, "Phase 4" → 4, "Early Phase 1" → 0.5, "N/A" → 0. */
function phaseRank(phase: string): number {
  if (phase === "Early Phase 1") return 0.5;
  const nums = phase.match(/\d/g)?.map(Number) ?? [];
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE_NOT_RECRUITING: "Active, not recruiting",
  UNKNOWN: "Unknown status",
};

/** "NOT_YET_RECRUITING" → "Not yet recruiting". */
function formatStatus(status?: string): string {
  if (!status) return "Unknown status";
  if (STATUS_LABEL[status]) return STATUS_LABEL[status];
  const words = status.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Phase descending, then trials with posted results, then larger enrollment. */
function compareTrials(a: Trial, b: Trial): number {
  return (
    phaseRank(b.phase) - phaseRank(a.phase) ||
    Number(b.hasResults) - Number(a.hasResults) ||
    (b.enrollment ?? -1) - (a.enrollment ?? -1) ||
    a.nctId.localeCompare(b.nctId)
  );
}

/** Union of names, case-insensitive, first spelling wins. */
function mergeNames(a: string[], b: string[]): string[] {
  const out = [...a];
  const seen = new Set(a.map((n) => n.toLowerCase()));
  for (const raw of b) {
    const n = raw.replace(/\s+/g, " ").trim();
    if (n && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      out.push(n);
    }
  }
  return out;
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s);

/** Promise.all with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
