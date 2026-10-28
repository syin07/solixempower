// Evidence report: flatten the retrieved evidence into citable facts, ask Claude for a structured
// EvidenceReport, then validate it server-side (citations, claim kinds, layers, verdict).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { BenchmarkResult, EvidenceKind, EvidenceLayer, EvidenceReport, TrialsResult } from "@/lib/contracts";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

interface Fact {
  /** SourceRef ids shown to the model for this fact */
  ids: string[];
  /** Further ids that are valid citations for this fact (e.g. measurements beyond the shown cap) */
  alsoValid?: string[];
  kind: EvidenceKind;
  fact: string;
}

const LAYERS: EvidenceLayer[] = ["molecular", "preclinical", "clinical", "safety"];
const MAX_IDS_SHOWN = 10;

const ReportSchema = z.object({
  verdict: z.enum(["promising", "mixed", "insufficient_evidence", "unfavorable"]),
  headline: z.string(),
  sections: z.array(
    z.object({
      layer: z.enum(["molecular", "preclinical", "clinical", "safety"]),
      summary: z.string(),
      claims: z.array(
        z.object({
          text: z.string(),
          kind: z.enum(["measured", "computed", "clinical", "ai_summary"]),
          sourceIds: z.array(z.string()),
        }),
      ),
    }),
  ),
  openQuestions: z.array(z.string()),
  nextSteps: z.array(z.string()),
});

const SYSTEM = `You are a careful pharmacology analyst. You write evidence reports that compare a drug candidate with existing drugs, using ONLY the evidence list you are given.

Rules:
- Every claim must cite one or more evidence IDs from the list, exactly as written (each evidence line lists the IDs it may be cited by). Never cite an ID that is not in the list, and never state a number that is not in the list.
- Set each claim's kind to the kind of the evidence it rests on: measured (lab assay), computed (calculated properties), clinical (human trials). Use ai_summary only for a synthesis across kinds.
- Potency in an assay does not establish clinical efficacy or safety. Say so where relevant and never imply the candidate will work in humans.
- Ranks across different assays are indicative only; same-assay (matched) comparisons are the strongest evidence. Prefer them when they exist.
- Write exactly one section per layer, in this order:
  - molecular: binding potency on the target — the pooled pChEMBL ranking and the same-assay (matched) comparisons.
  - preclinical: functional, cell-based or in vivo evidence. None is retrieved yet — say so and leave claims empty. Do not put binding data or computed properties here.
  - clinical: human trials. If no trial data was retrieved, say so and leave claims empty.
  - safety: the candidate's computed properties (MW, AlogP, Lipinski Ro5 violations, QED), labelled computed and explicitly NOT a safety assessment, plus drug warnings if any are listed.
- Verdict: "insufficient_evidence" when the evidence is too thin to judge. "unfavorable" only when there is enough measured evidence (at least 3 comparable measurements for the candidate, or a matched assay) showing the candidate is clearly weaker than the comparators. "promising" only when the measured evidence is favourable AND you have stated what is missing. Otherwise "mixed".
- Plain, precise language a research scientist would trust. No hype.`;

export function buildFacts(benchmark: BenchmarkResult, trials?: TrialsResult): Fact[] {
  const facts: Fact[] = [];
  const all = [benchmark.candidate, ...benchmark.comparators];
  const total = all.filter((b) => b.n > 0).length;

  for (const b of all) {
    const c = b.compound;
    const role = c.isCandidate ? "CANDIDATE" : "comparator";
    const phase = c.maxPhase == null ? "preclinical/unknown phase" : c.maxPhase >= 4 ? "approved" : `max phase ${c.maxPhase}`;
    // Potency rests on the individual activity records; the compound page is cited only when there are none.
    const actIds = [...new Set((b.measurements ?? []).map((m) => m.source.id))];
    facts.push({
      ids: actIds.length ? actIds.slice(0, MAX_IDS_SHOWN) : [c.source.id],
      alsoValid: actIds.slice(MAX_IDS_SHOWN),
      kind: "measured",
      fact:
        b.n > 0
          ? `${role} ${c.name} (${phase}): ${b.n} comparable ${benchmark.activityType} binding measurements on ${benchmark.target.name}; median pChEMBL ${b.medianPchembl} (range ${b.minPchembl}–${b.maxPchembl}); rank ${b.rank} of ${total} by median.`
          : `${role} ${c.name} (${phase}): no comparable ${benchmark.activityType} binding measurements on ${benchmark.target.name}.`,
    });
    const p = c.properties;
    if (c.isCandidate && p) {
      facts.push({
        ids: [c.source.id],
        kind: "computed",
        fact: `${c.name} computed properties (calculated by ChEMBL, not a safety assessment): MW ${p.molecularWeight ?? "?"}, AlogP ${p.alogp ?? "?"}, Lipinski Ro5 violations ${p.ro5Violations ?? "?"}, QED ${p.qed ?? "?"}.`,
      });
    }
  }

  for (const assay of benchmark.matchedAssays) {
    for (const row of assay.rows) {
      facts.push({
        ids: [row.source.id],
        kind: "measured",
        fact: `Same-assay comparison ${assay.assayChemblId} ("${assay.assayDescription}"): ${row.compoundName} pChEMBL ${row.pchembl}.`,
      });
    }
  }

  for (const t of trials?.trials ?? []) {
    facts.push({
      ids: [t.source.id],
      kind: "clinical",
      fact: `${t.nctId} "${t.title}": ${t.phase}, ${t.status}, enrollment ${t.enrollment ?? "?"}, interventions ${t.interventions.join(", ")}; primary outcomes: ${t.primaryOutcomes.join("; ") || "not listed"}; results posted: ${t.hasResults ? "yes" : "no"}.`,
    });
  }
  return facts;
}

