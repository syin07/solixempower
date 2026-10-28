// Outage drill: OPENTARGETS_DISABLED=1 node --import ./scripts/ts-loader.mjs scripts/check-outage.mjs <benchmark.json>
// Runs the /api/graph pipeline in-process with Open Targets failing fast; the graph must still build.
import { readFile } from "node:fs/promises";
import { buildGraph } from "../src/lib/kg/build.ts";
import { enrichGraph } from "../src/lib/kg/enrich.ts";
import { generateHypotheses } from "../src/lib/kg/hypotheses.ts";
import { addQueryDiseaseAnswer } from "../src/lib/kg/queryDisease.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: check-outage.mjs <benchmark.json>");
const benchmark = JSON.parse(await readFile(file, "utf8"));
let g = buildGraph(benchmark);
g = await enrichGraph(g, benchmark);
try {
  g = await generateHypotheses(g, benchmark);
} catch (e) {
  console.warn("hypotheses failed:", e.message);
}
g = await addQueryDiseaseAnswer(g, benchmark);
const count = (xs) => Object.fromEntries([...xs.reduce((m, x) => m.set(x.type, (m.get(x.type) ?? 0) + 1), new Map())].sort());
console.log("OPENTARGETS_DISABLED =", process.env.OPENTARGETS_DISABLED ?? "(unset)");
console.log("nodes", count(g.nodes), "\nedges", count(g.edges));
console.log("query node:", g.nodes.filter((n) => n.isQueryDisease).map((n) => `${n.id} meta=${JSON.stringify(n.meta)}`));
for (const h of g.hypotheses) console.log(`- ${h.template} ${h.status} | ${h.statement}`);
