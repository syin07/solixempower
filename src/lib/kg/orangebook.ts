// FDA Orange Book data files (products, patents, exclusivity): one ~1 MB zip, downloaded to
// .cache/orangebook/ at most once a week, unzipped with the system `unzip`, parsed lazily into memory.
// Used to answer "can this drug still be owned?": approved products, generics (ANDAs), listed patents.
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const ZIP_URL = "https://www.fda.gov/media/76860/download";
const CACHE_DIR = path.join(process.cwd(), ".cache", "orangebook");
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const run = promisify(execFile);

export interface ObProduct {
  ingredient: string;
  tradeName: string;
  applicant: string;
  applType: "N" | "A";
  applNo: string;
  productNo: string;
  approvalDate: string;
  dosageFormRoute: string;
}

export interface ObPatent {
  patentNo: string;
  /** ISO date (YYYY-MM-DD) or the raw text when unparseable */
  expires: string;
  useCode?: string;
  substance: boolean;
  product: boolean;
  applNo: string;
}

export interface ObExclusivity {
  applNo: string;
  code: string;
  expires: string;
}

export interface IngredientLookup {
  /** Orange Book ingredient strings matched, e.g. ["SILDENAFIL CITRATE"] */
  ingredients: string[];
  ndas: string[];
  andaCount: number;
  firstApproval?: string;
  products: { tradeName: string; applicant: string; approvalDate: string; applType: "N" | "A"; applNo: string }[];
  patents: ObPatent[];
  exclusivities: ObExclusivity[];
}

interface Tables {
  products: ObProduct[];
  patentsByAppl: Map<string, ObPatent[]>;
  exclusivityByAppl: Map<string, ObExclusivity[]>;
  fetchedAt: string;
}

let tables: Promise<Tables> | null = null;

/** Salt / hydrate words stripped from a preferred name before matching the Ingredient column. */
const SALT_WORDS =
  /\b(ANHYDROUS|HYDROCHLORIDE|DIHYDROCHLORIDE|MESYLATE|MALEATE|DIMALEATE|TOSYLATE|MONOHYDRATE|HYDRATE|SODIUM|POTASSIUM|CALCIUM|CITRATE|SULFATE|SULPHATE|PHOSPHATE|ACETATE|TARTRATE|BITARTRATE|SUCCINATE|FUMARATE|BESYLATE|BROMIDE|HYDROBROMIDE|LACTATE|MALATE|NITRATE|OXALATE|PAMOATE|DISODIUM|MAGNESIUM|TROMETHAMINE|HEMIHYDRATE|TRIHYDRATE)\b/g;

export const baseName = (name: string) =>
  name.toUpperCase().replace(SALT_WORDS, " ").replace(/\s+/g, " ").trim();

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
/** "Dec 24, 2038" → "2038-12-24"; anything else is returned as is. */
export function toIsoDate(text: string): string {
  const m = text.trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!m || !MONTHS[m[1]]) return text.trim();
  return `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, "0")}`;
}

async function fresh(file: string): Promise<boolean> {
  try {
    const s = await stat(file);
    return Date.now() - s.mtimeMs < TTL_MS && s.size > 0;
  } catch {
    return false;
  }
}

/** Written after a successful download (unzip keeps the archive's own mtimes, so they can't be used). */
const STAMP = path.join(CACHE_DIR, "fetched.json");

async function ensureFiles(): Promise<string> {
  const zip = path.join(CACHE_DIR, "eobzip.zip");
  try {
    if (await fresh(STAMP)) {
      const stamp = JSON.parse(await readFile(STAMP, "utf8")) as { fetchedAt: string };
      await stat(path.join(CACHE_DIR, "products.txt"));
      await stat(path.join(CACHE_DIR, "patent.txt"));
      return stamp.fetchedAt;
    }
  } catch {}
  await mkdir(CACHE_DIR, { recursive: true });
  const res = await fetch(ZIP_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`Orange Book download failed: HTTP ${res.status}`);
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  await run("unzip", ["-o", "-q", zip, "-d", CACHE_DIR]);
  const fetchedAt = new Date().toISOString();
  await writeFile(STAMP, JSON.stringify({ fetchedAt }));
  return fetchedAt;
}

/** Parses a `~`-delimited file with a header row into records keyed by header name. */
function parseTable(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const header = lines[0].split("~");
  return lines.slice(1).map((l) => {
    const cells = l.split("~");
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = (cells[i] ?? "").trim()));
    return rec;
  });
}

