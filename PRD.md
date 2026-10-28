# PRD — Candidate Benchmark: AI Evidence Benchmarking for Drug Candidates

**Status:** In progress (hackathon started) · **Team:** Sandy, Gavin, Medhansh · **Time box:** 7 hours

---

## 1. One-liner

A researcher enters a drug candidate and a disease. The app shows how the candidate's **measured** potency compares with drugs already tested against the same target, what the **clinical** landscape looks like for that disease, and gives an **AI evidence report** where every claim links to its source. The report never makes up results it doesn't have.

## 2. Problem

To answer "is my compound worth pursuing?", a researcher has to dig through ChEMBL for comparable assays, search ClinicalTrials.gov for competing programs, and then work out which numbers can fairly be compared. That takes hours and is easy to get wrong. A common mistake is comparing IC50 values from unrelated assays as if they meant the same thing.

## 3. Scope decision: Option C, as a thin slice

We build all three layers but go deep on only one:

| Layer | Depth | What we actually build |
|---|---|---|
| **A. Molecular potency** | **Deep (core)** | ChEMBL activities on the candidate's target. Ranked by pChEMBL, with a **matched-assay** head-to-head where the candidate and a comparator were measured in the same assay |
| **B. Preclinical** | Light | Show the candidate's ChEMBL functional (`F`) assays as a separate, unranked list. No combined score |
| **C. Clinical** | Medium | ClinicalTrials.gov **landscape**: trials for the disease and the comparator drugs (phase, status, enrollment, primary endpoints, has-results). We do **not** normalize outcomes across trials |
| **Safety** | Light | ChEMBL computed properties (Ro5, QED), labeled as computed, plus ChEMBL drug warnings for comparators if they're easy to get |
| **AI report** | Core differentiator | Claude summarizes only the retrieved evidence into a structured report with source IDs. The server rejects any claim that cites an ID we didn't retrieve |

**Out of scope:** training our own model, PubChem/Drugs@FDA integration (P2 at most), user accounts, a database, PDF export.

## 4. Demo story (primary case)

**Disease:** non-small cell lung cancer · **Target:** EGFR (CHEMBL203) · **Comparators:** approved EGFR inhibitors (gefitinib, erlotinib, afatinib, osimertinib) · **Candidate:** a less-known ChEMBL compound with EGFR data, which Sandy picks in hour 1.

We chose EGFR because ChEMBL has thousands of measurements on it, several approved drugs, and many trials. That makes the demo reliable.
**Backup case:** idiopathic pulmonary fibrosis (nintedanib/pirfenidone). It has thinner molecular data but a strong clinical landscape.

## 5. User flow

1. **Search:** the user types a candidate (a name or ChEMBL ID) and a disease.
2. **Resolve:** the app shows the matched compound card (structure ID, max phase, computed properties) and the auto-selected target, i.e. the candidate's most-measured human single-protein target. The user can switch targets from a dropdown.
3. **Benchmark dashboard:**
   - Potency chart: pChEMBL per compound as a range with the median. The candidate is highlighted and approved drugs are badged.
   - Matched-assay table: "measured in the same assay" rows. This is the most defensible comparison.
   - Warnings panel: for example "only 2 measurements for candidate" or "mixed assay types".
4. **Clinical landscape:** a table of trials, filterable by phase and has-results, each linking to ClinicalTrials.gov.
5. **Evidence report:** a verdict chip (promising / mixed / insufficient evidence / unfavorable) with a section per layer. Each claim carries an evidence-kind badge and clickable source chips.

## 6. Requirements

**Phase 1, the MVP (Sandy + Gavin, now → T+3:30):** a researcher can search, see a real ChEMBL benchmark, and get a basic AI report that works end to end. It can be rough but must be real.
**Phase 2, refine (all three, T+3:30 → T+7):** clinical layer, citation validation, UI polish, demo mode, presentation video.

| ID | Requirement | Phase | Owner |
|---|---|---|---|
| R1 | Resolve candidate by name or ChEMBL ID | 1 | Sandy |
| R2 | Pick target (auto + override) | 1 | Sandy |
| R3 | Retrieve comparator compounds (approved/clinical drugs for that target) and their activities | 1 | Sandy |
| R4 | Comparability filter + ranking + matched-assay detection (§7) | 1 | Sandy |
| R5 | Dashboard UI: search, compound card, potency chart, matched-assay table, warnings | 1 | Gavin |
| R6 | Basic AI report: Claude summarizes the benchmark into `EvidenceReport` JSON | 1 | Sandy |
| R7 | Report UI: verdict, sections, claims with source chips | 1 | Gavin |
| R8 | ClinicalTrials.gov landscape for disease + comparators (API + feed into report) | 2 | Medhansh |
| R9 | Harden the AI report: validate citations server-side, improve the prompt, handle edge cases | 2 | Medhansh |
| R10 | UI refinement: trials table, evidence-kind badges, loading/empty states, visual polish | 2 | Gavin |
| R11 | Demo mode: cached responses for the demo case (`?demo=1`) | 2 | Sandy |
| R12 | Presentation video | 2 | Sandy (lead) + Gavin |
| R13 | Stretch: functional assays (preclinical), comparator drug warnings, Vercel deploy | 2 | whoever is free |

