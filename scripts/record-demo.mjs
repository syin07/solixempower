#!/usr/bin/env node
// Records REAL /api/benchmark + /api/trials + /api/graph + /api/report responses into src/fixtures/demo/ for demo mode (?demo=1).
// Needs the dev server running.
//   node scripts/record-demo.mjs --candidate <name-or-id> --disease "<disease>" [--target CHEMBLxxx] [--base http://localhost:3000]
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    candidate: { type: "string" },
    disease: { type: "string", default: "" },
    target: { type: "string" },
    base: { type: "string", default: "http://localhost:3000" },
    /** Also record the AI report (the graph-first page no longer requests it) */
    report: { type: "boolean", default: false },
  },
});
if (!args.candidate) {
  console.error('Usage: npm run demo:record -- --candidate <name-or-id> --disease "<disease>" [--target CHEMBLxxx]');
  process.exit(1);
}

const DEMO_DIR = path.join(process.cwd(), "src", "fixtures", "demo");

// Keep in sync with src/lib/demo.ts
const slug = (s) =>
  (s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "none";
const benchmarkDemoKey = (candidate, disease, target) =>
  `benchmark--${slug(candidate)}--${slug(disease)}--${target ? slug(target) : "auto"}`;
const reportDemoKey = (candidate, disease, targetChemblId) =>
  `report--${slug(candidate)}--${slug(disease)}--${slug(targetChemblId)}`;
const graphDemoKey = (candidate, disease, targetChemblId) =>
  `graph--${slug(candidate)}--${slug(disease)}--${slug(targetChemblId)}`;
const trialsDemoKey = (disease, drugs) => {
  const list = drugs.map((d) => d.trim().toLowerCase()).join(",");
  const hash = createHash("sha1").update(list).digest("hex").slice(0, 10);
  return `trials--${slug(disease)}--${slug(drugs[0])}--${hash}`;
};

async function call(label, url, init) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({ error: `non-JSON response (${res.status})` }));
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  if (!res.ok || data.error) throw new Error(`${label} failed (${res.status}): ${data.error ?? "unknown error"}`);
  if (data.isMock) throw new Error(`${label} returned isMock: true — refusing to record fake data`);
  console.log(`${label}: ${secs}s`);
  return data;
}

async function save(key, data) {
  await mkdir(DEMO_DIR, { recursive: true });
  const file = path.join(DEMO_DIR, `${key}.json`);
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
  console.log(`  saved ${path.relative(process.cwd(), file)}`);
}

const candidate = args.candidate.trim();
const disease = args.disease.trim();
const target = args.target?.trim() || undefined;

try {
  const qs = new URLSearchParams({ candidate, disease, ...(target && { target }) });
  const benchmark = await call("benchmark", `${args.base}/api/benchmark?${qs}`);
  await save(benchmarkDemoKey(candidate, disease, target), benchmark);

  // Same drug list the UI builds (src/components/BenchmarkApp.tsx): candidate first, then comparators.
  // The trials route needs a disease; without one (or if it fails) the report is recorded without trials.
  const drugs = [benchmark.candidate, ...benchmark.comparators].map((c) => c.compound.name);
  let trials;
  if (disease) {
    try {
      trials = await call("trials", `${args.base}/api/trials?${new URLSearchParams({ disease, drugs: drugs.join(",") })}`);
      await save(trialsDemoKey(disease, drugs), trials);
    } catch (e) {
      console.warn(`  trials skipped: ${e.message}`);
    }
  }

  // Evidence graph (docs/KG_PRD.md): built from the recorded payloads, enriched live.
  let graph;
  try {
    graph = await call("graph", `${args.base}/api/graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ benchmark, trials }),
    });
    await save(graphDemoKey(benchmark.query.candidate, benchmark.query.disease, benchmark.target.chemblId), graph);
    const count = (list, key) => list.reduce((m, x) => m.set(x[key], (m.get(x[key]) ?? 0) + 1), new Map());
    const fmt = (m) => [...m].map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`  graph: ${graph.nodes.length} nodes (${fmt(count(graph.nodes, "type"))})`);
    console.log(`         ${graph.edges.length} edges (${fmt(count(graph.edges, "type"))}), ${graph.hypotheses.length} hypotheses`);
  } catch (e) {
    console.warn(`  graph skipped: ${e.message}`);
  }

  let report = null;
  if (args.report) {
    report = await call("report", `${args.base}/api/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ benchmark, trials, graph }),
    });
    await save(reportDemoKey(benchmark.query.candidate, benchmark.query.disease, benchmark.target.chemblId), report);
  }

  const c = benchmark.candidate;
  const ranked = [c, ...benchmark.comparators].filter((b) => b.n > 0).length;
  console.log(
    `\n${c.compound.name} (${c.compound.chemblId}) on ${benchmark.target.name} (${benchmark.target.chemblId})` +
      `\n  rank ${c.rank} of ${ranked}, n=${c.n}, median pChEMBL ${c.medianPchembl}` +
      `\n  matched assays: ${benchmark.matchedAssays.length}, warnings: ${benchmark.warnings.length}` +
      `\n  trials: ${trials ? `${trials.trials.length} (${trials.trials.filter((t) => t.hasResults).length} with results)` : "not recorded"}` +
      (report ? `\n  verdict: ${report.verdict} — ${report.headline}` : "\n  report: not recorded (pass --report to include it)") +
      `\n\nReplay with ?demo=1 (the page forwards it to /api/benchmark, /api/trials and /api/graph).`,
  );
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
