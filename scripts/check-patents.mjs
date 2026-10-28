// Live check for the IP layer: node --import ./scripts/ts-loader.mjs scripts/check-patents.mjs
import { getIpStatus } from "../src/lib/kg/patents.ts";
import { lookupIngredient, orangeBookFetchedAt } from "../src/lib/kg/orangebook.ts";

for (const name of ["sildenafil", "imatinib", "poziotinib", "acetaminophen", "gefitinib"]) {
  const t0 = performance.now();
  const ob = await lookupIngredient(name);
  const ip = await getIpStatus(name);
  console.log(`\n${name} (${((performance.now() - t0) / 1000).toFixed(1)}s) source=${ip.source}`);
  if (ob) console.log(`  OB: ingredients=${ob.ingredients.join("|")} NDAs=${ob.ndas.length} ANDAs=${ob.andaCount} patents(all)=${ob.patents.length} first=${ob.firstApproval}`);
  console.log(`  unexpired=${ip.unexpiredPatents} latest=${ip.latestExpiry ?? "-"} useOnly=${ip.useCodeOnly} substance=${ip.substancePatents} excl=${ip.exclusivityUntil ?? "-"}`);
  for (const p of ip.patents) console.log(`    ${p.patentNo} ${p.expires} ${p.useCode ?? ""} ${p.substance ? "SUBSTANCE" : ""}${p.product ? " product" : ""}`);
  console.log(`  ${ip.summary}`);
  console.log(`  ${ip.url}`);
}
console.log("\nOrange Book files fetched:", await orangeBookFetchedAt());
