// Builds a BenchmarkResult: candidate vs. drugs acting on the same target, using only
// comparable measurements (PRD §7). Every exclusion is counted and surfaced as a warning.
import {
  getActivities,
  getMechanismDrugs,
  getTarget,
  pickTarget,
  resolveMolecule,
  type RawActivity,
  type RawMolecule,
} from "@/lib/chembl/api";
import { chemblUrl } from "@/lib/chembl/client";
import type {
  ActivityType,
  BenchmarkResult,
  Compound,
  CompoundBenchmark,
  MatchedAssay,
  Measurement,
} from "@/lib/contracts";

const ACTIVITY_TYPES: ActivityType[] = ["IC50", "Ki", "Kd", "EC50"];
const MAX_COMPARATORS = 12;
const isChemblId = (s: string) => /^CHEMBL\d+$/i.test(s.trim());

export async function buildBenchmark(query: {
  candidate: string;
  disease: string;
  target?: string;
}): Promise<BenchmarkResult> {
  const candidateMol = await resolveMolecule(query.candidate);
  const target = query.target ? await getTarget(query.target) : await pickTarget(candidateMol.molecule_chembl_id);
  const comparatorMols = (await getMechanismDrugs(target.target_chembl_id)).filter(
    (m) => m.molecule_chembl_id !== candidateMol.molecule_chembl_id,
  );

  const allMols = [candidateMol, ...comparatorMols];
  const raw = await getActivities({
    molecules: allMols.map((m) => m.molecule_chembl_id),
    target: target.target_chembl_id,
  });

  const candidateId = candidateMol.molecule_chembl_id;
  const activityType = pickActivityType(raw.filter((a) => a.parent_molecule_chembl_id === candidateId));
  const { kept, excluded } = filterComparable(raw, activityType);

  const byCompound = groupBy(kept, (a) => a.parent_molecule_chembl_id);
  const molById = new Map(allMols.map((m) => [m.molecule_chembl_id, m]));
  // Candidates without a preferred name in ChEMBL show as the name the user typed
  if (!candidateMol.pref_name && !isChemblId(query.candidate)) candidateMol.pref_name = query.candidate;
  const benchmarks = [...byCompound.entries()].map(([id, acts]) =>
    toBenchmark(molById.get(id)!, acts, id === candidateId),
  );

  // Keep the most advanced comparators — within a phase, prefer ones sharing an assay with the
  // candidate, then the best-measured — then rank candidate + comparators together
  const candidateAssays = new Set(byCompound.get(candidateId)?.map((a) => a.assay_chembl_id));
  const sharesAssay = (b: CompoundBenchmark) => b.measurements.some((m) => candidateAssays.has(m.assayChemblId));
  const comparators = benchmarks
    .filter((b) => !b.compound.isCandidate)
    .sort(
      (a, b) =>
        Number(b.compound.maxPhase ?? 0) - Number(a.compound.maxPhase ?? 0) ||
        Number(sharesAssay(b)) - Number(sharesAssay(a)) ||
        b.n - a.n,
    )
    .slice(0, MAX_COMPARATORS);
  const candidateBench = benchmarks.find((b) => b.compound.isCandidate);
  const ranked = [...comparators, ...(candidateBench ? [candidateBench] : [])]
    .sort((a, b) => b.medianPchembl - a.medianPchembl)
    .map((b, i) => ({ ...b, rank: i + 1 }));
  const candidate = ranked.find((b) => b.compound.isCandidate) ?? emptyBenchmark(toCompound(candidateMol, true));
  // Matched assays and exclusion counts cover only the compounds actually shown
  const shownIds = new Set([candidateId, ...comparators.map((b) => b.compound.chemblId)]);

  return {
    query: { candidate: query.candidate, disease: query.disease, targetChemblId: target.target_chembl_id },
    target: {
      chemblId: target.target_chembl_id,
      name: target.pref_name,
      organism: target.organism,
      source: {
        id: `chembl-target:${target.target_chembl_id}`,
        database: "ChEMBL",
        label: target.target_chembl_id,
        url: chemblUrl.target(target.target_chembl_id),
      },
    },
    activityType,
    candidate,
    comparators: ranked.filter((b) => !b.compound.isCandidate),
    matchedAssays: findMatchedAssays(
      kept.filter((a) => shownIds.has(a.parent_molecule_chembl_id)),
      candidateId,
      molById,
    ),
    warnings: buildWarnings({
      candidate,
      comparators,
      activityType,
      candidateExcluded: excludedFor(excluded, [candidateId]),
      comparatorExcluded: excludedFor(
        excluded,
        comparators.map((b) => b.compound.chemblId),
      ),
    }),
  };
}

