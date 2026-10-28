# PRD addendum — Evidence Graph: repurposing hypotheses on a query-time knowledge graph

**Written:** 2026-10-28, after judge feedback · **Time box:** 4 h from kickoff of this phase
(MVP by T+1:30 · refine to T+2:30 · video T+2:30–4:00) · **Owners:** Sandy (graph + visualization),
Medhansh (hypotheses, agent, report) · **Extends:** `PRD.md` (everything there still holds)

---

## 1. What the judge told us, and what we change

The judge cares about **repurposing**: an existing drug aimed at a disease it does not normally treat,
or the same drug with a new delivery route (oral → IV), and above all **testable hypotheses**. For
technical depth they want a **knowledge graph built or updated dynamically from the data**, an **agent
that searches it**, and a **visualization good enough to win points on its own**.

Today the app answers "how potent is my candidate against drugs on the same target?". We keep all of
that and add one layer on top: the retrieved evidence becomes a typed graph, the agent walks it to find
**gaps** (a drug reaches a disease through a target but has no indication or trial for it), and every gap
it can back with evidence becomes a hypothesis card with a concrete test. The product sentence becomes:

> Enter a drug. We build a live, fully cited evidence graph around it, find the diseases it could be
> repurposed for, tell you which of those ideas were already tried, and say what experiment would test
> the rest.

## 2. Honest evaluation: is a query-time graph better than the existing methods?

