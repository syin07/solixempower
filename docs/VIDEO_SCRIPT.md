# Demo video script (target 3:00)

Record against demo mode so nothing waits on ChEMBL or Claude:
`http://localhost:3000/?candidate=poziotinib&disease=non-small%20cell%20lung%20cancer&demo=1`
(the link auto-runs the search). Browser at 1440 px wide, zoom 110–125% for legibility.

Re-record the demo data first if any code changed: `npm run demo:record -- --candidate poziotinib --disease "non-small cell lung cancer"`.

| # | Time | Screen | Narration |
|---|---|---|---|
| 1 | 0:00–0:20 | Empty search page | "Is my compound worth pursuing? Answering that means hours in ChEMBL and ClinicalTrials.gov, and it's easy to compare numbers that were never comparable. Candidate Benchmark does it in one search, and shows its work." |
| 2 | 0:20–0:35 | Type **poziotinib** + **non-small cell lung cancer**, Benchmark | "Our candidate is poziotinib, an EGFR inhibitor that reached phase 3 but was never approved. That makes it a real 'is this worth pursuing?' question." |
| 3 | 0:35–0:50 | Compound card + target box | "It resolves the compound in ChEMBL and auto-selects its target, EGFR. Properties here are labelled *computed*, not measured. The target can be switched from this dropdown." |
| 4 | 0:50–1:20 | Potency chart | "Poziotinib ranks **#2 of 13** EGFR drugs by median pChEMBL. We rank by median, show the full range, and only rank comparable data: IC50, purified-protein binding assays, exact values, wild-type EGFR." |
| 5 | 1:20–1:45 | Matched-assay table | "The strongest evidence is when two drugs were tested in the *same* assay. Head to head, poziotinib **beat afatinib, 9.86 versus 9.19**, and **tied gefitinib at 9.60**." |
| 6 | 1:45–2:05 | Warnings panel (point at mobocertinib + mutant lines) | "And it tells you what to distrust. The #1 drug has only two measurements. Over 200 mutant-EGFR measurements were excluded, which matters in NSCLC, where mutant EGFR drives disease. We say so rather than hide it." |
| 7 | 2:05–2:25 | Clinical landscape table (60 trials), filter Phase 3; scroll past preclinical table + drug-warnings panel | "Here's the clinical landscape: 60 NSCLC trials of these drugs from ClinicalTrials.gov. Poziotinib has six of its own. Its phase 3 is suspended and its phase 2s were terminated, which is exactly the context a researcher needs. This is development stage, not head-to-head efficacy. Cell-based results and regulatory warnings are listed separately and never ranked." |
| 8 | 2:25–2:50 | AI report: verdict chip, then click a source chip | "Claude writes the evidence report, but only from what we retrieved. Every claim is labelled measured, computed or clinical, and every claim cites a source. *(click chip, ChEMBL opens)* The server deletes any claim that cites something we didn't retrieve. Where evidence is missing, it says so." |
| 9 | 2:50–3:00 | Footer disclaimer | "We don't predict that it works in humans. We show what's known, what's comparable, and what's missing." |

## Judge questions to be ready for
- **Why exclude mutant EGFR?** It isn't comparable to wild-type measurements; mixing them would make the ranking meaningless. The warning names the variants (L858R/T790M, C797S). A variant selector is the obvious next step.
- **Why is the #1 drug on n=2?** We don't hide low-n compounds; we flag them. The median and range show the uncertainty.
- **Comparators by disease?** They're chosen by target mechanism; the warnings list which of them have a ChEMBL NSCLC indication.
- **Can the AI make things up?** It only sees retrieved facts with IDs; the server validates every cited ID and the evidence kind, removes bad claims and notes the removal in open questions.
- **Why no single score?** Potency, preclinical, clinical and safety answer different questions. Combining them into one number would hide that (PRD §7).
