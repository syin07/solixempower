# Demo video script (target 3:00)

Record against demo mode so nothing waits on ChEMBL, Open Targets or ClinicalTrials.gov. Record both
cases first (`npm run demo:record -- --candidate sildenafil --disease "alzheimer's disease"` and the
same for `imatinib` / `idiopathic pulmonary fibrosis`), then open:

- Case A: `http://localhost:3000/?candidate=sildenafil&disease=alzheimer%27s%20disease&demo=1`
- Case B: `http://localhost:3000/?candidate=imatinib&disease=idiopathic%20pulmonary%20fibrosis&demo=1`

The link auto-runs the search. Browser at 1440 px wide, zoom 110%. Expand has no recording and goes
live, so warm it once before recording (click Expand on the same node, then reload).

Narration is plain. Say a number only when it is on screen at that moment.

## Script

| # | Time | On screen | Narration |
|---|---|---|---|
| 1 | 0:00–0:15 | Empty page: title "Evidence Graph", search bar | "Drug repurposing starts with one question: is there an opening for this drug in that disease? Answering it means hours across ChEMBL, Open Targets and ClinicalTrials.gov, and it is easy to miss that someone already tried it. We answer it in one search, and we show our work on every edge." |
| 2 | 0:15–0:30 | Type **sildenafil** and **alzheimer's disease**. Press **Build graph**. Summary strip appears: SILDENAFIL, phase badge, target dropdown, counts | "Sildenafil. Everyone knows its repurposing history. We ask whether it has an opening in Alzheimer's. The app resolves it in ChEMBL and picks its most-measured target." |
| 3 | 0:30–0:55 | Graph builds lane by lane. Pause on it. Point at the legend, then the provenance line | "This is a knowledge graph built just now, around this one drug, from live databases. Left to right: drugs, the proteins they bind, the diseases those proteins are implicated in, and the trials. Blue edges are lab measurements. Violet dashed edges are computed disease links from Open Targets. Green are clinical records. Every edge is a record you can open. The line at the top says how many nodes and edges and when it was built." |
| 4 | 0:55–1:10 | Hover the **sildenafil** node, then the PDE5 target node (cGMP-specific 3',5'-cyclic phosphodiesterase) | "Hover a node and you see only its neighborhood. Hover the target and you see every drug measured on it and every disease it is linked to." |
| 5 | 1:10–1:40 | Right column, pinned card **Your question**: PROPOSED. Click it open. Scroll the ladder slowly: measured row, the two Open Targets rows, the precedent row, the red **Not found** row | "The first card answers the question we typed. Sildenafil reaches Alzheimer's through PDE5. Here is the evidence, one row per kind, never added into a score: measured potency, median pChEMBL 8.37 over 12 measurements. Open Targets links PDE5 to Alzheimer's at 0.29, which the card calls a weak link, with clinical and literature sub-scores shown separately. There is a precedent: udenafil, another PDE5 inhibitor, is in phase 3 for Alzheimer's. And the red row: we searched ChEMBL and ClinicalTrials.gov today and found no indication and no trial for sildenafil itself. That is the opening." |
| 6 | 1:40–1:55 | Hover the card so its path lights up and the rest dims. Then read the suggested test box | "Hover the card and its path lights up in the graph. Every card ends with the experiment that would test it." |
| 7 | 1:55–2:10 | Scroll to the next cards: atrial fibrillation, cardiac arrhythmia, atrial flutter via KCNH2 | "The graph also finds what we did not ask for. Sildenafil binds the hERG channel, so the next cards point at arrhythmias. That is not a repurposing idea, that is a safety liability, and the same graph shows it." |
| 8 | 2:10–2:40 | Switch to Case B link. Graph builds. Pinned card: ALREADY TESTED via PDGFRA. Click the NCT00131274 chip, ClinicalTrials.gov opens, come back | "Second question: imatinib, Gleevec, for pulmonary fibrosis. The graph finds imatinib binds PDGFRA, and Open Targets links PDGFRA to the disease with a clinical sub-score of 0.97. Then it tells us this exact idea was already run, a completed phase 2/3 trial, no results posted, and links it. The approved drug for this disease, nintedanib, is right there in the drug lane as the comparator. A system that generates a hypothesis and then checks whether it was already tried is the part a reviewer can trust." |
| 9 | 2:40–2:50 | Click a violet edge from PDGFRA to the disease. Drawer shows the sub-score bars and **Open record** | "Click any edge and you get the record behind it, down to the sub-scores." |
| 10 | 2:50–3:00 | Scroll to the footer disclaimer sentence | "Other tools predict. We show what's known, what's comparable, and what's missing, and we show our work on every edge." |

## If there is time: the expand beat (30 s, between beats 8 and 9)

| Time | On screen | Narration |
|---|---|---|
| 0:00–0:10 | Click the **PDGFRA** target node. Chip appears. Press **Expand +** | "The graph is not fixed. Click a node and ask for its next hop." |
| 0:10–0:25 | New disease nodes grow out of PDGFRA. Toast reads "Expanded … : +N diseases, +M edges". Provenance line now ends "expanded ×1" | "It fetches live from Open Targets, adds the new diseases with their sources, and the provenance line records that the graph was expanded." |
| 0:25–0:30 | Hover one new node | "Same rules: every new edge is a record." |

## Shot list

1. Empty page, 2 s hold.
2. Typing both fields, click Build graph.
3. Graph building lane by lane, full width, no cursor movement.
4. Hover sildenafil, hover PDE5.
5. Pinned card opened, slow scroll through the ladder, hold on the red Not found row.
6. Card hover with the path lit, then the suggested test box.
7. Scroll to the KCNH2 cards.
8. Case B build, pinned card, click NCT chip, external tab, back.
9. (Optional) Expand on PDGFRA, toast, provenance line.
10. Click violet edge, drawer with bars, click Open record.
11. Footer sentence, 3 s hold, cut.

Keep the cursor still during narration. Never scroll while the graph is animating.

## Judge questions

**Why a knowledge graph and not a vector database?**
A repurposing hypothesis is a typed path with a negative constraint: the drug reaches the disease through a protein but has no direct edge to it. Similarity search cannot express "no edge exists", cannot compose two hops, and cannot keep the three kinds of evidence separate the way the ladder does.

**How is this different from Every Cure's MATRIX or Hetionet?**
Those are telescopes: huge pre-built graphs, years old in Hetionet's case, scored by a model into probabilities nobody can audit, with millions of edges that have no recorded source. This is a microscope: built at query time around one drug, every edge a database record you can open, and it records what it searched for and did not find.

**What about a drug like Tylenol, where the mechanism is not well captured in assay data?**
Then the graph is thin, and the card says so: it reports the targets it checked and labels a weak link as weak. Assay databases under-represent some mechanisms, and an honest "we found little" is the right answer there, not a confident score.

**Is the Alzheimer's card a prediction?**
No. It is a traceable gap in public evidence, which the footer states on every page. The card gives the experiment that would turn the gap into data.
