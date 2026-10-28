# Suggestions: what's valuable, what's weak, what to add

Written ~12:15 on 2026-10-28 for Sandy and Medhansh. This is a review of the current app as an **enterprise AI tool for drug R&D**, plus a prioritised list of features. It's a menu, not a commitment. Pick against the 5:30 freeze.

## 1. What the current features are worth

| Feature | Enterprise value | Why |
|---|---|---|
| Like-for-like filter + warnings panel | **High** | Comparing IC50s from incompatible assays is a real, common mistake. A tool that refuses to, and says what it excluded, is unusual. |
| Matched-assay table | **High** | It's how medicinal chemists actually judge against a competitor: same lab, same method. It's the most defensible number on the page. |
| Validated citations + evidence-kind badges | **High** | Enterprises won't adopt AI they can't audit. Traceable claims are what would get this past a pharma compliance review. |
| Clinical landscape | **High** | Portfolio and business-development teams do this competitive analysis by hand today. |
| Potency chart (median/range/n) | Medium–high | A clear visual. Its value depends on the filter above. |
| Target switcher | Medium | It's needed for multi-target compounds. Selectivity (below) would make it far more useful. |
| Preclinical cell-assay list | Medium–low | Twenty unranked results are noisy and hard to act on. Better grouped by cell line or readout. |
| Drug warnings | Low–medium | Regulatory warnings only, and sparse. Useful context, but nobody buys a tool for it. |
| Computed properties | Low | Every company already has these in its compound registration system. |
| **Verdict chip** | **Risky** | Close to the "single score" PRD §7 forbids. Aspirin/pain gets "Unfavorable" (last of 10 on COX-2 potency), which looks wrong to a judge. **Consider** renaming it "Evidence status", making it less prominent, or limiting it to "sufficient / insufficient evidence". |

**Biggest gap: public data only.** A real pharma candidate is usually an *internal* compound that isn't in ChEMBL, and a company's real value is its own assay data. As built, the tool can't benchmark the compounds a pharma team cares most about. This is the main enterprise story to pitch (see "bring your own data" below).

## 2. Feasible before the 5:30 freeze

Ordered by value for effort.

1. **Mutant-variant toggle** (owner: Sandy, `src/lib/benchmark`). Rank on e.g. L858R/T790M instead of wild-type. The mutant rows are already retrieved and currently excluded (206 for the demo). This answers the most likely judge question, and mutant EGFR is what matters in NSCLC. Needs an optional `variant=` query param plus an optional contract field. Announce it before changing `contracts.ts`.
2. **Provenance line** (UI + benchmark). Show the ChEMBL release, retrieval time and the active filters (activity type, assay type, relation, wild-type). Cheap, and it reads as enterprise-grade auditability.
3. **Follow-up question about the evidence** (owner: Medhansh, `src/lib/agent`). E.g. "Why is mobocertinib #1?", answered with the same retrieved facts and citation validation as the report. Fits the AI theme and reuses the existing guardrails.
4. **Export report** to Markdown or a print-friendly page, with source links. Researchers paste these into decision documents.
5. **Rethink the verdict chip** (see table). Small UI and prompt change, removes a weak spot.
6. **Friendlier "no target" error.** Pirfenidone currently shows "Not found in ChEMBL: a human single-protein target with measurements for CHEMBL1256391". Say instead that ChEMBL has no measured protein target for it, so there's nothing to benchmark.

## 3. Roadmap (pitch as "next", don't build today)

- **Bring your own data:** upload internal assay results (CSV) or a structure (SMILES) and benchmark proprietary compounds against public ones with the same comparability rules and cited report. *The headline enterprise feature.*
- **Structure similarity search:** nearest public analogues of the candidate (ChEMBL similarity API).
- **Selectivity panel:** potency on off-targets as well as the main target. A key safety signal for kinase inhibitors.
- **Literature and patent layer:** PubMed and patents, with the same citation rules.
- **Watchlists and alerts:** notify when a new trial, measurement or warning appears for a watched target or competitor.
- **Portfolio view:** compare several candidates side by side.
- **Reviewer workflow:** a scientist accepts or rejects each AI claim, giving an audit trail of who signed off.
- **Enterprise basics:** single sign-on, role-based access, saved and shared reports, data kept in the customer's cloud (Claude via Bedrock or Vertex, zero data retention).
- **Integrations:** Benchling and other lab notebook systems, Spotfire, internal compound registries.

## 4. Known issues from QA (for whoever picks these up)

See also `docs/HANDOFF.md`.
- Pirfenidone (IPF) has no measured target, so the IPF backup demo must use **nintedanib**.
- Aspirin/pain verdict is "Unfavorable" (see the verdict chip row above).
- A compound with no preferred name (e.g. WZ4002, CHEMBL1229592) is queried in trials by its ChEMBL ID and matches no trials.
- Verified OK: `npm run build`, bad-input errors, target switching, live runs on five drugs, every citation in both demo reports resolving to a visible source.