## 7. Scientific guardrails (judges will poke at these)

- **Compare like with like.** By default the potency ranking uses only: the same target, human, the same activity type (IC50 by default), `standard_relation = '='`, binding assays (`B`), and rows that have a `pchembl_value`.
- **Ranking uses pChEMBL** (−log10 molar), not raw nM. We report the median and range per compound, never a single cherry-picked value.
- **Matched-assay comparisons** (same `assay_chembl_id`) are shown separately and labeled as the strongest evidence.
- **No universal "effectiveness score."** Layers are never combined into one number.
- **Evidence kinds are always labeled.** Measured ≠ computed ≠ clinical ≠ AI summary.
- **The AI only summarizes retrieved evidence.** Every claim has to cite `SourceRef.id`s from the payload, and the server drops or flags any claim that cites an unknown ID. When there's no clinical evidence, the report says so.
- A fixed disclaimer appears in the footer: *"Potency in an assay does not establish clinical efficacy or safety."*

## 8. Architecture

```
Next.js (App Router, TypeScript, Tailwind, Recharts) — one repo, one `npm run dev`
│
├── src/app/page.tsx + src/components/*      ← Gavin (UI)
├── src/app/api/benchmark/route.ts           ← Sandy   GET  ?candidate=&disease=&target=
│     └── src/lib/chembl/*, src/lib/benchmark/*
├── src/app/api/trials/route.ts              ← Medhansh (P2) GET ?disease=&drugs=a,b,c
│     └── src/lib/trials/*
├── src/app/api/report/route.ts              ← Sandy (P1) → Medhansh (P2)  POST {benchmark, trials} → EvidenceReport
│     └── src/lib/agent/*   (Anthropic SDK, model: claude-sonnet-5-5)
├── src/lib/contracts.ts                     ← shared types — Sandy owns, announce changes
└── src/fixtures/*.json                      ← mock responses; stub routes serve these at T+0
```

**Key rule:** every API route starts as a stub that returns its fixture. The UI is built against the stubs. Each owner then swaps their stub for the real implementation **without changing the response shape**. That way nobody waits on anybody.

Mock responses include `"isMock": true`, and the UI shows a "MOCK DATA" banner whenever it sees that flag, so we can't accidentally demo fake numbers.

## 9. Data sources (verify endpoints in hour 1)

**ChEMBL** — `https://www.ebi.ac.uk/chembl/api/data/` (append `.json` or send `Accept: application/json`)
- `molecule/search?q=` — resolve a candidate
- `molecule/{id}` — `max_phase`, `molecule_properties` (MW, AlogP, Ro5 violations, QED)
- `activity?molecule_chembl_id=&target_chembl_id=&standard_type=IC50&pchembl_value__isnull=false` — measurements
- `mechanism?target_chembl_id=` — approved/clinical drugs acting on a target, used as comparators
- `drug_indication?molecule_chembl_id=` — indications (optional context)
- `drug_warning` — safety warnings (P2)
- Pagination: `limit` (max 1000) and `offset`. Responses are slow (1–5 s), so **cache responses on disk/in memory**.

**ClinicalTrials.gov API v2** — `https://clinicaltrials.gov/api/v2/studies?query.cond=&query.intr=&pageSize=`
- Use: `protocolSection.identificationModule`, `statusModule`, `designModule.phases`, `armsInterventionsModule`, `outcomesModule.primaryOutcomes`, and the top-level `hasResults`.

**Anthropic API** — `ANTHROPIC_API_KEY` in `.env.local`. Use structured JSON output matching `EvidenceReport`.

## 10. Roles

Each person runs `./setup.sh <name>`. It installs deps, switches to their branch, prints their section below, and configures their coding agent with their role, owned files and tasks, pre-approved safe commands, and a prompt before editing someone else's files. Sandy and Medhansh use Claude Code (`.claude/role.md` + `.claude/settings.local.json`); Gavin uses GitHub Copilot in VS Code (`.github/copilot-instructions.md` + `.vscode/settings.json`). All generated files are gitignored. Sandy's first run also scaffolds the app.

