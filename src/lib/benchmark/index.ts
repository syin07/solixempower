// Builds a BenchmarkResult: candidate vs. drugs acting on the same target, using only
// comparable measurements (PRD §7). Every exclusion is counted and surfaced as a warning.
import {
  getActivities,
  getIndicatedFor,
  getMechanismDrugs,
  resolveMolecule,
  selectTarget,
  type RawActivity,
  type RawMolecule,
  type RawTarget,
  type TargetSelection,
} from "@/lib/chembl/api";
import { ChemblNotFound, chemblUrl } from "@/lib/chembl/client";
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
const SALT_SUFFIX = /(\s+(ANHYDROUS|HYDROCHLORIDE|MESYLATE|MALEATE|DIMALEATE|TOSYLATE|MONOHYDRATE|HYDRATE|SODIUM))+$/i;
/** Display name: preferred name without trailing salt/hydrate words, else the ChEMBL ID. */
const displayName = (m: RawMolecule) => m.pref_name?.replace(SALT_SUFFIX, "") || m.molecule_chembl_id;

export async function buildBenchmark(query: {
  candidate: string;
  disease: string;
  target?: string;
}): Promise<BenchmarkResult> {
  const candidateMol = await resolveMolecule(query.candidate);
  const type = candidateMol.molecule_type;
  if (!query.target && type && type !== "Small molecule" && type !== "Unknown") {
    const article = /^[aeiou]/i.test(type) ? "an" : "a";
    throw new ChemblNotFound(
      candidateMol.molecule_chembl_id,
      `${displayName(candidateMol)} is ${article} ${type.toLowerCase()} (biologic); ChEMBL potency benchmarking here covers small molecules.`,
    );
  }
  const selection = await selectTarget(candidateMol.molecule_chembl_id, query.target);
  const target = selection.target;
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
  const indicated = query.disease
    ? await getIndicatedFor(
        comparators.map((b) => b.compound.chemblId),
        query.disease,
      ).catch(() => null)
    : null;

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
      selection,
      disease: query.disease,
      indicated,
      candidateExcluded: excludedFor(excluded, [candidateId]),
      comparatorExcluded: excludedFor(
        excluded,
        comparators.map((b) => b.compound.chemblId),
      ),
      excludedVariants: topVariants(excluded.filter((x) => x.reason === "mutant" && shownIds.has(x.a.parent_molecule_chembl_id))),
    }),
    candidateTargets: selection.ranked.map(({ target: t, n }) => ({ chemblId: t.target_chembl_id, name: t.pref_name, n })),
  };
}

/** The activity type with the most comparable candidate measurements (IC50 wins ties). */
function pickActivityType(candidateActs: RawActivity[]): ActivityType {
  let best: ActivityType = "IC50";
  let bestCount = 0;
  for (const t of ACTIVITY_TYPES) {
    const n = candidateActs.filter((a) => a.standard_type === t && exclusionReason(a) === null).length;
    if (n > bestCount) [best, bestCount] = [t, n];
  }
  return best;
}

type ExclusionReason = "mutant" | "nonBinding" | "notPurified" | "inexact" | "flagged" | "otherType";
type ExclusionCounts = Record<ExclusionReason, number>;
type Excluded = { a: RawActivity; reason: ExclusionReason };
const noExclusions = (): ExclusionCounts => ({ mutant: 0, nonBinding: 0, notPurified: 0, inexact: 0, flagged: 0, otherType: 0 });

/** Why a measurement isn't comparable (PRD §7), or null. Without `type`, the activity type isn't checked. */
function exclusionReason(a: RawActivity, type?: ActivityType): ExclusionReason | null {
  if (type && a.standard_type !== type) return "otherType";
  if (a.assay_type !== "B") return "nonBinding";
  // ChEMBL tags some cell assays as "B"; only purified-protein assays are comparable potency
  if (a.bao_label !== "single protein format") return "notPurified";
  if (a.standard_relation !== "=") return "inexact";
  if (a.assay_variant_mutation) return "mutant";
  if (a.data_validity_comment || a.potential_duplicate) return "flagged";
  return null;
}

/** Keeps comparable measurements; returns the excluded ones with their reason. */
function filterComparable(acts: RawActivity[], type: ActivityType) {
  const excluded: Excluded[] = [];
  const kept = acts.filter((a) => {
    const reason = exclusionReason(a, type);
    if (reason) excluded.push({ a, reason });
    return reason === null && a.pchembl_value !== null;
  });
  return { kept, excluded };
}

function excludedFor(excluded: Excluded[], ids: string[]): ExclusionCounts {
  const want = new Set(ids);
  const total = noExclusions();
  for (const x of excluded) if (want.has(x.a.parent_molecule_chembl_id)) total[x.reason]++;
  return total;
}

/** Most common mutant variants among excluded rows, e.g. ["L858R", "T790M,L858R"]. */
function topVariants(mutants: Excluded[], k = 3): string[] {
  return [...groupBy(mutants, (x) => x.a.assay_variant_mutation ?? "").entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, k)
    .map(([v]) => v);
}