What exists: large precomputed graphs (Hetionet, DRKG, PrimeKG, Every Cure's MATRIX) with embedding or
GNN **link prediction** that scores every drug–disease pair, and newer LLM agents (BioScientist Agent,
BioAgent-RAG, BioDisco) that retrieve subgraphs from those static graphs. Open Targets collapses evidence
per target–disease pair into one harmonic-sum score.

| Dimension | Mega-graph + link prediction | Our query-time evidence graph | Who wins |
|---|---|---|---|
| Freshness | Snapshots; Hetionet unchanged since 2017 | Built per query from live ChEMBL, Open Targets, ClinicalTrials.gov | Us |
| Provenance | Millions of edges with no recorded source (Every Cure metrics page); SemMedDB has >500k inconsistent triples | Every edge **is** a record with a URL; an edge cannot exist without a `SourceRef` | Us |
| Comparability | Assay context dropped at merge time; contradictions documented in the literature | Assay stays attached; §7 filters apply before an edge is drawn | Us |
| Negative knowledge | A missing edge means "unknown" | "Checked, not found" is an explicit, timestamped edge with the query that was run | Us (nobody else does this) |
| Route of administration | Absent from all major repurposing graphs | Oral / parenteral / topical flags from ChEMBL per drug; reformulation template | Us (novel, cheap) |
| Auditability of the hypothesis | A probability from a black-box model | A path a human can read left to right, with the evidence for each hop shown separately, never summed | Us |
| **Coverage / recall** | All drugs × all diseases, including non-obvious links learned from side-effect profiles, expression signatures, text | One to two hops from the query drug; mechanism-based only | **Them** |
| **Surprise** | Can surface links no expert would guess | Finds what a well-read pharmacologist could find by hand, in seconds instead of hours | **Them** |
| Validation | Benchmarks shown to be inflated by leakage (KG-Bench 2025), but at least there are benchmarks | No predictive claim to validate; correctness means "every edge is real and every gap was actually checked" | Different game |

**Verdict.** For the user we serve (a researcher holding one specific drug), the query-time graph is the
better tool: it is auditable, current, and says what was *not* found. It is not a better *predictor*,
and we must not claim it is. The honest positioning, which also happens to be the judge-proof one:

> MATRIX-style systems are a telescope: they scan every pair and emit scores you cannot audit. We are a
> microscope: we build the evidence around one drug, show every link, and mark the gaps. The two are
> complementary. Ours is the one a reviewer can sign off on.

Where we are weaker, and the mitigation we build in:

- **Obvious hypotheses.** Shared-target repurposing is the easy class. Mitigation: we filter out diseases
  the drug is already indicated or trialed for (that is the gap check), drop generic disease terms,
  prefer diseases with genetic, somatic or animal-model evidence over literature-only, and always attach
  the *specific* experiment. The value is speed, traceability and the gap check, and we say so.
- **One borrowed black box.** The Open Targets association score is itself an aggregate. Mitigation: we
  store and display its per-datatype sub-scores (genetic, somatic, clinical, animal, literature) and
  label the edge `computed`, never `measured`.
- **False absence.** A ClinicalTrials.gov name search can miss a trial that used a trade name; ChEMBL
  indications lag. Mitigation: the edge reads "no interventional trial found for *imatinib* × *idiopathic
  pulmonary fibrosis* on 2026-10-28 (query shown)", never "never tested". We cannot prove a negative and
  the UI must not imply we can.
- **Shallow graph.** Two hops only in the MVP. Mitigation: click-to-expand pulls the next hop live
  (refine phase), which is also the "dynamically updated" behavior the judge asked for.

## 3. User flow (delta from PRD §5)

Steps 1–4 are unchanged (search, resolve, benchmark dashboard, clinical landscape). New:

5. **Evidence graph.** Appears after the trials load. Lanes left to right: Drugs · Targets · Diseases ·
   Trials. Nodes animate in lane by lane. The candidate is highlighted. Edges are colored by evidence
   kind and sized by strength. Hover a node to see its neighborhood; click an edge to open the record.
6. **Hypotheses panel** beside the graph. One card per hypothesis: the path in words, a status chip
   (*proposed* / *already indicated* / *already tested*), an evidence ladder (one row per kind, never
   summed), the suggested test, and source chips. Hovering a card highlights its path in the graph.
7. **Ask the graph** (refine): a question box. The agent answers from the graph with cited edges, using
   the same server-side citation check as the report.
8. **Evidence report** gains a *repurposing* section that summarizes the hypotheses, citing edge ids.

## 4. Graph model

Ids are strings with a type prefix so the agent and the UI can parse them without a lookup.

### Nodes

| Type | Id | Label | Source | Key fields |
|---|---|---|---|---|
| `drug` | `drug:CHEMBL941` | preferred name | ChEMBL molecule | `maxPhase`, `isCandidate`, `routes: ("oral"|"parenteral"|"topical")[]` |
| `target` | `target:CHEMBL2007` | pref name | ChEMBL target | `uniprot`, `ensemblId` (via Open Targets `mapIds`) |
| `disease` | `disease:EFO_0000768` | name | Open Targets / ChEMBL EFO | `isQueryDisease`, `therapeuticAreas`, `nAncestors` |
| `trial` | `trial:NCT00131274` | title | ClinicalTrials.gov | `phase`, `status`, `hasResults`, `enrollment` |
| `route` | `route:parenteral` | "Parenteral" | fixed vocabulary of 3 | — |
| `warning` | `warning:<warning_id>` | warning type | ChEMBL drug_warning | `warningClass`, `year` |
| `hypothesis` | `hyp:<n>` | one-line statement | generated | see §5; kind `ai_summary` |

EFO ids are normalized to the underscore form (`EFO_0000768`, `MONDO_0005233`); ChEMBL returns
`EFO:0000768` and must be rewritten on ingest. Assay nodes are **not** in the MVP graph (the matched-assay
table already shows them); refine may add them between drug and target.

### Edges

Every edge carries `kind` (an `EvidenceKind` or the new value `absent`), a numeric `strength` where one
exists, a human `label`, and a `source: SourceRef` so the report can cite it by `edge.id`.

| Type | From → To | Kind | Strength | Source id |
|---|---|---|---|---|
| `measured_against` | drug → target | `measured` | median pChEMBL; also `n`, `min`, `max` | the compound's measurement ids (`chembl-act:…`), first one shown |
| `mechanism` | drug → target | `clinical` (curated label record) | — ; `actionType`, `directInteraction` | `chembl-mech:<mec_id>` |
| `indicated_for` | drug → disease | `clinical` | `maxPhaseForInd` | `chembl-ind:<drugind_id>` |
| `tested_in` | drug → trial | `clinical` | phase number | `nct:<id>` |
| `for_disease` | trial → disease | `clinical` | — | `nct:<id>` |
| `associated_with` | target → disease | `computed` | overall score; `datatypeScores` kept separately | `ot-assoc:<ensembl>:<efo>` → platform page URL |
| `administered_by` | drug → route | `clinical` (regulatory record) | — | `chembl-mol:<id>` |
| `has_warning` | drug → warning | `clinical` | — | `chembl-warn:<id>` |
| `absent` | drug → disease | `absent` | — ; `checked: ("indication"|"trial")[]`, `checkedAt`, `query` | `check:<drug>:<disease>` (no URL; label says what was searched) |
| `supported_by` / `contradicted_by` | hypothesis → edge id | `ai_summary` | — | — |

Rules: edges are never merged across kinds; a drug–target pair may have both a `measured_against` and a
`mechanism` edge and both are drawn. `strength` is only comparable within one edge type.

### `GraphResult` (new in `contracts.ts`, Sandy announces)

```ts
export type GraphNodeType = "drug" | "target" | "disease" | "trial" | "route" | "warning" | "hypothesis";
export type GraphEdgeKind = EvidenceKind | "absent";
export interface GraphNode { id: string; type: GraphNodeType; label: string; isCandidate?: boolean; isQueryDisease?: boolean; meta?: Record<string, string | number | boolean | string[] | null>; source?: SourceRef }
export interface GraphEdge { id: string; type: string; from: string; to: string; kind: GraphEdgeKind; strength?: number; label: string; meta?: Record<string, string | number | boolean | string[] | null>; source: SourceRef }
export interface Hypothesis { id: string; template: "target_hop" | "comparator_hop" | "off_target_hop" | "route_hop"; status: "proposed" | "already_indicated" | "already_tested"; statement: string; drugId: string; targetId: string; diseaseId: string; pathEdgeIds: string[]; ladder: { kind: EvidenceKind | "absent"; label: string; value: string; sourceIds: string[] }[]; suggestedTest: string; sourceIds: string[] }
export interface GraphResult { query: BenchmarkResult["query"]; nodes: GraphNode[]; edges: GraphEdge[]; hypotheses: Hypothesis[]; builtAt: string; sources: SourceRef[]; isMock?: boolean }
```

## 5. Hypothesis grammar (Medhansh)

Hypotheses are produced **deterministically** by path templates in code. Claude never invents a
hypothesis; in refine it only writes the prose and the report section from the generated objects. That
is what keeps the demo reproducible and the output auditable.

| Template | Path | Hypothesis when… |
|---|---|---|
| `target_hop` | candidate —measured_against→ T —associated_with→ D | D ≠ query disease, candidate has no `indicated_for` D and no trial for D |
| `comparator_hop` | candidate —measured_against→ T ←measured_against— comparator —indicated_for / tested_in→ D | the comparator is approved or trialed for D and the candidate is absent there; strength = matched-assay head-to-head if one exists |
| `off_target_hop` | candidate —measured_against→ T₂ (a secondary target from `candidateTargets`) —associated_with→ D | as `target_hop`, on the candidate's other measured targets |
| `route_hop` (refine) | candidate —administered_by→ oral only; a same-target drug or D's trials use parenteral | emit "reformulation" hypothesis; label clearly as formulation, not new indication |

Filters on Open Targets disease rows (applied before any hypothesis):

- overall `score ≥ 0.4`, and at least one of `genetic_association`, `somatic_mutation`, `animal_model`
  ≥ 0.3 or `clinical ≥ 0.5` (literature-only associations are dropped);
- `ancestors.length ≥ 5` (drops "cancer", "neoplasm", "sarcoma"-level terms; verified today:
  "neoplasm" has 2 ancestors, "gastrointestinal stromal tumor" has 13);
- not the query disease, not one of its ancestors;
- fetch 25 per target, keep at most 8 per target, show at most 6 hypotheses in the MVP.

Status detection (this is the gap check; both results are written to the graph as edges):

- `already_indicated` if ChEMBL `drug_indication` has any row for (drug parent, disease EFO), any phase.
- `already_tested` if ClinicalTrials.gov returns ≥ 1 interventional study for `query.intr=<drug name>`
  × `query.cond=<disease name>` (`pageSize=3`, so we can show the NCT ids).
- otherwise `proposed`, and an `absent` edge is added with `checked: ["indication","trial"]`.

Evidence ladder (displayed as rows, **never summed**, order fixed):
measured potency on T (median pChEMBL, n, min–max) · target–disease evidence (each Open Targets datatype
sub-score as its own line) · clinical precedent (highest phase of any same-target drug for D) · safety
flags (warnings on the candidate) · route (candidate's routes).

Ordering of cards (lexicographic, not a score): `proposed` before `already_tested` before
`already_indicated`; then has genetic/somatic evidence; then Open Targets clinical sub-score; then
candidate median pChEMBL.

Suggested test (deterministic strings):

- if a same-target drug approved/trialed for D has a measurement in an assay the candidate was also
  measured in: *"Head-to-head in ChEMBL assay X (same assay as <comparator>): candidate median pChEMBL a
  vs b."*
- else if the candidate has a preclinical cell-based result: *"Run a D-relevant cell model; nearest
  existing measurement: <cell line / readout> (<assay id>)."*
- else: *"Confirm T engagement in a D-relevant cell model before any in vivo work."*
- for `already_tested`: *"Read the posted trial(s) <NCT…> before proposing a new study."*

## 6. Agent and search (Medhansh)

**Why a graph, not a vector store.** A repurposing hypothesis is a typed path with a negative
constraint (reaches the disease via a target, has no direct edge to it). Embedding similarity cannot
express "no edge exists", cannot compose two hops, and cannot enforce "same assay node". Each hop has its
own strength that §7 forbids collapsing, and the path is its own explanation. Embeddings belong only at
the edges of the system: resolving disease names to EFO ids and ranking free text (assay descriptions,
primary outcomes). We do not need a graph database; a few hundred nodes per query live in memory and
travel as JSON.

**MVP:** no LLM in the loop for hypotheses. The report route receives the `GraphResult`, hypotheses are
flattened to facts tagged `(kind; repurposing)` with their `sourceIds`, and the existing citation
validator covers them.

**Refine, "Ask the graph":** `POST /api/ask { graph, question }`. Claude gets the serialized graph
(nodes, edges with ids, hypotheses) and four pseudo-tools expressed as instructions: expand a node,
find paths matching a template, check absence, fetch an edge's evidence. It answers with claims that cite
edge ids; the server drops uncited claims exactly as `validateReport` does. Tool-use with live expansion
is a stretch; a single structured call over the serialized graph is the MVP of this feature.

## 7. Visualization (Sandy)

This is the part the judge scores by eye. Design rules:

- **Lanes, not a hairball.** Fixed x per type: drugs (candidate first, highlighted ring), targets,
  diseases, trials. Route and warning nodes sit as small satellites to the left of their drug. Every
  hypothesis then reads as a left-to-right sentence.
- **Encode evidence kind the same way the rest of the app does.** Edge colors follow `EvidenceBadge`:
  measured blue-600, computed violet dashed, clinical emerald, regulatory amber, `absent` red dashed.
  Node shape by type. Text labels always on; never color alone.
- **Strength as width.** `measured_against` width from median pChEMBL (5 → 1 px, 9 → 5 px);
  `associated_with` from overall score; `tested_in` from phase.
- **Interactions.** Hover node → neighbors highlighted, rest dimmed. Hover hypothesis card → its path
  highlighted. Click edge → detail drawer (all meta, datatype sub-scores, "Open record" link). Click node
  → expand (refine). Legend and a provenance line ("38 nodes · 71 edges · built 13:42 from live APIs")
  always visible.
- **It must visibly build.** On first render nodes are added lane by lane with a short stagger. On
  expand, new nodes animate in from their parent. This is the literal answer to "dynamically updated".
- **Library:** Cytoscape.js 3.34 (MIT) with a `preset` layout from positions we compute, loaded with
  `next/dynamic` and `ssr: false`. Fallback if it fights us for more than 20 min: a hand-rolled SVG lane
  diagram (positions are ours anyway; lines plus circles plus hover is an hour of work).

## 8. Data sources (verified 2026-10-28, no keys needed)

- ChEMBL `molecule/{id}.json` → `oral`, `parenteral`, `topical`, `first_approval`, `withdrawn_flag`,
  `black_box_warning` (e.g. gefitinib: oral true, parenteral false).
- ChEMBL `drug_indication.json?parent_molecule_chembl_id__in=…` → `efo_id` (`EFO:0003060` form),
  `efo_term`, `mesh_heading`, `max_phase_for_ind`, `indication_refs` (NCT lists). Reverse lookup by
  `efo_id=EFO:0003060` works (699 rows for NSCLC, 93 for IPF).
- ChEMBL `mechanism.json?target_chembl_id=…` → `mec_id`, `action_type`, `direct_interaction`,
  `mechanism_of_action`, `max_phase` (90 rows for EGFR).
- ChEMBL `target/{id}.json` → `target_components[0].accession` (UniProt).
- Open Targets GraphQL `https://api.platform.opentargets.org/api/v4/graphql`:
  - `mapIds(queryTerms:["P16234"], entityNames:["target"])` → `ENSG00000134853` (PDGFRA).
  - `target(ensemblId){ associatedDiseases(page:{index:0,size:25}){ rows{ score disease{id name
    ancestors therapeuticAreas{name}} datatypeScores{id score} } } }`.
  - Disease page URL for the source chip: `https://platform.opentargets.org/evidence/<ensembl>/<efo>`.
- ClinicalTrials.gov v2 `studies?query.cond=&query.intr=&filter.advanced=AREA[StudyType]INTERVENTIONAL
  &pageSize=3&fields=NCTId,BriefTitle,Phase,OverallStatus,HasResults` for the gap check (existing
  `ctgovStudies` client).

All go through the existing disk cache pattern (`.cache/<source>/`) so the demo can run offline.

## 9. Guardrails (extend PRD §7; judges will poke here too)

- Every edge has a `source`. The builder throws if asked to add one without.
- `absent` edges state the query and date. UI copy is "not found", never "none exists".
- No hypothesis score. Cards show a ladder; ordering is lexicographic and the UI says so in a tooltip.
- Open Targets edges are `computed`, with sub-scores visible. Literature-only associations are not
  hypotheses.
- Hypotheses are generated by code; Claude only phrases them and must cite the edge ids it was given.
- Footer disclaimer gains a sentence: *"A repurposing hypothesis here is a traceable gap in public
  evidence, not a prediction of efficacy."*

## 10. Scope

**MVP (T+1:30):** graph built from the existing benchmark + trials payloads plus target→disease,
route and indication edges; `target_hop`, `comparator_hop`, `off_target_hop` with the gap check; lane
visualization with hover and click-to-source; hypothesis cards; demo recording for the two cases.

**Refine (T+2:30):** click-to-expand on targets and diseases; `route_hop`; "Ask the graph"; repurposing
section in the report; polish (animation, legend, drawer); second demo recording; edge cases.

**Out of scope:** a graph database, link prediction or any learned score, literature mining, multi-drug
portfolio graphs, persistence across sessions.

## 11. Ownership and contract changes

| Area | Owner | Files |
|---|---|---|
| Graph types, builder, enrichment (Open Targets, routes, indications), `/api/graph`, visualization | Sandy | `src/lib/contracts.ts`, `src/lib/kg/{build,enrich,opentargets,layout}.ts`, `src/app/api/graph/route.ts`, `src/components/KnowledgeGraph.tsx` |
| Hypotheses, gap check, hypothesis panel, report and ask integration, demo recording | Medhansh | `src/lib/kg/hypotheses.ts`, `src/lib/trials/gapcheck.ts`, `src/components/HypothesisPanel.tsx`, `src/lib/agent/*`, `src/app/api/{report,ask}/route.ts`, `scripts/record-demo.mjs` |
| Wiring in `BenchmarkApp.tsx` | Sandy (Medhansh may edit the hypothesis section) | `src/components/BenchmarkApp.tsx` |

Contract change is one addition (the `GraphResult` block in §4) and one new value in `GraphEdgeKind`.
`EvidenceKind` itself does not change, so nothing existing breaks. Sandy makes the change first (step
S1 in `KG_PLAN.md`) and announces it; Medhansh codes against it from minute 10.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Open Targets slow or down during the demo | Disk cache; demo mode replays the recorded `GraphResult` |
| Disease id mismatch between ChEMBL (`EFO:`) and Open Targets (`EFO_`/`MONDO_`) | Normalize on ingest; fall back to case-insensitive name match; log unmatched |
| Hypotheses look trivial ("EGFR inhibitor → other cancers") | Generic-term and literature-only filters; gap check; the suggested test is specific; refine adds `route_hop` |
| Cytoscape integration eats the time box | 20-minute rule, then SVG fallback (§7) |
| Report contradicts a hypothesis card | Hypotheses are facts in the prompt; the headline consistency rule already exists |
| Two people editing `BenchmarkApp.tsx` | Sandy owns it; Medhansh adds only the `<HypothesisPanel>` line in a 5-line PR |

## 13. Demo story (3 min, replaces PRD §13 steps 2–4)

**Case A, poziotinib / NSCLC (existing recording, extended).** Potency chart as today. Then the graph:
EGFR, HER2, HER4 lanes out to diseases; the gap check marks NSCLC and breast cancer as *already tested*,
and surfaces one or two *proposed* diseases on a secondary target with the exact assay to run.

**Case B, imatinib / idiopathic pulmonary fibrosis (new, verified today).** Imatinib has 15 measured
PDGFRA activities; Open Targets links PDGFRA to IPF with a clinical sub-score of 0.97; ClinicalTrials.gov
holds NCT00131274, a completed phase 2/3 trial with no results posted. The card reads *already tested*,
links the trial, and says "read the trial before proposing another". That one screen shows hypothesis
generation **and** the gap check **and** honesty about absence. Nintedanib appears as the approved
same-target comparator. Then "what is *not* in the graph" closes the pitch: no efficacy prediction, every
edge a record, every gap a dated search.
