// Thin ChEMBL REST client with an in-memory + on-disk cache. ChEMBL is slow (1–5 s per call),
// and the disk cache in .cache/chembl doubles as an offline fallback for the demo.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://www.ebi.ac.uk/chembl/api/data";
const CACHE_DIR = path.join(process.cwd(), ".cache", "chembl");
const memory = new Map<string, unknown>();

type Params = Record<string, string | number | undefined>;

export async function chemblGet<T>(resource: string, params: Params = {}): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
  const url = `${BASE}/${resource}.json?${qs}`;
  if (memory.has(url)) return memory.get(url) as T;

  const file = path.join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".json");
  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as T;
    memory.set(url, hit);
    return hit;
  } catch {}

  const data = await fetchWithRetry<T>(url);
  memory.set(url, data);
  mkdir(CACHE_DIR, { recursive: true })
    .then(() => writeFile(file, JSON.stringify(data)))
    .catch(() => {});
  return data;
}

async function fetchWithRetry<T>(url: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status === 404) throw new ChemblNotFound(url);
      if (!res.ok) throw new Error(`ChEMBL ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof ChemblNotFound) throw e;
      lastError = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastError;
}

/** Fetches every page of a list resource (ChEMBL caps `limit` at 1000). */
export async function chemblGetAll<T>(
  resource: string,
  key: string,
  params: Params = {},
  max = 5000,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const page = await chemblGet<Record<string, unknown>>(resource, { ...params, limit: 1000, offset });
    const rows = (page[key] as T[]) ?? [];
    out.push(...rows);
    const meta = page.page_meta as { next: string | null } | undefined;
    if (!meta?.next) break;
  }
  return out;
}

export class ChemblNotFound extends Error {
  constructor(what: string) {
    super(`Not found in ChEMBL: ${what}`);
  }
}

export const chemblUrl = {
  compound: (id: string) => `https://www.ebi.ac.uk/chembl/explore/compound/${id}`,
  target: (id: string) => `https://www.ebi.ac.uk/chembl/explore/target/${id}`,
  assay: (id: string) => `https://www.ebi.ac.uk/chembl/explore/assay/${id}`,
};