<!-- role:sandy -->
### Sandy — setup, data pipeline, basic AI report, integration lead, video
**Branch:** `sandy/data` · **Owns:** `src/lib/chembl`, `src/lib/benchmark`, `src/app/api/benchmark`, `src/lib/contracts.ts`, `src/fixtures`, setup. In Phase 1 also `src/lib/agent` + `src/app/api/report` (hand these to Medhansh at T+3:30)

**Phase 1: MVP**
1. **Now** Run `./setup.sh sandy` (first run scaffolds the app), create the GitHub repo, push all branches, and add Gavin and Medhansh as collaborators. Share `ANTHROPIC_API_KEY` in team chat.
2. **+0:15** Get Gavin running. Gavin clones the repo, runs `./setup.sh gavin` and `npm run dev`, and sees mock data at `/api/benchmark`.
3. **+0:20–1:30** ChEMBL client: a `fetch` wrapper with caching, plus `resolveMolecule`, `getTargetsForMolecule`, `getActivities`, `getMechanismDrugs`. Pick the demo candidate by checking it has enough EGFR measurements.
4. **+1:30–2:30** Benchmark engine: comparability filter (§7), median/range/rank, matched assays, warnings. Replace the `/api/benchmark` stub without changing the shape.
5. **+2:30–3:10** Basic `/api/report`: send the benchmark's facts (with their `SourceRef.id`s) to Claude and get an `EvidenceReport` back as JSON. Without trials data, the clinical section says "not yet retrieved". Plain and working is the goal.
6. **+3:10–3:30** **MVP checkpoint:** merge `gavin/ui` + `sandy/data` into `main`, run the whole demo flow on real data, and fix whatever breaks. Tag the commit `mvp`.

**Phase 2: refine**
7. **T+3:30** Onboard Medhansh (15 min): show the MVP running, `contracts.ts`, and §7, then hand off `/api/report` + trials.
8. **+3:45–5:00** Demo mode (R11), then integration and bug fixes. You are the merge gatekeeper for `main`.
9. **+5:00–5:30** Write the video script (§13) and pick the screens to record.
10. **+5:30 freeze → 6:45** Record and edit the video with Gavin. Submit with a 15-minute buffer.
<!-- /role:sandy -->

<!-- role:gavin -->
### Gavin — frontend & visualizations
**Branch:** `gavin/ui` · **Owns:** `src/app/page.tsx`, `src/app/layout.tsx`, `src/components/*`

You build the whole UI against **mock data**. The API routes already return fake JSON in the final shape, so you don't need to wait for anyone. Types are in `src/lib/contracts.ts`. Read it first.

**Phase 1: MVP. Make it work, not pretty.**
1. **Now** Clone the repo, `./setup.sh gavin`, `npm run dev`, open http://localhost:3000 and http://localhost:3000/api/benchmark to see the mock JSON.
2. **+0:20–1:00** `SearchBar` (candidate + disease inputs, Submit). On submit, call `fetch('/api/benchmark?candidate=...&disease=...')` and keep the result in state. Add a loading state, an error message, and a `MockBanner` that shows when `isMock` is true.
3. **+1:00–2:00** `CompoundCard` (name, ChEMBL ID link, max phase badge like "Approved" / "Phase 2", computed properties marked "computed") and `PotencyChart` with Recharts: one row per compound, median pChEMBL dot plus a min–max bar, candidate highlighted. Axis label: "pChEMBL (higher = more potent)".
4. **+2:00–2:45** `MatchedAssayTable` and `WarningsPanel`.
5. **+2:45–3:10** `EvidenceReport`: after the benchmark loads, `POST /api/report` with `{ benchmark }`. Show the verdict, one card per section, and each claim with its source chips as links.
6. **+3:10** Commit, push, tell Sandy, and help test the MVP on real data.

**Phase 2: refine**
7. **+3:30–5:30** Polish: `TrialsTable` (from `/api/trials`, with phase/status columns and a has-results filter), `EvidenceBadge` (measured / computed / clinical / AI, each visibly different), empty states, disclaimer footer, and a layout that looks good on a projector and in the video.
8. **+5:30–6:45** Help Sandy record the video: drive the app while Sandy narrates, or the other way round.

**When stuck for more than 15 minutes, ask.** Copilot Chat in Agent mode is great for "make a Recharts horizontal range chart from this data". It already knows the project from `.github/copilot-instructions.md`.
<!-- /role:gavin -->

<!-- role:medhansh -->
### Medhansh — clinical layer & AI report hardening (joins ~T+3:30)
**Branch:** `medhansh/agent` · **Owns (from T+3:30):** `src/lib/trials`, `src/lib/agent`, `src/app/api/trials`, `src/app/api/report`