/** The activity type with the most candidate measurements (IC50 wins ties). */
function pickActivityType(candidateActs: RawActivity[]): ActivityType {
  let best: ActivityType = "IC50";
  let bestCount = 0;
  for (const t of ACTIVITY_TYPES) {
    const n = candidateActs.filter((a) => a.standard_type === t).length;
    if (n > bestCount) [best, bestCount] = [t, n];
  }
  return best;
}

type ExclusionReason = "mutant" | "nonBinding" | "notPurified" | "inexact" | "flagged" | "otherType";
type ExclusionCounts = Record<ExclusionReason, number>;
const noExclusions = (): ExclusionCounts => ({ mutant: 0, nonBinding: 0, notPurified: 0, inexact: 0, flagged: 0, otherType: 0 });

/** Keeps comparable measurements; counts exclusions per parent compound. */
function filterComparable(acts: RawActivity[], type: ActivityType) {
  const excluded = new Map<string, ExclusionCounts>();
  const kept = acts.filter((a) => {
    let reason: ExclusionReason | null = null;
    if (a.standard_type !== type) reason = "otherType";
    else if (a.assay_type !== "B") reason = "nonBinding";
    // ChEMBL tags some cell assays as "B"; only purified-protein assays are comparable potency
    else if (a.bao_label !== "single protein format") reason = "notPurified";
    else if (a.standard_relation !== "=") reason = "inexact";
    else if (a.assay_variant_mutation) reason = "mutant";
    else if (a.data_validity_comment || a.potential_duplicate) reason = "flagged";
    if (reason) {
      const counts = excluded.get(a.parent_molecule_chembl_id) ?? noExclusions();
      counts[reason]++;
      excluded.set(a.parent_molecule_chembl_id, counts);
    }
    return reason === null && a.pchembl_value !== null;
  });
  return { kept, excluded };
}

function excludedFor(excluded: Map<string, ExclusionCounts>, ids: string[]): ExclusionCounts {
  const total = noExclusions();
  for (const id of ids) {
    const counts = excluded.get(id);
    if (!counts) continue;
    for (const k of Object.keys(total) as ExclusionReason[]) total[k] += counts[k];
  }
  return total;
}

function toCompound(m: RawMolecule, isCandidate: boolean): Compound {
  const p = m.molecule_properties;
  const num = (v: string | null | undefined) => (v == null ? undefined : Number(v));
  return {
    chemblId: m.molecule_chembl_id,
    name: m.pref_name ?? m.molecule_chembl_id,
    maxPhase: m.max_phase == null ? null : Number(m.max_phase),
    isCandidate,
    properties: p
      ? {
          molecularWeight: num(p.full_mwt),
          alogp: num(p.alogp),
          ro5Violations: p.num_ro5_violations ?? undefined,
          qed: num(p.qed_weighted),
        }
      : undefined,
    source: {
      id: `chembl-mol:${m.molecule_chembl_id}`,
      database: "ChEMBL",
      label: m.pref_name ?? m.molecule_chembl_id,
      url: chemblUrl.compound(m.molecule_chembl_id),
    },
  };
}

