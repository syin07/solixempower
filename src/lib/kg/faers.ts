// FDA Adverse Event Reporting System (FAERS) via openFDA — safety signals for a drug. No key needed.
// These are spontaneous reports, not incidence: "drug ineffective" and "death" show up for most drugs,
// so the summary is a list of signals to check, never a rate. Cached 24 h under .cache/faers/.
import { cachedJson } from "@/lib/cache";

const BASE = "https://api.fda.gov/drug/event.json";
const SALT_SUFFIX = /(\s+(ANHYDROUS|HYDROCHLORIDE|MESYLATE|MALEATE|DIMALEATE|TOSYLATE|MONOHYDRATE|HYDRATE|SODIUM|CITRATE))+$/i;

export interface FaersReaction {
  term: string;
  count: number;
}

export interface FaersSummary {
  /** Name as searched (lowercase, salt words stripped) */
  name: string;
  /** Field the hits came from: generic_name (openFDA-normalised) or medicinalproduct (free text) */
  field: "generic_name" | "medicinalproduct" | null;
  total: number;
  serious: number;
  topReactions: FaersReaction[];
  /** Top reactions among serious reports only (absent when the extra call failed) */
  seriousTop?: FaersReaction[];
  /** The human-openable count query (top reactions) */
  query: string;
}

/** Name as openFDA expects it: preferred name without salt words, lower case. */
export const faersName = (prefName: string) => prefName.replace(SALT_SUFFIX, "").trim().toLowerCase();

async function countQuery(search: string, count: string, limit = 10): Promise<FaersReaction[] | null> {
  const url = `${BASE}?search=${encodeURIComponent(search)}&count=${count}&limit=${limit}`;
  return cachedJson<FaersReaction[] | null>("faers", url, async () => {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 404) return null; // openFDA: no matches
    if (!res.ok) throw new Error(`openFDA ${res.status} for ${url}`);
    const body = (await res.json()) as { results?: { term: string | number; count: number }[] };
    return (body.results ?? []).map((r) => ({ term: String(r.term), count: r.count }));
  });
}

export const faersQueryUrl = (search: string) =>
  `${BASE}?search=${encodeURIComponent(search)}&count=patient.reaction.reactionmeddrapt.exact&limit=10`;

/**
 * Report totals, serious split and top reactions for a drug. Tries the openFDA-normalised
 * generic_name first, then the free-text medicinalproduct field; both empty → total 0, field null.
 */
export async function getFaersSummary(prefName: string): Promise<FaersSummary> {
  const name = faersName(prefName);
  const fields = ["generic_name", "medicinalproduct"] as const;
  for (const field of fields) {
    const search = field === "generic_name" ? `patient.drug.openfda.generic_name:"${name}"` : `patient.drug.medicinalproduct:"${name}"`;
    const serious = await countQuery(search, "serious");
    if (!serious || !serious.length) continue;
    const seriousN = serious.find((r) => r.term === "1")?.count ?? 0;
    const total = serious.reduce((a, r) => a + r.count, 0);
    const top = (await countQuery(search, "patient.reaction.reactionmeddrapt.exact")) ?? [];
    let seriousTop: FaersReaction[] | undefined;
    try {
      seriousTop = (await countQuery(`${search}+AND+serious:1`, "patient.reaction.reactionmeddrapt.exact")) ?? undefined;
    } catch {
      seriousTop = undefined;
    }
    return { name, field, total, serious: seriousN, topReactions: top.map((r) => ({ ...r, term: titleCase(r.term) })), seriousTop: seriousTop?.map((r) => ({ ...r, term: titleCase(r.term) })), query: faersQueryUrl(search) };
  }
  return { name, field: null, total: 0, serious: 0, topReactions: [], query: faersQueryUrl(`patient.drug.openfda.generic_name:"${name}"`) };
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export const formatCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
