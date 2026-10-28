# Evidence Graph — build plan (4 h)

Companion to `docs/KG_PRD.md`. Steps are sized for one coding agent each (Claude Code for both of us).
Every step says **who**, **when**, **files**, **done when**, and gives a prompt you can paste to your
agent. Clock `T` starts when Sandy pushes step S1. `tsc` means `npx tsc --noEmit && npm run lint`.

| Window | Sandy (graph + viz) | Medhansh (hypotheses + agent) |
|---|---|---|
| T+0:00–0:10 | S1 contract + branch | M0 read PRD, pull S1 |
| T+0:10–0:35 | S2 pure graph builder | M1 gap check client |
| T+0:35–1:05 | S3 enrichment (Open Targets, routes, indications) | M2 hypothesis templates |
| T+0:35–1:20 | S4 Cytoscape view (starts on a fixture, in parallel with S3) | M3 hypothesis panel |
| T+1:05–1:15 | S5 `/api/graph` route | M4 hypotheses into the report |
| T+1:15–1:30 | S6 wire into the page, **MVP checkpoint**, merge to `main` | M5 record demo (both cases) |
| T+1:30–2:30 | R1 expand-on-click, R2 polish | R3 `route_hop`, R4 Ask the graph, R5 edge cases |
| T+2:30–4:00 | V1 script, V2 record, V3 edit, submit at T+3:45 | V2 record together, accuracy review |

Branches: `sandy/kg` and `medhansh/kg` off `main`. Merge to `main` at T+0:35 (S2 + M1, so both have
real types and a fixture), T+1:30 (MVP), T+2:30 (freeze). Sandy merges.

Cut order if the clock slips: R4 → R3 → R1 → `off_target_hop` → animation. Never cut the gap check or
the source on every edge; they are the pitch.

---

## Phase 1 — MVP (T+0:00 → T+1:30)

### S1 · Contract and scaffolding (Sandy, 10 min)

Files: `src/lib/contracts.ts`, `package.json`, `src/lib/kg/` (new dir)

1. Append the `GraphResult` block from PRD §4 to `contracts.ts` (types `GraphNodeType`, `GraphEdgeKind`,
   `GraphNode`, `GraphEdge`, `Hypothesis`, `GraphResult`). Nothing existing changes.
2. `npm i cytoscape@3.34.4 && npm i -D @types/cytoscape@3.31.0`.
3. Create `src/lib/kg/ids.ts`: `nodeId(type, id)`, `edgeId(type, from, to)`, `normalizeEfo("EFO:0000768") → "EFO_0000768"`.
4. Push, post in chat: "contracts.ts: added GraphResult block, see KG_PRD §4".

Done when: `tsc` passes; Medhansh has pulled.

Agent prompt: *"Add the GraphResult types from docs/KG_PRD.md §4 to src/lib/contracts.ts without changing
any existing type. Create src/lib/kg/ids.ts with nodeId, edgeId and normalizeEfo helpers and unit-style
checks in a comment. Run npx tsc --noEmit."*

### S2 · Pure graph builder (Sandy, 25 min)

Files: `src/lib/kg/build.ts`, `src/fixtures/graph.json`, `scripts/build-graph-fixture.mjs`

`buildGraph(benchmark: BenchmarkResult, trials?: TrialsResult): GraphResult` with **no network**.
From the benchmark: one `drug` node per compound (candidate flagged), the `target` node,
`measured_against` edges (strength = median pChEMBL, meta n/min/max, source = first measurement's
`SourceRef`, meta `alsoValid` = the rest of the ids), `warning` nodes + `has_warning` edges from
`drugWarnings`. From trials: `trial` nodes, `tested_in` edges for every intervention that matches a
drug node name (case-insensitive, reuse the matching in `report.ts`), one `disease` node for the query
disease (`id: disease:query` until S3 resolves it), `for_disease` edges from each trial. `hypotheses: []`,
`sources` = every `SourceRef` used. Throw if any edge lacks a source.

Then a script (run with `node --import ./scripts/ts-loader.mjs scripts/build-graph-fixture.mjs`) that runs `buildGraph` on `src/fixtures/demo/benchmark--poziotinib--*.json` +
`trials--…` and writes `src/fixtures/graph.json`, so S4 and M3 can start on real shapes.

