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
  /** Approved routes of administration (regulatory flags); present on molecule lookups */
  oral?: boolean;
  parenteral?: boolean;
  topical?: boolean;
  first_approval?: number | null;
}

export interface RawTarget {
  target_chembl_id: string;
  pref_name: string;
  organism: string;
  target_type: string;
  /** UniProt components; a PROTEIN FAMILY / complex lists each member protein */
  target_components?: { accession: string | null }[];
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
  /** mechanismFamily: the mechanism is recorded on a protein family/complex that contains this target */
  how: "override" | "mechanism" | "mechanismFamily" | "mostMeasured";
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
  // Mechanism on a family/complex (e.g. poziotinib → "EGFR erbB family"): its most-measured member protein
  const familyAccessions = new Set(
    mechanismTargets
      .filter((t) => !isHumanProtein(t))
      .flatMap((t) => (t.target_components ?? []).flatMap((c) => (c.accession ? [c.accession] : []))),
  );
  const familyMembers = top.flatMap((id) => {
    const t = byId.get(id);
    return t && isHumanProtein(t) && t.target_components?.some((c) => c.accession && familyAccessions.has(c.accession)) ? [t] : [];
  });

  let target: RawTarget;
  let how: TargetSelection["how"];
  if (override) [target, how] = [await getTarget(override), "override"];
  else if (mechOk.length) [target, how] = [mechOk[0], "mechanism"];
  else if (familyMembers.length) [target, how] = [familyMembers[0], "mechanismFamily"];
  else if (ranked.length) [target, how] = [ranked[0].target, "mostMeasured"];
  else throw new ChemblNotFound(`a human single-protein target with measurements for ${moleculeId}`);
  // A mechanism target with no measurements anchors nothing (acetaminophen → FAAH, n=0): prefer the
  // most-measured target when one has data. An explicit override is never replaced.
  if (how !== "override" && n(target) === 0 && ranked.length && ranked[0].n > 0) [target, how] = [ranked[0].target, "mostMeasured"];
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

export interface RawDrugWarning {
  warning_id: number;
  molecule_chembl_id: string;
  parent_molecule_chembl_id: string;
  warning_type: string | null;
  warning_class: string | null;
  warning_description: string | null;
  warning_country: string | null;
  warning_year: number | null;
  warning_refs: { ref_type: string | null; ref_url: string | null }[] | null;
}

/** ChEMBL regulatory drug warnings (black box, withdrawn) recorded for these parent molecules. */
export async function getDrugWarnings(parentIds: string[]): Promise<RawDrugWarning[]> {
  if (!parentIds.length) return [];
  return chemblGetAll<RawDrugWarning>(
    "drug_warning",
    "drug_warnings",
    { parent_molecule_chembl_id__in: parentIds.join(","), order_by: "warning_id" },
    2000,
  );
}

export type RawAssayActivity = Pick<
  RawActivity,
  | "activity_id"
  | "assay_chembl_id"
  | "assay_description"
  | "assay_type"
  | "bao_label"
  | "data_validity_comment"
  | "parent_molecule_chembl_id"
  | "pchembl_value"
  | "standard_relation"
  | "standard_type"
  | "standard_units"
  | "standard_value"
  | "target_organism"
> & { target_pref_name: string | null; document_year: number | null };

/**
 * The molecule's functional and binding activities on any target (incl. cell lines and non-protein
 * targets), newest first, capped at 2000 rows. Used for the preclinical (functional / cell-based) list.
 */
export async function getAssayActivities(parentId: string): Promise<RawAssayActivity[]> {
  return chemblGetAll<RawAssayActivity>(
    "activity",
    "activities",
    {
      parent_molecule_chembl_id: parentId,
      assay_type__in: "F,B",
      order_by: "-document_year",
      only:
        "activity_id,assay_chembl_id,assay_description,assay_type,bao_label,data_validity_comment," +
        "parent_molecule_chembl_id,pchembl_value,standard_relation,standard_type,standard_units,standard_value," +
        "target_organism,target_pref_name,document_year",
    },
    2000,
  );
}

export interface RawIndication {
  drugind_id: number;
  molecule_chembl_id: string;
  parent_molecule_chembl_id: string;
  /** "EFO:0000768" / "MONDO:0005233" — normalize with normalizeEfo() before use as a node id */
  efo_id: string | null;
  efo_term: string | null;
  mesh_heading: string | null;
  max_phase_for_ind: string | null;
}

/** Every ChEMBL drug-indication row for these parent molecules (all diseases, all phases). */
export async function getIndications(parentIds: string[]): Promise<RawIndication[]> {
  const out: RawIndication[] = [];
  for (let i = 0; i < parentIds.length; i += 25) {
    out.push(
      ...(await chemblGetAll<RawIndication>(
        "drug_indication",
        "drug_indications",
        {
          parent_molecule_chembl_id__in: parentIds.slice(i, i + 25).join(","),
          only: "drugind_id,molecule_chembl_id,parent_molecule_chembl_id,efo_id,efo_term,mesh_heading,max_phase_for_ind",
        },
        3000,
      )),
    );
  }
  return out;
}

export interface RawMechanism {
  mec_id: number;
  molecule_chembl_id: string;
  parent_molecule_chembl_id: string | null;
  action_type: string | null;
  direct_interaction: number | null;
  mechanism_of_action: string | null;
  max_phase: number | null;
  target_chembl_id: string | null;
}

/** Curated mechanism-of-action rows for drugs acting on this target. */
export async function getMechanisms(targetId: string): Promise<RawMechanism[]> {
  return chemblGetAll<RawMechanism>("mechanism", "mechanisms", { target_chembl_id: targetId }, 2000);
}

/** The human single-protein ChEMBL target for a UniProt accession, or null. One cached call. */
export async function getTargetByAccession(accession: string): Promise<RawTarget | null> {
  const page = await chemblGet<{ targets: RawTarget[] }>("target", {
    target_components__accession: accession,
    target_type: "SINGLE PROTEIN",
    organism: "Homo sapiens",
    limit: 5,
  });
  return page.targets?.[0] ?? null;
}

/** ChEMBL drug-indication rows for one disease (EFO colon form, e.g. "EFO:0000768"), phase ≥ minPhase. */
export async function getIndicationsForDisease(efoColonId: string, minPhase = 2, max = 200): Promise<RawIndication[]> {
  return chemblGetAll<RawIndication>(
    "drug_indication",
    "drug_indications",
    {
      efo_id: efoColonId,
      max_phase_for_ind__gte: minPhase,
      only: "drugind_id,molecule_chembl_id,parent_molecule_chembl_id,efo_id,efo_term,mesh_heading,max_phase_for_ind",
    },
    max,
  );
}
