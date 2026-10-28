#!/usr/bin/env node
// Posts the recorded sildenafil demo graph to /api/ask with the three suggested questions plus one
// off-graph question, and prints each answer. Needs the dev server running.
//   node scripts/check-ask.mjs [--base http://localhost:3000]
import { readFile } from "node:fs/promises";

const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const graph = JSON.parse(await readFile("src/fixtures/demo/graph--sildenafil--alzheimer-s-disease--chembl1827.json", "utf8"));
const questions = [
  "Which of these hypotheses were already tested?",
  "Why is the first target linked to the disease I asked about?",
  "What is missing before an in vivo study?",
  "What is the price of sildenafil?",
];
const history = [];
for (const question of questions) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph, question, history }),
  });
  const body = await res.json();
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\nQ: ${question}  (${res.status}, ${secs}s)`);
  if (!res.ok) {
    console.log(`  ERROR: ${body.error}`);
    continue;
  }
  console.log(`A: ${body.answer}`);
  console.log(`  claims ${body.claims.length}, dropped citations ${body.droppedCitations}, refusal ${body.refusal}, suggestedExpand ${body.suggestedExpand}`);
  for (const c of body.claims) console.log(`   - ${c.text} [${c.edgeIds.join(", ")}]`);
  history.push({ question, answer: body.answer });
}