Done when: the fixture has ≥ 10 drug nodes, 1 target, ≥ 40 trial nodes, every edge has `source.url`.

Agent prompt: *"Implement buildGraph in src/lib/kg/build.ts per docs/KG_PRD.md §4 (nodes and edges
tables). Pure function, no fetch. Reuse SourceRefs from the payload. Write
scripts/build-graph-fixture.mjs that loads the poziotinib demo fixtures from src/fixtures/demo and writes
src/fixtures/graph.json. Run it and print node/edge counts by type."*

### M1 · Gap-check client (Medhansh, 25 min)

Files: `src/lib/trials/gapcheck.ts`, `src/lib/chembl/api.ts` (one new export, call it out in chat)

1. `hasTrialFor(drugName, diseaseName): Promise<{ nctIds: string[]; query: string; checkedAt: string }>`
   using the existing `ctgovStudies` with `pageSize: 3`, `filter.advanced: "AREA[StudyType]INTERVENTIONAL"`,
   `fields: ["NCTId","BriefTitle","Phase","OverallStatus","HasResults"]`. Cached like `getTrials`.
2. In `chembl/api.ts`, add `getIndications(parentIds): Promise<RawIndication[]>` returning the full
   `drug_indication` rows (`drugind_id, parent_molecule_chembl_id, efo_id, efo_term, mesh_heading,
   max_phase_for_ind`). `getIndicatedFor` can stay as is.
3. Verify by hand: `hasTrialFor("imatinib","idiopathic pulmonary fibrosis")` → `NCT00131274`;
   `getIndications(["CHEMBL939"])` → 51 rows for gefitinib.

Done when: both calls return the values above from a `node --import tsx` one-liner or a tiny route.

Agent prompt: *"Add src/lib/trials/gapcheck.ts with hasTrialFor(drugName, diseaseName) using the
existing ctgovStudies client (pageSize 3, interventional only), returning nctIds, the query string and an
ISO timestamp. Add getIndications(parentIds) to src/lib/chembl/api.ts returning full drug_indication rows.
Show me the output for imatinib × idiopathic pulmonary fibrosis and for CHEMBL939."*

### S3 · Enrichment: Open Targets, routes, indications (Sandy, 30 min)

Files: `src/lib/kg/opentargets.ts`, `src/lib/kg/enrich.ts`, `src/lib/chembl/api.ts` (`RawMolecule` gains
`oral`, `parenteral`, `topical`), `src/lib/cache.ts` (generic cached JSON fetch, extracted from the
ChEMBL client pattern if quick; otherwise copy the pattern)

1. `opentargets.ts`: `mapUniprotToEnsembl(accessions[])` via `mapIds`; `associatedDiseases(ensemblId,
   size=25)` returning `{ efoId, name, score, datatypeScores, nAncestors, therapeuticAreas }`;
   `resolveDisease(name)` via `search(queryString, entityNames:["disease"]) { hits { id name } }` (verify
   the field names on first call; if `search` differs, fall back to matching the name against ChEMBL
   indication `efo_term`s already in hand). Disk cache `.cache/opentargets/`, 24 h.
2. `enrich.ts`: `enrichGraph(graph, benchmark): Promise<GraphResult>`:
   - target → UniProt accession (`getTarget(...).target_components[0].accession`) → Ensembl → disease
     rows, filtered per PRD §5; add `disease` nodes and `associated_with` edges (kind `computed`,
     `strength` = score, `meta.datatypeScores`, source url `platform.opentargets.org/evidence/<ensembl>/<efo>`).
   - Resolve the query disease to an EFO id; rename `disease:query` to `disease:<EFO>` (and merge if the
     same id arrived from Open Targets).
   - Routes: `getMolecules` already returns full molecule records; add `administered_by` edges and the
     three `route` nodes (only those used).
   - Indications: `getIndications(all drug parent ids)` → `indicated_for` edges to normalized EFO ids,
     adding `disease` nodes as needed. Do this with Medhansh's M1 export; if M1 is not merged yet, add
     the call behind a feature flag and merge at T+1:05.
   - Secondary targets: for each `candidateTargets` entry (top 3 besides the selected target) add a
     `target` node and a `measured_against` edge with `strength = undefined`, `meta.n`, so `off_target_hop`
     has something to walk. Fetch their diseases too (3 more Open Targets calls, cached).
