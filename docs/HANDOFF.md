# Handoff for Medhansh (T+3:30)

You own `src/lib/trials`, `src/lib/agent`, `src/app/api/trials`, `src/app/api/report` from now on. Most of R8 and R9 is already built (we got ahead while waiting), so your job is **review, harden and own it**, not build from scratch.

## Run it
```bash
git pull && ./setup.sh medhansh     # then put ANTHROPIC_API_KEY in .env.local
npm run dev
open "http://localhost:3000/?candidate=poziotinib&disease=non-small%20cell%20lung%20cancer&demo=1"
```
Drop `&demo=1` for a live run: benchmark ~5–20 s cold, trials ~0.5 s, report ~15–25 s (Opus 5.5).

## What exists
| Piece | Where | Notes |
|---|---|---|
| Contract | `src/lib/contracts.ts` | Sandy owns. All recent additions are optional (`candidateTargets`, `preclinical`, `drugWarnings`). |
| Trials (R8) | `src/lib/trials/{client,index}.ts`, `api/trials/route.ts` | ClinicalTrials.gov v2, one query per drug (`query.cond` × `query.intr`, 4 at a time), dedupe by NCT, sort phase ↓ → has results → enrollment. Cap 60; candidate keeps 10, each comparator 3. Disk cache `.cache/trials` (24 h). Readable phase/status strings. |
| Report (R9) | `src/lib/agent/report.ts`, `api/report/route.ts` | Evidence flattened to facts tagged (kind; layer) with citable IDs → Claude structured output → server validation. |
| Demo mode (R11) | `src/lib/demo.ts`, `scripts/record-demo.mjs`, `src/fixtures/demo/` | `?demo=1` replays recordings; falls through to live if missing. |

## Report guardrails already enforced server-side (PRD §7)
- Citations: unknown IDs dropped; claims left uncited dropped; count noted in `openQuestions`.
- Kind check: claim `kind` must match the kind of the facts it cites (else relabelled).
- Layers: always 4 sections in order; preclinical only holds preclinical-cited claims; clinical is empty with "not yet retrieved" when no trials were sent.
- Verdict guard: candidate n < 3 and no matched assay → `insufficient_evidence`.
- Matched-assay outcomes are precomputed ("ahead of afatinib by 0.67") so the headline can't contradict them.
- Trials sent to the model are capped at 25 (candidate's first). Posted results are acknowledged as "not analysed", never summarized.
- Temperature: Opus 5.5 rejects `temperature`, so it isn't set. Recordings are what make the demo deterministic.

## Things worth your time
1. **Edge cases** (§10 step 4): unknown compound, no target data, a candidate with no trials, IPF backup (`nintedanib` + `idiopathic pulmonary fibrosis`, 47 trials). The QA pass's earlier list is mostly fixed; re-run a few by hand.
2. **Drop/relabel paths** in `validateCitations` haven't been triggered by a live run. A quick unit-style check with a fake report would confirm them.
3. A compound with no preferred name is sent to trials as its ChEMBL ID, which matches nothing. Fine for the demo.
4. **Accuracy review of the video** (`docs/VIDEO_SCRIPT.md`).

## Rules
- Don't change response shapes. The UI (`src/components/*`) depends on them.
- **After any change to benchmark/trials/report code, re-record the demo:** `npm run demo:record -- --candidate poziotinib --disease "non-small cell lung cancer"` (and `gefitinib`). Then check the headline matches the sections.
- `npx tsc --noEmit && npm run lint` before committing. Sandy merges to `main`.