export async function generateReport(benchmark: BenchmarkResult, trials?: TrialsResult): Promise<EvidenceReport> {
  const facts = buildFacts(benchmark, trials);
  const evidence = facts.map((f) => `[${f.ids.join(", ")}] (${f.kind}) ${f.fact}`).join("\n");
  const prompt = `Candidate: ${benchmark.candidate.compound.name}
Disease of interest: ${benchmark.query.disease || "not specified"}
Target: ${benchmark.target.name} (${benchmark.target.chemblId})
Clinical trial data: ${trials ? `${trials.trials.length} trials retrieved` : "NOT YET RETRIEVED — say so in the clinical section"}

Data-quality notes (context, not citable):
${benchmark.warnings.map((w) => `- ${w}`).join("\n")}

Evidence list:
${evidence}

Write the evidence report.`;

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // No temperature: Opus 5.5 rejects sampling parameters (400); effort is the only control.
    output_config: { effort: "medium", format: betaZodOutputFormat(ReportSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to write this report.");
  if (!response.parsed_output) throw new Error(`Report could not be parsed (stop_reason: ${response.stop_reason}).`);

  const report = validateReport(response.parsed_output, facts, Boolean(trials));
  // Too few comparable measurements and no same-assay comparison: no verdict beyond "insufficient".
  if (benchmark.candidate.n < 3 && benchmark.matchedAssays.length === 0) report.verdict = "insufficient_evidence";
  return report;
}

/**
 * Server-side guardrails (PRD §7): drop citations to IDs we never retrieved (and claims left with
 * none), relabel claims whose kind doesn't match their cited evidence, keep clinical empty when no
 * trials were sent, and return exactly the four layers in order.
 */
function validateReport(report: z.infer<typeof ReportSchema>, facts: Fact[], hasTrials: boolean): EvidenceReport {
  const kindsById = new Map<string, Set<EvidenceKind>>();
  for (const f of facts) {
    for (const id of [...f.ids, ...(f.alsoValid ?? [])]) {
      if (!kindsById.has(id)) kindsById.set(id, new Set());
      kindsById.get(id)!.add(f.kind);
    }
  }

  let dropped = 0;
  let relabelled = 0;
  const byLayer = new Map<EvidenceLayer, EvidenceReport["sections"][number]>();
  for (const s of report.sections) {
    const claims = s.claims.flatMap((c) => {
      const sourceIds = [...new Set(c.sourceIds)].filter((id) => kindsById.has(id));
      if (!sourceIds.length) {
        dropped++;
        return [];
      }
      const kinds = new Set(sourceIds.flatMap((id) => [...kindsById.get(id)!]));
      let kind = c.kind;
      if (kind !== "ai_summary" && !kinds.has(kind)) {
        kind = kinds.size === 1 ? [...kinds][0] : "ai_summary";
        relabelled++;
      }
      return [{ ...c, kind, sourceIds }];
    });
    const existing = byLayer.get(s.layer);
    if (existing) existing.claims.push(...claims);
    else byLayer.set(s.layer, { layer: s.layer, summary: s.summary, claims });
  }

  // No preclinical evidence is retrieved yet: move cited claims the model put there to their own layer.
  const home: Partial<Record<EvidenceKind, EvidenceLayer>> = { measured: "molecular", computed: "safety", clinical: "clinical" };
  for (const c of byLayer.get("preclinical")?.claims ?? []) {
    const layer = home[c.kind];
    if (!layer) continue;
    if (!byLayer.has(layer)) byLayer.set(layer, { layer, summary: "", claims: [] });
    byLayer.get(layer)!.claims.push(c);
  }
  byLayer.set("preclinical", {
    layer: "preclinical",
    summary: "No functional, cell-based or in vivo evidence was retrieved yet.",
    claims: [],
  });

  if (!hasTrials) {
    const removed = byLayer.get("clinical")?.claims.length ?? 0;
    if (removed) console.warn(`[report] removed ${removed} clinical claim(s): no trial data was sent`);
    byLayer.set("clinical", { layer: "clinical", summary: "Clinical trial data was not yet retrieved for this report.", claims: [] });
  }

  const sections = LAYERS.map((layer) => {
    const s = byLayer.get(layer);
    return s && (s.summary || s.claims.length) ? s : { layer, summary: "No evidence for this layer was retrieved.", claims: [] };
  });

  const openQuestions = [...report.openQuestions];
  if (dropped || relabelled) console.warn(`[report] citation check: ${dropped} claim(s) dropped, ${relabelled} relabelled`);
  if (dropped) openQuestions.push(`${dropped} AI claim(s) were removed because they cited evidence that was not retrieved.`);

  return { ...report, sections, openQuestions };
}