3. Every new edge has a `source`; `sources` is extended.

Done when: `enrichGraph` on the poziotinib fixture adds ≥ 6 disease nodes with sub-scores, `route:oral`
for poziotinib, and `indicated_for` edges for gefitinib → NSCLC. Print counts.

Agent prompt: *"Implement src/lib/kg/opentargets.ts and src/lib/kg/enrich.ts per docs/KG_PRD.md §4, §5
filters and §8 endpoints. Use the existing disk-cache pattern from src/lib/chembl/client.ts. Verify
against the live API: EGFR (P00533) → ENSG00000146648; PDGFRA → idiopathic pulmonary fibrosis should
survive the filters. Print node/edge counts before and after enrichment on src/fixtures/graph.json."*

### M2 · Hypothesis templates and status (Medhansh, 30 min)

Files: `src/lib/kg/hypotheses.ts`

`generateHypotheses(graph: GraphResult, benchmark: BenchmarkResult, deps: { hasTrialFor, getIndications
rows already in graph }): Promise<GraphResult>` returning the graph with `hypotheses` filled **and** the
status edges added (`absent` edges for proposed ones, `tested_in`/`for_disease` edges for newly found
trials, `indicated_for` already present from S3).

Implement `target_hop`, `comparator_hop`, `off_target_hop` exactly as PRD §5: candidate diseases =
diseases reachable via `associated_with` from a target the candidate has a `measured_against` edge to;
skip the query disease; status from `indicated_for` edges (already in graph) then `hasTrialFor`
(network, ≤ 8 calls, run with the existing `mapLimit`); ladder rows; ordering; suggested-test strings;
`pathEdgeIds` listing the real edge ids; `sourceIds` = union of the path edges' source ids. Cap 6.

Done when: on the enriched poziotinib graph (or, before S3 lands, a hand-made graph with two
`associated_with` edges) it emits ≥ 2 hypotheses with correct statuses and every `pathEdgeIds` entry
exists in `graph.edges`.

Agent prompt: *"Implement generateHypotheses in src/lib/kg/hypotheses.ts per docs/KG_PRD.md §5: three
templates, filters, status detection via indicated_for edges and hasTrialFor from
src/lib/trials/gapcheck.ts, evidence ladder rows (never summed), lexicographic ordering, deterministic
suggestedTest strings, absent edges with query and checkedAt. Add an assertion that every pathEdgeId
exists. Test on src/fixtures/graph.json plus two fake associated_with edges."*

### S4 · Cytoscape lane view (Sandy, 45 min, starts at T+0:35 on the fixture)

Files: `src/lib/kg/layout.ts`, `src/components/KnowledgeGraph.tsx`, `src/components/GraphLegend.tsx`

1. `layout.ts`: `positions(graph): Map<nodeId, {x,y}>` with lanes x = {drug: 0, target: 1, disease: 2,
   trial: 3} × 260 px; y spread evenly per lane, candidate at the top of its lane, diseases ordered so
   the query disease is first, trials grouped under their disease; `route`/`warning` nodes at x − 90
   beside their drug. Pure and tested on the fixture.
2. `KnowledgeGraph.tsx` (`"use client"`, imported with `next/dynamic` + `ssr: false`): Cytoscape with
   `layout: { name: "preset" }`, stylesheet per PRD §7 (edge color by `kind`, dashed for `computed` and
   `absent`, width from `strength`, node shape by `type`, candidate ring, labels on). Props:
   `graph`, `highlightEdgeIds?: string[]`, `onSelectEdge(edge)`, `onSelectNode(node)`.
   Hover node → neighbors class `hl`, others `dim`. Staggered add: push nodes lane by lane with
   `setTimeout` 250 ms apart on first mount so the graph visibly builds.
3. Legend component: the five edge kinds with the same swatches as `EvidenceBadge`, node shapes, and a
   provenance line `${nodes} nodes · ${edges} edges · built ${time} from live APIs`.
