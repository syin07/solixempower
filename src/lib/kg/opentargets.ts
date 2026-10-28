// Open Targets Platform GraphQL client (no key). Gives target→disease associations with per-datatype
// sub-scores (docs/KG_PRD.md §8), UniProt→Ensembl mapping and disease-name resolution. Cached 24 h.
import { cachedJson } from "@/lib/cache";
import { normalizeEfo } from "./ids";

const ENDPOINT = "https://api.platform.opentargets.org/api/v4/graphql";

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = JSON.stringify({ query, variables });
  return cachedJson<T>("opentargets", key, async () => {
    let lastError: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        if (!res.ok) throw new Error(`Open Targets ${res.status}`);
        const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
        if (body.errors?.length) throw new Error(`Open Targets: ${body.errors.map((e) => e.message).join("; ")}`);
        if (!body.data) throw new Error("Open Targets: empty response");
        return body.data;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw lastError;
  });
}

/** UniProt accession → Ensembl gene id + symbol (e.g. P00533 → ENSG00000146648 EGFR). Missing ones are absent. */
export async function mapUniprotToEnsembl(accessions: string[]): Promise<Map<string, { ensemblId: string; symbol: string }>> {
  const out = new Map<string, { ensemblId: string; symbol: string }>();
  const terms = [...new Set(accessions.filter(Boolean))];
  if (!terms.length) return out;
  const data = await gql<{ mapIds: { mappings: { term: string; hits: { id: string; name: string; entity: string }[] }[] } }>(
    `query MapIds($terms: [String!]!) { mapIds(queryTerms: $terms, entityNames: ["target"]) { mappings { term hits { id name entity } } } }`,
    { terms },
  );
  for (const m of data.mapIds.mappings) {
    const hit = m.hits.find((h) => h.entity === "target" && h.id.startsWith("ENSG"));
    if (hit) out.set(m.term, { ensemblId: hit.id, symbol: hit.name });
  }
  return out;
}

export interface DiseaseAssociation {
  /** Normalized ontology id, e.g. "EFO_0000768" or "MONDO_0005233" */
  efoId: string;
  name: string;
  /** Open Targets overall association score (a harmonic sum — computed, never measured) */
  score: number;
  /** e.g. { genetic_association: 0.87, clinical: 0.97, literature: 0.04 } */
  datatypeScores: Record<string, number>;
  nAncestors: number;
  ancestors: string[];
  therapeuticAreas: string[];
}

export async function associatedDiseases(ensemblId: string, size = 25): Promise<{ symbol: string; rows: DiseaseAssociation[] }> {
  const data = await gql<{
    target: {
      approvedSymbol: string;
      associatedDiseases: {
        count: number;
        rows: {
          score: number;
          disease: { id: string; name: string; ancestors: string[]; therapeuticAreas: { name: string }[] };
          datatypeScores: { id: string; score: number }[];
        }[];
      };
    } | null;
  }>(
    `query Assoc($id: String!, $size: Int!) { target(ensemblId: $id) { approvedSymbol associatedDiseases(page: { index: 0, size: $size }) { count rows { score disease { id name ancestors therapeuticAreas { name } } datatypeScores { id score } } } } }`,
    { id: ensemblId, size },
  );
  if (!data.target) return { symbol: ensemblId, rows: [] };
  return {
    symbol: data.target.approvedSymbol,
    rows: data.target.associatedDiseases.rows.map((r) => ({
      efoId: normalizeEfo(r.disease.id),
      name: r.disease.name,
      score: r.score,
      datatypeScores: Object.fromEntries(r.datatypeScores.map((d) => [d.id, d.score])),
      nAncestors: r.disease.ancestors?.length ?? 0,
      ancestors: (r.disease.ancestors ?? []).map(normalizeEfo),
      therapeuticAreas: (r.disease.therapeuticAreas ?? []).map((a) => a.name),
    })),
  };
}

/** Free-text disease name → the top Open Targets disease hit, or null. */
export async function resolveDisease(name: string): Promise<{ id: string; name: string } | null> {
  const q = name.trim();
  if (!q) return null;
  const data = await gql<{ search: { hits: { id: string; name: string; entity: string; score: number }[] } }>(
    `query Resolve($q: String!) { search(queryString: $q, entityNames: ["disease"], page: { index: 0, size: 3 }) { hits { id name entity score } } }`,
    { q },
  );
  const hit = data.search.hits.find((h) => h.entity === "disease");
  return hit ? { id: normalizeEfo(hit.id), name: hit.name } : null;
}

/** Ancestor ids of a disease (normalized), [] if unknown. */
export async function diseaseAncestors(efoId: string): Promise<string[]> {
  try {
    const data = await gql<{ disease: { ancestors: string[] } | null }>(
      `query Anc($id: String!) { disease(efoId: $id) { ancestors } }`,
      { id: normalizeEfo(efoId) },
    );
    return (data.disease?.ancestors ?? []).map(normalizeEfo);
  } catch {
    return [];
  }
}

/**
 * Ancestor counts for several diseases in one call (`diseases(efoIds)`), used to spot generic terms added
 * via ChEMBL indications ("cancer" has 3 ancestors, "neoplasm" 2). Ids that Open Targets does not know
 * are absent from the map. MONDO ids are valid efoIds.
 */
