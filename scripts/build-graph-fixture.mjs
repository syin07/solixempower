#!/usr/bin/env node
// Builds src/fixtures/graph.json from the recorded poziotinib benchmark + live trials, so the graph UI
// and hypothesis code can be developed against real shapes without the pipeline.
//   node --import ./scripts/ts-loader.mjs scripts/build-graph-fixture.mjs [--base http://localhost:3000]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { buildGraph } from "../src/lib/kg/build.ts";

const { values: args } = parseArgs({ options: { base: { type: "string", default: "http://localhost:3000" } } });
const ROOT = process.cwd();
const benchmarkFile = path.join(ROOT, "src/fixtures/demo/benchmark--poziotinib--non-small-cell-lung-cancer--auto.json");
const out = path.join(ROOT, "src/fixtures/graph.json");

const benchmark = JSON.parse(await readFile(benchmarkFile, "utf8"));

async function fetchTrials(base) {
  const drugs = [benchmark.candidate, ...benchmark.comparators].map((c) => c.compound.name).join(",");
  const url = `${base}/api/trials?${new URLSearchParams({ disease: benchmark.query.disease, drugs })}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  if (data.isMock) throw new Error("trials route returned isMock");
  return data;
}

async function serverUp(base) {
  try {
    const res = await fetch(`${base}/api/benchmark?mock=1`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

let dev = null;
let trials;
let trialsSource = "live /api/trials";
try {
  if (!(await serverUp(args.base))) {
    console.log("starting dev server…");
    dev = spawn("npm", ["run", "dev"], { cwd: ROOT, stdio: "ignore", detached: true });
    for (let i = 0; i < 60 && !(await serverUp(args.base)); i++) await new Promise((r) => setTimeout(r, 1000));
  }
  trials = await fetchTrials(args.base);
} catch (e) {
  console.warn(`WARNING: live trials unavailable (${e.message}); using the MOCK src/fixtures/trials.json`);
  trials = JSON.parse(await readFile(path.join(ROOT, "src/fixtures/trials.json"), "utf8"));
  trialsSource = "mock src/fixtures/trials.json";
} finally {
  if (dev) {
    try {
      process.kill(-dev.pid, "SIGTERM");
    } catch {}
  }
}

const graph = buildGraph(benchmark, trials);
await writeFile(out, JSON.stringify(graph, null, 2) + "\n");

const count = (items, key) => items.reduce((m, x) => ((m[x[key]] = (m[x[key]] ?? 0) + 1), m), {});
console.log(`trials: ${trialsSource} (${trials.trials.length} trials)`);
console.log("nodes by type:", count(graph.nodes, "type"));
console.log("edges by type:", count(graph.edges, "type"));
const noUrl = graph.edges.filter((e) => !e.source?.url);
console.log(`edges without source.url: ${noUrl.length}; sources: ${graph.sources.length}`);
console.log(`wrote ${path.relative(ROOT, out)}`);