4. Edge detail drawer (simple `<aside>`): label, kind badge, all `meta` rows (datatype sub-scores as a
   list), "Open record" link to `source.url`.

Done when: `/` renders the fixture graph in a 560 px panel, hover and click work, no console errors,
`tsc` clean. **20-minute rule:** if Cytoscape is not rendering by T+0:55, switch to an inline SVG using
the same `positions()`; lines + circles + `onMouseEnter` are enough.

Agent prompt: *"Build src/components/KnowledgeGraph.tsx with cytoscape@3.34 (preset layout from
src/lib/kg/layout.ts lanes), styles per docs/KG_PRD.md §7 using the EvidenceBadge colors, hover
highlight/dim, highlightEdgeIds prop, staggered node insertion, an edge drawer, and a GraphLegend. Load it
via next/dynamic with ssr:false. Render src/fixtures/graph.json on a temporary /graph-dev page for
checking. Follow AGENTS.md for this Next.js version."*

### M3 · Hypothesis panel (Medhansh, 25 min, on the fixture plus fake hypotheses)

Files: `src/components/HypothesisPanel.tsx`

Cards per PRD §3 step 6: statement; status chip (`proposed` emerald outline, `already_tested` amber,
`already_indicated` zinc); template name in small caps; ladder rows each with an `EvidenceBadge` and
value; suggested test; source chips via the existing `sources` map pattern in `EvidenceReport.tsx`.
Props: `hypotheses`, `sources`, `onHover(id | null)`. Empty state: "No repurposing gap found within two
hops; expand a target or disease to look further." A tooltip on the ordering line: "ordered by status,
then genetic evidence, then clinical score; never summed".

Done when: it renders three fake hypotheses from the fixture ids and hover calls back.

### S5 · `/api/graph` (Sandy, 10 min)

Files: `src/app/api/graph/route.ts`, `src/lib/demo.ts` (+ `graphDemoKey`)

`POST { benchmark, trials? }` → `buildGraph` → `enrichGraph` → `generateHypotheses` (wrapped in try;
on failure return the graph with `hypotheses: []` and a `warnings`-style console line) → `GraphResult`.
`?demo=1` replays `graph--<candidate>--<disease>--<target>.json`. Same body validation as the report
route. Add `WebFetch(domain:api.platform.opentargets.org)` to `.claude/settings.local.json` allow list.

Done when: `curl` with the poziotinib demo benchmark + trials returns nodes, edges, ≥ 1 hypothesis.

### M4 · Hypotheses into the report (Medhansh, 15 min)

Files: `src/lib/agent/report.ts`, `src/app/api/report/route.ts`

Accept optional `graph?: GraphResult` in the body. In `buildFacts`, add one fact per hypothesis:
`ids = hypothesis.sourceIds (first 10) + "hyp:n"`, kind `ai_summary`, layer `clinical` for the MVP (a
`repurposing` layer is R4), text = statement + status + suggested test. Add two lines to the system
prompt: hypotheses are gaps in public evidence, not predictions; `already_tested` ones must be reported
as such with the trial id. `nextSteps` should carry the suggested tests. The existing validator covers
citations unchanged.

Done when: a live report for poziotinib mentions at least one hypothesis with a valid citation.

### S6 · Wire, checkpoint, merge (Sandy, 15 min)

Files: `src/components/BenchmarkApp.tsx`, `src/app/layout.tsx` (footer sentence from PRD §9)

After trials resolve, `POST /api/graph` (demo flag passed through), state `graph`, then send
`{ benchmark, trials, graph }` to the report. Layout: `<Section title="Evidence graph">` with the graph
on the left (2/3) and `<HypothesisPanel>` on the right (1/3), above the AI report. Hover wiring:
`HypothesisPanel.onHover` → `highlightEdgeIds`.

**MVP checkpoint:** live run for `imatinib` + `idiopathic pulmonary fibrosis` shows NCT00131274 as
`already_tested`; `poziotinib` + NSCLC shows ≥ 1 `proposed`. `tsc` clean. Merge both branches to `main`.

### M5 · Record demo (Medhansh, 15 min, after S6)

