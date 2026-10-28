// Live check for the FAERS layer: node --import ./scripts/ts-loader.mjs scripts/check-faers.mjs
import { getFaersSummary } from "../src/lib/kg/faers.ts";

for (const name of ["sildenafil", "imatinib", "poziotinib", "acetaminophen"]) {
  const t0 = performance.now();
  const f = await getFaersSummary(name);
  const pct = f.total ? Math.round((100 * f.serious) / f.total) : 0;
  console.log(
    `${name.padEnd(14)} field=${String(f.field).padEnd(16)} total=${String(f.total).padStart(7)} serious=${String(f.serious).padStart(7)} (${pct}%)` +
      `  top: ${f.topReactions.slice(0, 5).map((r) => `${r.term} ${r.count}`).join(", ") || "—"}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
  );
}
