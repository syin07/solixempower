// Live check for S3: node --import ./scripts/ts-loader.mjs scripts/check-enrich.mjs
import { readFile } from "node:fs/promises";
import { enrichGraph } from "../src/lib/kg/enrich.ts";
import { associatedDiseases, filterDiseaseRows, mapUniprotToEnsembl } from "../src/lib/kg/opentargets.ts";

const graph = JSON.parse(await readFile("src/fixtures/graph.json", "utf8"));
const benchmark = JSON.parse(await readFile("src/fixtures/demo/benchmark--poziotinib--non-small-cell-lung-cancer--auto.json", "utf8"));

const count = (xs) => Object.fromEntries([...xs.reduce((m, x) => m.set(x.type, (m.get(x.type) ?? 0) + 1), new Map())].sort());
console.log("before nodes", count(graph.nodes), "edges", count(graph.edges));
const t0 = performance.now();
const g = await enrichGraph(graph, benchmark);
console.log(`after  nodes`, count(g.nodes), "edges", count(g.edges), `(${((performance.now() - t0) / 1000).toFixed(1)}s)`);

const byId = new Map(g.nodes.map((n) => [n.id, n]));
console.log("\nquery disease:", g.nodes.filter((n) => n.isQueryDisease).map((n) => `${n.id} "${n.label}" alt=${n.meta?.altIds ?? "-"}`));
console.log("\ntargets:", g.nodes.filter((n) => n.type === "target").map((n) => `${n.id} ${n.meta?.symbol} ${n.meta?.ensemblId}`));
console.log("\nassociated_with edges:");
for (const e of g.edges.filter((e) => e.type === "associated_with")) {
  const sub = Object.entries(e.meta).filter(([k]) => k.startsWith("ot_")).map(([k, v]) => `${k.slice(3)}=${v}`).join(" ");
  console.log(`  ${byId.get(e.from)?.meta?.symbol} → ${byId.get(e.to)?.label} [${e.strength.toFixed(2)}] ${sub}`);
}
const pozi = g.nodes.find((n) => n.isCandidate);
console.log("\ncandidate routes:", g.edges.filter((e) => e.type === "administered_by" && e.from === pozi.id).map((e) => e.to));
const gef = g.nodes.find((n) => n.label.toLowerCase() === "gefitinib");
const gefInd = g.edges.filter((e) => e.type === "indicated_for" && e.from === gef?.id).map((e) => `${byId.get(e.to)?.label} (${e.label})`);
console.log("\ngefitinib indications:", gefInd.length, gefInd.filter((s) => /lung/i.test(s)));
console.log("mechanism edges:", g.edges.filter((e) => e.type === "mechanism").length);
const remaining = g.nodes.filter((n) => n.type === "disease");
const indOnly = remaining.filter((d) => !g.edges.some((e) => e.type === "associated_with" && e.to === d.id));
console.log(`\ndisease nodes remaining: ${remaining.length} (${indOnly.length} indication-only)`);
console.log("  indication-only:", indOnly.map((d) => `${d.label}${d.meta?.generic ? " [generic, candidate-linked]" : ""}`));
console.log("  generic names still present:", remaining.filter((d) => /^(cancer|neoplasm|carcinoma|tumou?r)$/i.test(d.label)).map((d) => d.label));
const dangling = g.edges.filter((e) => !byId.has(e.from) || !byId.has(e.to));
const noSource = g.edges.filter((e) => !e.source?.url);
const dupIds = g.edges.length - new Set(g.edges.map((e) => e.id)).size;
console.log(`\nchecks: dangling=${dangling.length} noSourceUrl=${noSource.length} dupEdgeIds=${dupIds} sources=${g.sources.length}`);

console.log("\n--- imatinib / PDGFRA (P16234) ---");
const map = await mapUniprotToEnsembl(["P16234"]);
const ens = map.get("P16234");
const rows = (await associatedDiseases(ens.ensemblId)).rows;
const kept = filterDiseaseRows(rows);
console.log(ens, "fetched", rows.length, "kept", kept.map((r) => `${r.name} [${r.score.toFixed(2)}]`));
console.log("IPF survives:", kept.some((r) => r.efoId === "EFO_0000768"));
