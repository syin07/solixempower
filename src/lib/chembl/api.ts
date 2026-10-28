// Typed ChEMBL lookups used by the benchmark engine. Raw shapes cover only the fields we use.
import { chemblGet, chemblGetAll, ChemblNotFound } from "./client";

export interface RawMolecule {
  molecule_chembl_id: string;
  pref_name: string | null;
  max_phase: string | null;
  molecule_type: string | null;
  molecule_hierarchy: { parent_chembl_id: string } | null;
  /** Synonyms incl. trade names (e.g. "Tagrisso"); present on search results and molecule lookups */
  molecule_synonyms?: { molecule_synonym: string }[];
  molecule_properties: {
    full_mwt: string | null;
    alogp: string | null;
    num_ro5_violations: number | null;
    qed_weighted: string | null;
  } | null;
}

export interface RawTarget {
  target_chembl_id: string;
  pref_name: string;
  organism: string;
  target_type: string;
}

export interface RawActivity {
  activity_id: number;
  assay_chembl_id: string;
  assay_description: string;
  assay_type: string;
  assay_variant_mutation: string | null;
  /** e.g. "single protein format", "cell-based format" */
  bao_label: string | null;
  data_validity_comment: string | null;
  potential_duplicate: number | null;
  molecule_chembl_id: string;
  parent_molecule_chembl_id: string;
  molecule_pref_name: string | null;
  pchembl_value: string | null;
  standard_relation: string | null;
  standard_type: string;
  standard_units: string | null;
  standard_value: string | null;
  target_chembl_id: string;
  target_organism: string | null;
}

const isChemblId = (s: string) => /^CHEMBL\d+$/i.test(s.trim());

export async function getMolecule(id: string): Promise<RawMolecule> {
  return chemblGet<RawMolecule>(`molecule/${id.toUpperCase()}`);
}

/**
 * Name or ChEMBL ID → the parent molecule (salt forms map to the parent). Names must match a
 * preferred name or synonym exactly (case-insensitive); otherwise we suggest the search hits.
 */
export async function resolveMolecule(query: string): Promise<RawMolecule> {
  const q = query.trim();
  let mol: RawMolecule;
  if (isChemblId(q)) {
    mol = await getMolecule(q);
  } else {
    const { molecules } = await chemblGet<{ molecules: RawMolecule[] }>("molecule/search", { q, limit: 10 });
    const same = (s: string | null | undefined) => s?.trim().toLowerCase() === q.toLowerCase();
    const exact =
      molecules.find((m) => same(m.pref_name)) ??
      molecules.find((m) => m.molecule_synonyms?.some((s) => same(s.molecule_synonym)));
    if (!exact) {
      const named = [...molecules.filter((m) => m.pref_name), ...molecules.filter((m) => !m.pref_name)];
      const hints = [...new Set(named.map((m) => m.pref_name ?? m.molecule_chembl_id))].slice(0, 3);
      throw new ChemblNotFound(`"${q}"${hints.length ? `. Did you mean: ${hints.join(", ")}?` : ""}`);
    }
    mol = exact;
  }
  const parent = mol.molecule_hierarchy?.parent_chembl_id;
  return parent && parent !== mol.molecule_chembl_id ? getMolecule(parent) : mol;
}

export async function getMolecules(ids: string[]): Promise<RawMolecule[]> {
  const out: RawMolecule[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    out.push(
      ...(await chemblGetAll<RawMolecule>("molecule", "molecules", {
        molecule_chembl_id__in: ids.slice(i, i + 50).join(","),
      })),
    );
  }
  return out;
}

export async function getTarget(id: string): Promise<RawTarget> {
  return chemblGet<RawTarget>(`target/${id.toUpperCase()}`); // 404 → "Not found in ChEMBL: target CHEMBL…"
}

/**
 * All activities with a pChEMBL value for the given parent molecules (and optionally one target).
 * Queries by parent ID so measurements recorded on salt forms (e.g. erlotinib HCl) are included.
 */
export async function getActivities(opts: { molecules: string[]; target?: string }): Promise<RawActivity[]> {
  const out: RawActivity[] = [];
  for (let i = 0; i < opts.molecules.length; i += 25) {
    out.push(
      ...(await chemblGetAll<RawActivity>("activity", "activities", {
        parent_molecule_chembl_id__in: opts.molecules.slice(i, i + 25).join(","),
        target_chembl_id: opts.target,
        pchembl_value__isnull: "false",
      })),
    );
  }
  return out;
}

async function getTargets(ids: string[]): Promise<RawTarget[]> {
  if (!ids.length) return [];
  return chemblGetAll<RawTarget>("target", "targets", { target_chembl_id__in: ids.join(",") });
}

const isHumanProtein = (t: RawTarget) => t.target_type === "SINGLE PROTEIN" && t.organism === "Homo sapiens";

