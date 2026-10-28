// Live check for R1 (server): node --import ./scripts/ts-loader.mjs scripts/check-expand.mjs
// Builds + enriches the poziotinib graph, expands its EGFR target and the NSCLC disease, and checks the deltas.
import { readFile } from "node:fs/promises";
import { buildGraph } from "../src/lib/kg/build.ts";
import { enrichGraph } from "../src/lib/kg/enrich.ts";
import { expandNode } from "../src/lib/kg/expand.ts";
import { mergeDelta } from "../src/lib/kg/merge.ts";

const benchmark = JSON.parse(await readFile("src/fixtures/demo/benchmark--poziotinib--non-small-cell-lung-cancer--auto.json", "utf8"));
const count = (xs) => Object.fromEntries([...xs.reduce((m, x) => m.set(x.type, (m.get(x.type) ?? 0) + 1), new Map())].sort());
const check = (g, label) => {
  const ids = new Set(g.nodes.map((n) => n.id));
  const dangling = g.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to)).length;
  const noSrc = g.edges.filter((e) => !e.source?.url).length;
  const dupN = g.nodes.length - ids.size;
  const dupE = g.edges.length - new Set(g.edges.map((e) => e.id)).size;
  console.log(`  ${label}: nodes=${g.nodes.length} edges=${g.edges.length} dangling=${dangling} noSourceUrl=${noSrc} dupNodes=${dupN} dupEdges=${dupE}`);
};

let graph = await enrichGraph(buildGraph(benchmark), benchmark);
console.log("base graph", count(graph.nodes), count(graph.edges));

async function expand(id) {
  const t0 = performance.now();
  const delta = await expandNode(graph, id);
  console.log(`\nexpand ${id} (${((performance.now() - t0) / 1000).toFixed(1)}s): +nodes`, count(delta.nodes), "+edges", count(delta.edges), "notes:", delta.notes);
  const names = (t) => delta.nodes.filter((n) => n.type === t).map((n) => `${n.label} [${n.id}]`);
  console.log("  new diseases:", names("disease").slice(0, 12));
  console.log("  new targets:", names("target"));
  console.log("  new drugs:", names("drug"));
  const merged = mergeDelta(graph, delta);
  check(merged, "after merge");
  const twice = mergeDelta(merged, delta);
  console.log(`  idempotent: ${twice.nodes.length === merged.nodes.length && twice.edges.length === merged.edges.length}`);
  graph = merged;
}

const egfr = graph.nodes.find((n) => n.type === "target" && /CHEMBL203$/.test(n.id));
await expand(egfr.id);
const nsclc = graph.nodes.find((n) => n.isQueryDisease);
console.log("\nquery disease:", nsclc.id, nsclc.meta?.altIds);
await expand(nsclc.id);
const mondoOnly = graph.nodes.find((n) => n.type === "disease" && n.id.startsWith("disease:MONDO_") && !(n.meta?.altIds ?? []).some((a) => a.startsWith("EFO_")));
if (mondoOnly) await expand(mondoOnly.id);
else console.log("\n(no MONDO-only disease in the graph to test the graceful path)");
const drug = graph.nodes.find((n) => n.isCandidate);
await expand(drug.id);