async function load(): Promise<Tables> {
  const fetchedAt = await ensureFiles();
  const read = (f: string) => readFile(path.join(CACHE_DIR, f), "latin1");
  const [productsText, patentText, exclText] = await Promise.all([read("products.txt"), read("patent.txt"), read("exclusivity.txt").catch(() => "")]);
  const products: ObProduct[] = parseTable(productsText).map((r) => ({
    ingredient: r.Ingredient,
    tradeName: r.Trade_Name,
    applicant: r.Applicant,
    applType: r.Appl_Type === "A" ? "A" : "N",
    applNo: r.Appl_No,
    productNo: r.Product_No,
    approvalDate: r.Approval_Date,
    dosageFormRoute: r["DF;Route"],
  }));
  const patentsByAppl = new Map<string, ObPatent[]>();
  for (const r of parseTable(patentText)) {
    const p: ObPatent = {
      patentNo: r.Patent_No,
      expires: toIsoDate(r.Patent_Expire_Date_Text),
      useCode: r.Patent_Use_Code || undefined,
      substance: r.Drug_Substance_Flag === "Y",
      product: r.Drug_Product_Flag === "Y",
      applNo: r.Appl_No,
    };
    const list = patentsByAppl.get(r.Appl_No) ?? [];
    list.push(p);
    patentsByAppl.set(r.Appl_No, list);
  }
  const exclusivityByAppl = new Map<string, ObExclusivity[]>();
  for (const r of parseTable(exclText)) {
    const list = exclusivityByAppl.get(r.Appl_No) ?? [];
    list.push({ applNo: r.Appl_No, code: r.Exclusivity_Code, expires: toIsoDate(r.Exclusivity_Date) });
    exclusivityByAppl.set(r.Appl_No, list);
  }
  return { products, patentsByAppl, exclusivityByAppl, fetchedAt };
}

export function orangeBookTables(): Promise<Tables> {
  if (!tables) tables = load().catch((e) => {
    tables = null;
    throw e;
  });
  return tables;
}

/** Date the cached data files were downloaded (for provenance), or null before the first load. */
export async function orangeBookFetchedAt(): Promise<string | null> {
  try {
    return (await orangeBookTables()).fetchedAt;
  } catch {
    return null;
  }
}

const parseApproval = (text: string): string => (text === "Approved Prior to Jan 1, 1982" ? "1981-12-31" : toIsoDate(text));

/**
 * Single-ingredient products whose Ingredient is the name itself or the name plus salt words
 * ("SILDENAFIL", "SILDENAFIL CITRATE"); combinations ("ACETAMINOPHEN; CODEINE PHOSPHATE") are excluded.
 */
export async function lookupIngredient(prefName: string): Promise<IngredientLookup | null> {
  const base = baseName(prefName);
  if (!base) return null;
  const t = await orangeBookTables();
  const matches = t.products.filter((p) => !p.ingredient.includes(";") && baseName(p.ingredient) === base);
  if (!matches.length) return null;
  const ndas = [...new Set(matches.filter((p) => p.applType === "N").map((p) => p.applNo))];
  const andas = new Set(matches.filter((p) => p.applType === "A").map((p) => p.applNo));
  const seenPat = new Set<string>();
  const patents: ObPatent[] = [];
  const exclusivities: ObExclusivity[] = [];
  for (const appl of ndas) {
    for (const p of t.patentsByAppl.get(appl) ?? []) {
      const key = `${p.patentNo}:${p.expires}:${p.useCode ?? ""}`;
      if (seenPat.has(key)) continue;
      seenPat.add(key);
      patents.push(p);
    }
    exclusivities.push(...(t.exclusivityByAppl.get(appl) ?? []));
  }
  patents.sort((a, b) => a.expires.localeCompare(b.expires));
  const approvals = matches.map((p) => parseApproval(p.approvalDate)).filter((d) => /^\d{4}-/.test(d)).sort();
  const seenProd = new Set<string>();
  const products = matches
    .filter((p) => {
      const k = `${p.applNo}:${p.tradeName}`;
      if (seenProd.has(k)) return false;
      seenProd.add(k);
      return true;
    })
    .map((p) => ({ tradeName: p.tradeName, applicant: p.applicant, approvalDate: parseApproval(p.approvalDate), applType: p.applType, applNo: p.applNo }));
  return {
    ingredients: [...new Set(matches.map((p) => p.ingredient))],
    ndas,
    andaCount: andas.size,
    firstApproval: approvals[0],
    products,
    patents,
    exclusivities,
  };
}