export interface TargetCount {
  target: RawTarget;
  /** Candidate's IC50/Ki/Kd/EC50 rows with a pChEMBL value on this target */
  n: number;
}

export interface TargetSelection {
  target: RawTarget;
  how: "override" | "mechanism" | "mostMeasured";
  /** Top human single-protein targets by measurement count, plus the selected target */
  ranked: TargetCount[];
  /** All of the candidate's recorded mechanism targets (any type), for warnings */
  mechanismTargets: RawTarget[];
}

/**
 * Override if given; else the candidate's own mechanism target (human single protein, most
 * measured if several; mechanisms are queried by parent so salt-form records count); else the
 * most-measured human single-protein target. Counts use the first 2000 activity rows.
 */
export async function selectTarget(moleculeId: string, override?: string): Promise<TargetSelection> {
  const [acts, mechs] = await Promise.all([
    chemblGetAll<{ target_chembl_id: string }>(
      "activity",
      "activities",
      {
        parent_molecule_chembl_id: moleculeId,
        pchembl_value__isnull: "false",
        target_organism: "Homo sapiens",
        standard_type__in: "IC50,Ki,Kd,EC50",
        only: "target_chembl_id",
      },
      2000,
    ),
    override
      ? []
      : chemblGetAll<{ target_chembl_id: string | null }>("mechanism", "mechanisms", {
          parent_molecule_chembl_id: moleculeId,
        }),
  ]);
  const counts = new Map<string, number>();
  for (const a of acts) counts.set(a.target_chembl_id, (counts.get(a.target_chembl_id) ?? 0) + 1);
  const n = (t: RawTarget) => counts.get(t.target_chembl_id) ?? 0;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id]) => id);
  const mechIds = [...new Set(mechs.flatMap((m) => (m.target_chembl_id ? [m.target_chembl_id] : [])))];
  const byId = new Map((await getTargets([...new Set([...top, ...mechIds])])).map((t) => [t.target_chembl_id, t]));

  const ranked = top.flatMap((id) => {
    const t = byId.get(id);
    return t && isHumanProtein(t) ? [{ target: t, n: n(t) }] : [];
  }).slice(0, 5);
  const mechanismTargets = mechIds.flatMap((id) => byId.get(id) ?? []);
  const mechOk = mechanismTargets.filter(isHumanProtein).sort((a, b) => n(b) - n(a));

  let target: RawTarget;
  let how: TargetSelection["how"];
  if (override) [target, how] = [await getTarget(override), "override"];
  else if (mechOk.length) [target, how] = [mechOk[0], "mechanism"];
  else if (ranked.length) [target, how] = [ranked[0].target, "mostMeasured"];
  else throw new ChemblNotFound(`a human single-protein target with measurements for ${moleculeId}`);
  if (!ranked.some((r) => r.target.target_chembl_id === target.target_chembl_id)) ranked.unshift({ target, n: n(target) });
  return { target, how, ranked, mechanismTargets };
}

/** Parent IDs of small-molecule drugs with a known mechanism on this target, phase ≥ minPhase. */
export async function getMechanismDrugs(targetId: string, minPhase = 2): Promise<RawMolecule[]> {
  const mechs = await chemblGetAll<{ molecule_chembl_id: string }>("mechanism", "mechanisms", {
    target_chembl_id: targetId,
  });
  const listed = await getMolecules([...new Set(mechs.map((m) => m.molecule_chembl_id))]);
  const parentIds = new Set(
    listed
      .filter((m) => m.molecule_type === "Small molecule")
      .map((m) => m.molecule_hierarchy?.parent_chembl_id ?? m.molecule_chembl_id),
  );
  const parents = await getMolecules([...parentIds]);
  return parents.filter((m) => Number(m.max_phase ?? 0) >= minPhase);
}

/**
 * Which of these parent molecules have a ChEMBL drug-indication record matching the disease text
 * (word-level substring either way, "cancer" ≈ "carcinoma"). One or two calls.
 */
export async function getIndicatedFor(parentIds: string[], disease: string): Promise<Set<string>> {
  const norm = (s: string) =>
    ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\bcancer\b/g, "carcinoma").trim()} `;
  const d = norm(disease);
  if (!parentIds.length || !d.trim()) return new Set();
  const rows = await chemblGetAll<{ parent_molecule_chembl_id: string; efo_term: string | null; mesh_heading: string | null }>(
    "drug_indication",
    "drug_indications",
    { parent_molecule_chembl_id__in: parentIds.join(","), only: "parent_molecule_chembl_id,efo_term,mesh_heading" },
    2000,
  );
  const matches = (term: string | null) => {
    if (!term) return false;
    const t = norm(term);
    return t.includes(d) || (t.trim().includes(" ") && d.includes(t));
  };
  return new Set(rows.filter((r) => matches(r.efo_term) || matches(r.mesh_heading)).map((r) => r.parent_molecule_chembl_id));
}
