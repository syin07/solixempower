// Generic cached JSON fetch: in-memory map + on-disk files under .cache/<dir>/, keyed by a sha1 of the
// request key. Mirrors src/lib/chembl/client.ts (which stays as is) for the other data sources.
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const memory = new Map<string, unknown>();

export async function cachedJson<T>(
  cacheDir: string,
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 24 * 60 * 60 * 1000,
): Promise<T> {
  const memKey = `${cacheDir}:${key}`;
  if (memory.has(memKey)) return memory.get(memKey) as T;

  const dir = path.join(process.cwd(), ".cache", cacheDir);
  const file = path.join(dir, createHash("sha1").update(key).digest("hex") + ".json");
  try {
    const s = await stat(file);
    if (Date.now() - s.mtimeMs < ttlMs) {
      const hit = JSON.parse(await readFile(file, "utf8")) as T;
      memory.set(memKey, hit);
      return hit;
    }
  } catch {}

  const data = await fetcher();
  memory.set(memKey, data);
  mkdir(dir, { recursive: true })
    .then(() => writeFile(file, JSON.stringify(data)))
    .catch(() => {});
  return data;
}
