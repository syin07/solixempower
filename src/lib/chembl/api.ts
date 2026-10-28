// Typed ChEMBL lookups used by the benchmark engine. Raw shapes cover only the fields we use.
import { chemblGet, chemblGetAll, ChemblNotFound } from "./client";

export interface RawMolecule {
  molecule_chembl_id: string;
  pref_name: string | null;
  max_phase: string | null;
  molecule_type: string | null;
  molecule_hierarchy: { parent_chembl_id: string } | null;
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

/** Name or ChEMBL ID → the parent molecule (salt forms map to the parent). */
export async function resolveMolecule(query: string): Promise<RawMolecule> {
  let mol: RawMolecule | undefined;
  if (isChemblId(query)) {
    mol = await getMolecule(query);
  } else {
    const { molecules } = await chemblGet<{ molecules: RawMolecule[] }>("molecule/search", {
      q: query.trim(),
      limit: 10,
    });
    const exact = molecules.find((m) => m.pref_name?.toLowerCase() === query.trim().toLowerCase());
    mol = exact ?? molecules[0];
  }
  if (!mol) throw new ChemblNotFound(query);
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
  return chemblGet<RawTarget>(`target/${id.toUpperCase()}`);
}

/** All activities with a pChEMBL value for the given molecules (and optionally one target). */
export async function getActivities(opts: { molecules: string[]; target?: string }): Promise<RawActivity[]> {
  const out: RawActivity[] = [];
  for (let i = 0; i < opts.molecules.length; i += 25) {
    out.push(
      ...(await chemblGetAll<RawActivity>("activity", "activities", {
        molecule_chembl_id__in: opts.molecules.slice(i, i + 25).join(","),
        target_chembl_id: opts.target,
        pchembl_value__isnull: "false",
      })),
    );
  }
  return out;
}

/** The candidate's most-measured human single-protein target. */
export async function pickTarget(moleculeId: string): Promise<RawTarget> {
  const acts = await chemblGetAll<RawActivity>(
    "activity",
    "activities",
    { molecule_chembl_id: moleculeId, pchembl_value__isnull: "false", target_organism: "Homo sapiens" },
    2000,
  );
  const counts = new Map<string, number>();
  for (const a of acts) counts.set(a.target_chembl_id, (counts.get(a.target_chembl_id) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [id] of ranked) {
    const t = await getTarget(id);
    if (t.target_type === "SINGLE PROTEIN") return t;
  }
  throw new ChemblNotFound(`a human single-protein target with measurements for ${moleculeId}`);
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