function toCompound(m: RawMolecule, isCandidate: boolean): Compound {
  const p = m.molecule_properties;
  const num = (v: string | null | undefined) => (v == null ? undefined : Number(v));
  return {
    chemblId: m.molecule_chembl_id,
    name: displayName(m),
    maxPhase: toPhase(m.max_phase),
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
      label: displayName(m),
      url: chemblUrl.compound(m.molecule_chembl_id),
    },
  };
}

/** ChEMBL max_phase → 1–4 or null. ≤ 0 (incl. -1 "unknown") → null; 0.5 (early phase 1) → 1. */
function toPhase(v: string | null): number | null {
  const n = Number(v);
  return n > 0 ? Math.max(n, 1) : null;
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
        .map(([id, rows]) => {
          const med = median(rows.map((r) => Number(r.pchembl_value)));
          const dist = (r: RawActivity) => Math.abs(Number(r.pchembl_value) - med);
          const closest = rows.reduce((best, r) => (dist(r) < dist(best) ? r : best));
          const mol = molById.get(id);
          return {
            compoundChemblId: id,
            compoundName: mol ? displayName(mol) : id,
            pchembl: round(med),
            source: toMeasurement(closest).source,
          };
        })
        .sort((a, b) => b.pchembl - a.pchembl),
    });
  }
  return out;
}

const EXCLUSION_LABELS: [Exclude<ExclusionReason, "otherType">, string][] = [
  ["mutant", "against mutant target variants"],
  ["nonBinding", "from functional (non-binding) assays"],
  ["notPurified", "from cell-based or non-purified-protein assays"],
  ["inexact", 'censored (e.g. ">10 µM")'],
  ["flagged", "flagged by ChEMBL as potential duplicates or data-validity issues"],
];

function buildWarnings(x: {
  candidate: CompoundBenchmark;
  comparators: CompoundBenchmark[];
  activityType: ActivityType;
  selection: TargetSelection;
  disease: string;
  /** Comparators with a matching ChEMBL indication; null = not checked */
  indicated: Set<string> | null;
  candidateExcluded: ExclusionCounts;
  comparatorExcluded: ExclusionCounts;
  excludedVariants: string[];
}): string[] {
  const w: string[] = [];
  const name = x.candidate.compound.name;
  const t = x.selection.target;
  if (x.selection.how === "mostMeasured") {
    const mech = x.selection.mechanismTargets.map(
      (m: RawTarget) => `${m.pref_name} [${m.target_chembl_id}, ${m.target_type.toLowerCase()}, ${m.organism}]`,
    );
    w.push(
      `Target auto-selected as the candidate's most-measured target; it is not a recorded mechanism target for ${name}` +
        (mech.length ? ` (ChEMBL records its mechanism on ${mech.join("; ")}, not a human single protein).` : "."),
    );
  }
  if (t.organism !== "Homo sapiens")
    w.push(`Target ${t.pref_name} (${t.target_chembl_id}) is from ${t.organism}, not human; results may not translate to the human target.`);
  if (x.activityType !== "IC50")
    w.push(
      `Ranking uses ${x.activityType}, the candidate's most-measured comparable activity type, not IC50. ` +
        `${x.activityType} and IC50 values are not interchangeable.`,
    );
  if (x.candidate.n === 0)
    w.push(`No comparable ${x.activityType} binding measurements for the candidate on this target.`);
  else if (x.candidate.n < 3)
    w.push(`Candidate has only ${x.candidate.n} comparable measurement(s); its ranking is uncertain.`);
  if (x.comparators.length === 0)
    w.push("No approved or clinical drugs with comparable measurements on this target were found.");
  const lowN = x.comparators.filter((b) => b.n < 3);
  if (lowN.length)
    w.push(
      `${lowN.map((b) => `${b.compound.name} (n=${b.n})`).join(", ")}: fewer than 3 comparable measurements; ` +
        `ranking uncertain.`,
    );
  if (x.comparators.length) {
    const forDisease = x.disease ? ` for "${x.disease}"` : "";
    let msg = `Comparators are drugs with a ChEMBL mechanism on ${t.pref_name}, chosen by target, not by indication${forDisease}.`;
    if (x.indicated) {
      const names = x.comparators.filter((b) => x.indicated!.has(b.compound.chemblId)).map((b) => b.compound.name);
      msg += names.length
        ? ` Of these, ${names.join(", ")} ${names.length === 1 ? "has" : "have"} a ChEMBL indication record matching "${x.disease}".`
        : ` None of them has a ChEMBL indication record matching "${x.disease}".`;
    }
    w.push(msg);
  }
  for (const [reason, label] of EXCLUSION_LABELS) {
    const c = x.candidateExcluded[reason];
    const k = x.comparatorExcluded[reason];
    if (c + k === 0) continue;
    let msg =
      `${c + k} ${x.activityType} measurement(s) ${label} excluded from the ranking — ` +
      `${c} for the candidate, ${k} across the ${x.comparators.length} comparators shown.`;
    if (reason === "mutant")
      msg +=
        ` Most common: ${x.excludedVariants.join("; ")}. Only wild-type measurements are ranked, so ` +
        `mutant-selective drugs may look weaker here than in their (mutant-driven) clinical setting.`;
    w.push(msg);
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