Extend `scripts/record-demo.mjs` to also POST `/api/graph` and save under `graphDemoKey`, and to send
`graph` to the report. Record `poziotinib` / NSCLC and `imatinib` / IPF (and `gefitinib` if time). Check
each recorded report's headline against its cards.

---

## Phase 2 — Refine (T+1:30 → T+2:30)

### R1 · Expand on click (Sandy, 30 min)
`POST /api/graph/expand { graph, nodeId }`: for a `target` fetch its diseases (size 25, same filters,
skip ones present); for a `disease` fetch Open Targets `associatedTargets` (top 8) and ChEMBL
`drug_indication?efo_id=` (top 8 drugs by `max_phase_for_ind`) and add them; returns only the delta
`{ nodes, edges }`. Client merges, recomputes positions, animates new nodes from the clicked node, then
re-runs `/api/graph` hypotheses on the merged graph (or skips if slow). This is the "dynamic" demo beat.

### R2 · Polish (Sandy, 30 min)
Dim non-path edges on card hover with a 150 ms transition; edge labels on hover only; fit-to-view button;
query disease pinned top of its lane; candidate ring pulses once on load; drawer shows the sub-score
bars (plain divs, no new chart lib); empty and error states for the graph section; mobile fallback is
"graph hidden below 900 px, cards still shown".

### R3 · `route_hop` (Medhansh, 20 min)
Per PRD §5: candidate oral-only, and either a same-target drug has `parenteral`, or any `proposed`/
`already_tested` disease's trial titles or interventions contain "intravenous", "IV", "infusion". Emit a
hypothesis with template `route_hop`, ladder rows: candidate routes (regulatory), precedent drug and its
routes, trial evidence; suggested test: "PK bridging study per FDA alternate-route guidance; nonclinical
local-tolerance for the IV route." Label the card "Formulation / route".

### R4 · Ask the graph + repurposing section (Medhansh, 40 min)
`POST /api/ask { graph, question }` → Claude (`claude-sonnet-5-5` for speed) with the serialized graph
and a `{ answer, claims:[{text, sourceIds}] }` schema; reuse `validateReport`'s citation dropping on
`claims`. UI: an input under the hypothesis panel with three suggested questions ("Which of these
hypotheses were already tested?", "Why is IPF linked to PDGFRA?", "What is missing before an in vivo
study?"). Then add `"repurposing"` to `EvidenceLayer` (announce; Sandy edits `contracts.ts`), a fifth
report section, and move the M4 facts there.

### R5 · Edge cases (both, 20 min)
Candidate with no Open Targets mapping (protein family target: use the first component accession);
disease name that does not resolve (keep `disease:query`, hypotheses still work); zero hypotheses; Open
Targets timeout (graph still renders without `associated_with` edges and the panel says so). Re-record
demos after any server change.

---

## Phase 3 — Video (T+2:30 → T+4:00)

- **V1 script (Sandy, 15 min):** update `docs/VIDEO_SCRIPT.md` with the PRD §13 story; Case B is the
  centerpiece because it shows generation, the gap check, and honesty in one screen.
- **V2 record (both, 45 min):** `?demo=1` only. Screens: search → potency chart (10 s) → graph building
  lane by lane (15 s) → hover a card, path lights up (10 s) → click the Open Targets edge, sub-scores,
  open record (10 s) → `already_tested` card, open NCT00131274 (15 s) → expand PDGFRA, new nodes animate
  (15 s) → ask the graph (15 s) → report repurposing section with chips (15 s) → close on the disclaimer.
- **V3 edit and submit (Sandy, 30 min):** hard stop at T+3:45; Medhansh does the accuracy pass on the
  narration while Sandy edits.

---

## Working agreements for this phase

- `contracts.ts` changes: Sandy only, announced in chat before pushing (S1, R4).
- Shared file `BenchmarkApp.tsx`: Sandy's; Medhansh's panel goes in through S6, then edits are
  one-line PRs.
- Every server change → re-record demos (M5 command) before the next merge.
- Run `npx tsc --noEmit && npm run lint` before every push. Commit small, push often; Sandy merges.
- Agent permission to add for both: `WebFetch(domain:api.platform.opentargets.org)`.