When you arrive, there's a **working MVP on `main`** (tag `mvp`): real ChEMBL benchmark, dashboard, and a basic Claude report. Your job is to add the clinical layer and make the AI report trustworthy. Don't change response shapes. Gavin's UI depends on them.

1. **T+3:30** `git pull && ./setup.sh medhansh`. Check `ANTHROPIC_API_KEY` is set in `.env.local`. Sandy walks you through the MVP (15 min). Read `src/lib/contracts.ts` and §7.
2. **+3:45–4:30** `/api/trials`: ClinicalTrials.gov v2 client. Query by disease (`query.cond`) and by comparator drug names (`query.intr`), dedupe by NCT ID, map to `Trial[]`, and sort by phase descending and then by has-results. Cache responses.
3. **+4:30–5:30** Harden `/api/report`: feed trials into the evidence, tighten the prompt (summarize only provided evidence, cite IDs, call out gaps), **validate citations server-side** (drop or flag claims citing unknown IDs), use temperature 0, and pre-generate a cached report for the demo case.
4. **+5:30–6:30** Integration review: check the app against §7, test edge cases (no target data, no trials, unknown compound), and fix what's fragile. Then review the video draft for scientific accuracy.
5. **Stretch:** comparator drug warnings, functional-assay list.
<!-- /role:medhansh -->

## 11. Timeline (T = hackathon start, 7 h)

| Time | Sandy | Gavin | Medhansh |
|---|---|---|---|
| 0:00–0:20 | Setup, repo, onboard Gavin | Clone, setup, read contracts | — |
| 0:20–2:30 | ChEMBL client → benchmark engine | Search, compound card, potency chart, tables (on mocks) | — |
| 2:30–3:10 | Basic AI report | Report UI | — |
| **3:10–3:30** | **MVP checkpoint: merge, run on real data, tag `mvp`** | | — |
| 3:30–3:45 | Onboard Medhansh | Polish | Setup, walkthrough |
| 3:45–5:30 | Demo mode, integration, video script | UI refinement, trials table | Trials API, harden AI report |
| **5:30** | **Feature freeze** | | |
| 5:30–6:45 | Record + edit video | Record video with Sandy | Edge cases, bug fixes, accuracy review |
| 6:45–7:00 | **Submit** | | |

**Checkpoints:** +1:30 (ChEMBL returning real data?), **+3:30 (MVP works end to end on real data, the one that matters)**, +5:30 (freeze). If the MVP slips, cut the matched-assay table before the AI report. AI is the theme. Never cut the guardrails.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| MVP not ready when Medhansh arrives | Stubs mean the UI always runs; Medhansh can start on trials independently either way |
| ChEMBL is slow or down while recording | Disk cache + `?demo=1` cached mode (R11). Record against cached data |
| The candidate's data is too thin for a good demo | Pick the candidate in hour 1 by checking measurement counts; keep the IPF backup |
| AI cites made-up numbers | Prompt passes only retrieved facts (Phase 1); server-side citation validation (Phase 2) |
| Merge conflicts | Clear file ownership (§8, §10). Only Sandy edits `contracts.ts`. Report files change hands at T+3:30. Sandy stops editing them then |
| Video runs long or eats too much time | Script written by 5:30, hard stop at 6:45, record against demo mode |
| Comparing incomparable assays gets criticized | §7 filters, matched-assay table, and a warnings panel we point to on purpose in the video |

## 13. Demo / video script (3 min)

1. The problem in one sentence. Then enter the candidate + NSCLC.
2. Potency chart: "our candidate ranks #N of M against approved EGFR inhibitors, but notice that we only rank comparable binding assays." Show the matched-assay table.
3. Clinical landscape: "here's how crowded this indication is. This is development stage, not head-to-head efficacy."
4. Evidence report: click a source chip and it opens the ChEMBL record. "Every claim is traceable. Where evidence is missing, it says *insufficient*."
5. Close: "We don't predict that it works in humans. We show what's known, what's comparable, and what's missing."

## 14. Open questions for Sandy

1. Is EGFR/NSCLC OK as the demo case, or does the hackathon theme point to a specific disease area?
2. Do we want the deploy on Vercel (R12), or is localhost fine for judging?
3. Model: `claude-sonnet-5-5` for speed, or `claude-opus-5-5` for report quality? Pre-caching the demo report makes speed matter less.
4. Do the hackathon rules allow pre-written scaffold code (this `scaffold/` folder) before the start? If not, Sandy runs `./setup.sh sandy` after kickoff.
