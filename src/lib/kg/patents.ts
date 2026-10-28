// IP status for a drug ("can you own it if the hypothesis works?"): FDA Orange Book listed patents,
// generics and exclusivity for approved drugs; for anything else, the count of PubChem patent
// documents that mention the compound. Honest scope: the Orange Book lists only what sponsors filed
// with the FDA; freedom-to-operate needs a real search.
import { cachedJson } from "@/lib/cache";
import { lookupIngredient, type IngredientLookup } from "./orangebook";

export interface IpStatus {
  source: "orange_book" | "pubchem" | "none";
  summary: string;
  /** null when unknown (not an approved product) */
  genericAvailable: boolean | null;
  unexpiredPatents: number;
  latestExpiry?: string;
  /** Every unexpired listed patent carries a use code (method-of-use), none claims the substance */
  useCodeOnly: boolean;
  /** Unexpired patents that claim the drug substance (composition) */
  substancePatents: number;
  firstApproval?: string;
  ndaCount: number;
  andaCount: number;
  exclusivityUntil?: string;
  pubchemCid?: number;
  pubchemPatentCount?: number;
  /** Up to 6 unexpired listed patents, soonest expiry first */
  patents: { patentNo: string; expires: string; useCode?: string; substance: boolean; product: boolean }[];
  url: string;
  /** Orange Book ingredient strings or the PubChem name that was matched */
  matched: string[];
}

const OB_SEARCH_URL = "https://www.accessdata.fda.gov/scripts/cder/ob/search_product.cfm";
const PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const today = () => new Date().toISOString().slice(0, 10);
const year = (iso?: string) => (iso && /^\d{4}/.test(iso) ? iso.slice(0, 4) : undefined);

async function pubchemJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) throw new NotInPubChem();
  if (!res.ok) throw new Error(`PubChem ${res.status} for ${url}`);
  return (await res.json()) as T;
}
class NotInPubChem extends Error {}

/** PubChem patent cross-references for a compound name: CID plus the number of patent ids. */
export async function pubchemPatentCount(name: string): Promise<{ cid: number; count: number } | null> {
  return cachedJson("pubchem", `patents:${name.toLowerCase()}`, async () => {
    try {
      const cids = await pubchemJson<{ IdentifierList?: { CID?: number[] } }>(`${PUBCHEM}/compound/name/${encodeURIComponent(name)}/cids/JSON`);
      const cid = cids.IdentifierList?.CID?.[0];
      if (!cid) return null;
      const x = await pubchemJson<{ InformationList?: { Information?: { PatentID?: string[] }[] } }>(`${PUBCHEM}/compound/cid/${cid}/xrefs/PatentID/JSON`);
      return { cid, count: x.InformationList?.Information?.[0]?.PatentID?.length ?? 0 };
    } catch (e) {
      if (e instanceof NotInPubChem) return null;
      throw e;
    }
  });
}

function fromOrangeBook(ob: IngredientLookup): IpStatus {
  const t = today();
  const unexpired = ob.patents.filter((p) => p.expires >= t);
  const substance = unexpired.filter((p) => p.substance);
  const useOnly = unexpired.length > 0 && unexpired.every((p) => Boolean(p.useCode) && !p.substance);
  const formulationOnly = unexpired.length > 0 && !useOnly && substance.length === 0;
  const latest = unexpired.length ? unexpired[unexpired.length - 1].expires : undefined;
  const excl = ob.exclusivities.filter((e) => e.expires >= t).map((e) => e.expires).sort();
  const exclusivityUntil = excl.length ? excl[excl.length - 1] : undefined;
  const generics = ob.andaCount > 0;

  const parts: string[] = [];
  parts.push(generics ? `Generics approved (${ob.andaCount} ANDA${ob.andaCount === 1 ? "" : "s"})` : `No generics approved (${ob.ndas.length} NDA${ob.ndas.length === 1 ? "" : "s"})`);
  if (!unexpired.length) parts.push("no unexpired listed patents");
  else {
    const kind = substance.length
      ? `${substance.length} claim${substance.length === 1 ? "s" : ""} the substance`
      : useOnly
        ? "all method-of-use"
        : "product/formulation or use claims only";
    parts.push(`${unexpired.length} listed patent${unexpired.length === 1 ? "" : "s"} unexpired, latest ${year(latest)}, ${kind}`);
  }
  if (exclusivityUntil) parts.push(`regulatory exclusivity to ${year(exclusivityUntil)}`);
  let verdict: string;
  if (substance.length) verdict = "the substance is still claimed, so a new use needs the patent holder or a licence";
  else if (!unexpired.length) verdict = "the molecule is free to use; a new indication is protectable only by a method-of-use patent";
  else if (useOnly) verdict = "the molecule itself is not claimed; a new indication is protectable only by a method-of-use patent";
  else verdict = formulationOnly ? "the molecule itself is not claimed (only specific products); a new indication is protectable only by a method-of-use patent" : "a new indication is protectable only by a method-of-use patent";

  return {
    source: "orange_book",
    summary: `${parts.join("; ")} — ${verdict}.`,
    genericAvailable: generics,
    unexpiredPatents: unexpired.length,
    latestExpiry: latest,
    useCodeOnly: useOnly,
    substancePatents: substance.length,
    firstApproval: ob.firstApproval,
    ndaCount: ob.ndas.length,
    andaCount: ob.andaCount,
    exclusivityUntil,
    patents: unexpired.slice(0, 6).map(({ patentNo, expires, useCode, substance: s, product }) => ({ patentNo, expires, useCode, substance: s, product })),
    url: OB_SEARCH_URL,
    matched: ob.ingredients,
  };
}

/** IP status for a preferred name: Orange Book when approved, otherwise PubChem patent count. */
export async function getIpStatus(prefName: string): Promise<IpStatus> {
  let ob: IngredientLookup | null = null;
  try {
    ob = await lookupIngredient(prefName);
  } catch (e) {
    console.warn("[kg/patents] Orange Book unavailable:", e instanceof Error ? e.message : e);
  }
  if (ob) return fromOrangeBook(ob);

  const pc = await pubchemPatentCount(prefName).catch((e) => {
    console.warn("[kg/patents] PubChem unavailable:", e instanceof Error ? e.message : e);
    return null;
  });
  if (pc) {
    return {
      source: "pubchem",
      summary: `Not in the FDA Orange Book (no approved US product); PubChem lists ${pc.count.toLocaleString("en-US")} patent document${pc.count === 1 ? "" : "s"} mentioning the compound — ownership depends on the originator's composition-of-matter patents.`,
      genericAvailable: null,
      unexpiredPatents: 0,
      useCodeOnly: false,
      substancePatents: 0,
      ndaCount: 0,
      andaCount: 0,
      pubchemCid: pc.cid,
      pubchemPatentCount: pc.count,
      patents: [],
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${pc.cid}#section=Patents`,
      matched: [prefName],
    };
  }
  return {
    source: "none",
    summary: "Not in the FDA Orange Book and not found in PubChem — IP status could not be checked.",
    genericAvailable: null,
    unexpiredPatents: 0,
    useCodeOnly: false,
    substancePatents: 0,
    ndaCount: 0,
    andaCount: 0,
    patents: [],
    url: OB_SEARCH_URL,
    matched: [],
  };
}
