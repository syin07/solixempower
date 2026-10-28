#!/usr/bin/env node
// Records REAL /api/benchmark + /api/report responses into src/fixtures/demo/ for demo mode (?demo=1).
// Needs the dev server running.
//   node scripts/record-demo.mjs --candidate <name-or-id> --disease "<disease>" [--target CHEMBLxxx] [--base http://localhost:3000]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    candidate: { type: "string" },
    disease: { type: "string", default: "" },
    target: { type: "string" },
    base: { type: "string", default: "http://localhost:3000" },
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
const reportDemoKey = (candidate, disease) => `report--${slug(candidate)}--${slug(disease)}`;

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

  const report = await call("report", `${args.base}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ benchmark }),
  });
  await save(reportDemoKey(benchmark.query.candidate, benchmark.query.disease), report);

  const c = benchmark.candidate;
  const ranked = [c, ...benchmark.comparators].filter((b) => b.n > 0).length;
  console.log(
    `\n${c.compound.name} (${c.compound.chemblId}) on ${benchmark.target.name} (${benchmark.target.chemblId})` +
      `\n  rank ${c.rank} of ${ranked}, n=${c.n}, median pChEMBL ${c.medianPchembl}` +
      `\n  matched assays: ${benchmark.matchedAssays.length}, warnings: ${benchmark.warnings.length}` +
      `\n  verdict: ${report.verdict} — ${report.headline}` +
      `\n\nReplay with ?demo=1 (the page must forward it to /api/benchmark and /api/report).`,
  );
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