function toMeasurement(a: RawActivity): Measurement {
  return {
    compoundChemblId: a.parent_molecule_chembl_id,
    assayChemblId: a.assay_chembl_id,
    assayDescription: a.assay_description,
    assayType: a.assay_type as Measurement["assayType"],
    activityType: a.standard_type as ActivityType,
    valueNm: Number(a.standard_value),
    pchembl: Number(a.pchembl_value),
    source: {
      id: `chembl-act:${a.activity_id}`,
      database: "ChEMBL",
      label: `Activity ${a.activity_id} (${a.assay_chembl_id})`,
      url: chemblUrl.assay(a.assay_chembl_id),
    },
  };
}

function toBenchmark(m: RawMolecule, acts: RawActivity[], isCandidate: boolean): CompoundBenchmark {
  const measurements = acts.map(toMeasurement);
  const values = measurements.map((x) => x.pchembl);
  return {
    compound: toCompound(m, isCandidate),
    n: values.length,
    medianPchembl: round(median(values)),
    minPchembl: round(Math.min(...values)),
    maxPchembl: round(Math.max(...values)),
    rank: 0,
    measurements,
  };
}

function emptyBenchmark(compound: Compound): CompoundBenchmark {
  return { compound, n: 0, medianPchembl: 0, minPchembl: 0, maxPchembl: 0, rank: 0, measurements: [] };
}

/** Assays where the candidate and at least one comparator were both measured. */
function findMatchedAssays(
  kept: RawActivity[],
  candidateId: string,
  molById: Map<string, RawMolecule>,
): MatchedAssay[] {
  const out: MatchedAssay[] = [];
  for (const [assayId, acts] of groupBy(kept, (a) => a.assay_chembl_id)) {
    const perCompound = groupBy(acts, (a) => a.parent_molecule_chembl_id);
    if (!perCompound.has(candidateId) || perCompound.size < 2) continue;
    out.push({
      assayChemblId: assayId,
      assayDescription: acts[0].assay_description,
      rows: [...perCompound.entries()]
        .map(([id, rows]) => ({
          compoundChemblId: id,
          compoundName: molById.get(id)?.pref_name ?? id,
          pchembl: round(median(rows.map((r) => Number(r.pchembl_value)))),
          source: toMeasurement(rows[0]).source,
        }))
        .sort((a, b) => b.pchembl - a.pchembl),
    });
  }
  return out;
}

const EXCLUSION_LABELS: [Exclude<ExclusionReason, "otherType">, string][] = [
  ["mutant", "against mutant target variants (not comparable to wild-type)"],
  ["nonBinding", "from functional (non-binding) assays"],
  ["notPurified", "from cell-based or non-purified-protein assays"],
  ["inexact", 'censored (e.g. ">10 µM")'],
  ["flagged", "flagged by ChEMBL as potential duplicates or data-validity issues"],
];

function buildWarnings(x: {
  candidate: CompoundBenchmark;
  comparators: CompoundBenchmark[];
  activityType: ActivityType;
  candidateExcluded: ExclusionCounts;
  comparatorExcluded: ExclusionCounts;
}): string[] {
  const w: string[] = [];
  if (x.candidate.n === 0)
    w.push(`No comparable ${x.activityType} binding measurements for the candidate on this target.`);
  else if (x.candidate.n < 3)
    w.push(`Candidate has only ${x.candidate.n} comparable measurement(s); its ranking is uncertain.`);
  if (x.comparators.length === 0)
    w.push("No approved or clinical drugs with comparable measurements on this target were found.");
  for (const [reason, label] of EXCLUSION_LABELS) {
    const c = x.candidateExcluded[reason];
    const k = x.comparatorExcluded[reason];
    if (c + k === 0) continue;
    w.push(
      `${c + k} ${x.activityType} measurement(s) ${label} excluded from the ranking — ` +
        `${c} for the candidate, ${k} across the ${x.comparators.length} comparators shown.`,
    );
  }
  w.push(
    `Measurements come from different assays and labs; ranks are indicative. Matched-assay comparisons are the strongest evidence.`,
  );
  return w;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round = (x: number) => Math.round(x * 100) / 100;