export async function diseaseAncestorCounts(efoIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(efoIds.map(normalizeEfo).filter(Boolean))];
  if (!ids.length) return out;
  try {
    const data = await gql<{ diseases: { id: string; ancestors: string[] | null }[] }>(
      `query AncCounts($ids: [String!]!) { diseases(efoIds: $ids) { id ancestors } }`,
      { ids },
    );
    for (const d of data.diseases ?? []) out.set(normalizeEfo(d.id), d.ancestors?.length ?? 0);
  } catch (e) {
    console.warn("[kg/opentargets] ancestor counts unavailable:", e instanceof Error ? e.message : e);
  }
  return out;
}

export interface DiseaseFilterOptions {
  /** The query disease id and its ancestors: never a repurposing candidate */
  excludeIds?: Iterable<string>;
  minScore?: number;
  /** Below this many ancestors a term is too generic ("cancer" has 3, "neoplasm" 2) */
  minAncestors?: number;
  keep?: number;
}

/**
 * PRD §5 filters: overall score ≥ 0.4; at least one non-literature datatype (genetic, somatic or
 * animal ≥ 0.3, or clinical ≥ 0.5); ≥ 5 ancestors; not the query disease or one of its ancestors;
 * keep at most 8 per target. Literature-only associations never become hypotheses.
 */
export function filterDiseaseRows(rows: DiseaseAssociation[], opts: DiseaseFilterOptions = {}): DiseaseAssociation[] {
  const { minScore = 0.4, minAncestors = 5, keep = 8 } = opts;
  const exclude = new Set([...(opts.excludeIds ?? [])].map(normalizeEfo));
  const hasEvidence = (d: Record<string, number>) =>
    (d.genetic_association ?? 0) >= 0.3 || (d.somatic_mutation ?? 0) >= 0.3 || (d.animal_model ?? 0) >= 0.3 || (d.clinical ?? 0) >= 0.5;
  return rows
    .filter((r) => r.score >= minScore && hasEvidence(r.datatypeScores) && r.nAncestors >= minAncestors && !exclude.has(r.efoId))
    .slice(0, keep);
}

export interface TargetAssociation {
  ensemblId: string;
  symbol: string;
  name: string;
  /** Canonical (Swiss-Prot) UniProt accession, used to find the ChEMBL target; null if none */
  uniprot: string | null;
  score: number;
  datatypeScores: Record<string, number>;
}

/** Disease → targets (Open Targets), top `size` by overall association score. Used by expand-on-click. */
export async function associatedTargets(efoId: string, size = 8): Promise<TargetAssociation[]> {
  const data = await gql<{
    disease: {
      associatedTargets: {
        rows: {
          score: number;
          target: { id: string; approvedSymbol: string; approvedName: string; proteinIds: { id: string; source: string }[] };
          datatypeScores: { id: string; score: number }[];
        }[];
      };
    } | null;
  }>(
    `query AssocTargets($id: String!, $size: Int!) { disease(efoId: $id) { associatedTargets(page: { index: 0, size: $size }) { rows { score target { id approvedSymbol approvedName proteinIds { id source } } datatypeScores { id score } } } } }`,
    { id: normalizeEfo(efoId), size },
  );
  return (data.disease?.associatedTargets.rows ?? []).map((r) => ({
    ensemblId: r.target.id,
    symbol: r.target.approvedSymbol,
    name: r.target.approvedName,
    uniprot: r.target.proteinIds?.find((p) => p.source === "uniprot_swissprot")?.id ?? null,
    score: r.score,
    datatypeScores: Object.fromEntries(r.datatypeScores.map((d) => [d.id, d.score])),
  }));
}

/**
 * Direct target → disease pair lookup (any score, no filter): the association rows of `ensemblId` for
 * exactly these disease ids. Used for the "is there an opening for this drug in this disease?" card.
 */
export async function pairAssociations(ensemblId: string, efoIds: string[]): Promise<{ symbol: string; rows: DiseaseAssociation[] }> {
  const ids = [...new Set(efoIds.map(normalizeEfo))];
  if (!ids.length) return { symbol: "", rows: [] };
  const data = await gql<{
    target: {
      approvedSymbol: string;
      associatedDiseases: {
        rows: {
          score: number;
          disease: { id: string; name: string; ancestors: string[]; therapeuticAreas: { name: string }[] };
          datatypeScores: { id: string; score: number }[];
        }[];
      };
    } | null;
  }>(
    `query Pair($id: String!, $bs: [String!]!, $size: Int!) { target(ensemblId: $id) { approvedSymbol associatedDiseases(Bs: $bs, page: { index: 0, size: $size }) { rows { score disease { id name ancestors therapeuticAreas { name } } datatypeScores { id score } } } } }`,
    { id: ensemblId, bs: ids, size: ids.length },
  );
  return {
    symbol: data.target?.approvedSymbol ?? "",
    rows: (data.target?.associatedDiseases.rows ?? []).map((r) => ({
      efoId: normalizeEfo(r.disease.id),
      name: r.disease.name,
      score: r.score,
      datatypeScores: Object.fromEntries(r.datatypeScores.map((d) => [d.id, d.score])),
      nAncestors: r.disease.ancestors?.length ?? 0,
      ancestors: r.disease.ancestors ?? [],
      therapeuticAreas: (r.disease.therapeuticAreas ?? []).map((t) => t.name),
    })),
  };
}

/** Disease → its top targets with Swiss-Prot accessions (same shape as associatedTargets, larger page). */
export const diseaseTargets = (efoId: string, size = 25): Promise<TargetAssociation[]> => associatedTargets(efoId, size);
