# Candidate Benchmark

Hackathon project (7 h, 3 people). A researcher enters a drug candidate and a disease; the app
benchmarks the candidate's **measured** potency against drugs tested on the same target (ChEMBL),
shows the **clinical** landscape (ClinicalTrials.gov), and generates an AI evidence report where
every claim cites a retrieved source. Full spec: @PRD.md

## Plan
Phase 1 (now → T+3:30, Sandy + Gavin): working end-to-end MVP on real data — working over polished.
Phase 2 (T+3:30 → T+7, all three): trials layer, AI report hardening, UI polish, demo mode, video. Freeze at T+5:30.

## Commands
- `npm run dev` — app at http://localhost:3000
- `npm run lint`, `npx tsc --noEmit` — run before committing

## Ownership (who leads each area; Medhansh reviews and may edit anything, so call out cross-area changes)
| Area | Owner | Branch |
|---|---|---|
| `src/lib/chembl`, `src/lib/benchmark`, `src/app/api/benchmark`, `src/lib/contracts.ts`, `src/fixtures` | Sandy | `sandy/data` |
| `src/app/page.tsx`, `src/app/layout.tsx`, `src/components` | Sandy (taken over from Gavin) | `sandy/data` |
| `src/lib/agent`, `src/app/api/report` | Sandy until T+3:30, then Medhansh | — |
| `src/lib/trials`, `src/app/api/trials` | Medhansh | `medhansh/agent` |

## Rules
- `src/lib/contracts.ts` is the shared API contract. Only Sandy or Medhansh change it, and announce it in team chat. API routes must return
  exactly these shapes — the stubs serve `src/fixtures/*.json` in the same shape.
- Responses with `isMock: true` are fake; the UI must show a MOCK DATA banner for them.
- Scientific guardrails (PRD §7): compare only like-with-like assays, rank by pChEMBL median/range,
  never combine layers into one score, always label evidence kind (measured / computed / clinical /
  ai_summary), and the AI may only summarize retrieved evidence with valid `SourceRef.id` citations.
- Never commit API keys. `.env.local` holds `ANTHROPIC_API_KEY`.
- Small commits, frequent PRs to `main`. Sandy merges.

@.claude/role.md

Next.js version notes: @AGENTS.md
