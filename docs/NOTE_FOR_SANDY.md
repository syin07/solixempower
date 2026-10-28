# Note for Sandy — M3/M4 merge (Medhansh, 2026-10-28)

Merged `medhansh/kg` into `main` on top of your hypothesis panel (`6fcd76c`) and query-disease card (`b0808ca`). Files of yours I touched:

- **`src/components/HypothesisPanel.tsx`** — add/add conflict. Kept your layout (pinned "Your question" card, accordion, `N found · M open`, `no_path`, your template wording) and added mine: per-card **pin path**, clickable **Path** steps that open the edge drawer, source chips on each ladder row, the "not a prediction" line, a note after expansions, and a scrolling list. New props: `graph`, `pinnedId`, `onPin`, `onSelectEdge`, `expanded`.
- **`src/components/EvidenceGraphSection.tsx`** — hover/pin highlight state (hovered card wins over pinned), panel above the drawer as you had it; clicking a path step opens the drawer and scrolls it into view (`#edge-drawer`).
- **`src/components/GraphApp.tsx`** — took your version unchanged: the AI report stays off `/`.
- **`src/components/EvidenceReport.tsx`** — new optional `hypotheses` prop; claims citing `hyp:*` render in a "Repurposing hypotheses" block with a code-generated table (`ReportHypotheses.tsx`). Not shown on `/` since the report is off the page.
- **`src/components/SourceChips.tsx`** (new) — `SourceChips` moved out of `EvidenceReport.tsx` so the report and the cards share it; `hyp:*` ids render as anchors instead of "unverified".

Backend (mine): `/api/report` accepts `graph`; one fact per hypothesis (incl. your `hyp:query` / `no_path`), server guardrails append NCT ids to claims about already-tested hypotheses and put each proposed hypothesis's suggested test in `nextSteps`.

**Contract follow-up:** hypothesis claims sit in the **clinical** section for now. A separate repurposing section needs `"repurposing"` added to `EvidenceLayer` in `contracts.ts` (R4) — your call; once it's there I'll move them.

Your `addQueryDiseaseAnswer` replaces my query-disease card (same disease id), so there's exactly one; with it the imatinib/IPF card now goes through PDGFRA → IPF (Open Targets 0.60) with NCT00131274, as in PRD §13.
