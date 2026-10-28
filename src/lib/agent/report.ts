// Basic evidence report (Phase 1): flatten the retrieved evidence into citable facts, ask Claude
// for a structured EvidenceReport, then drop any citation to an ID we didn't retrieve.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { BenchmarkResult, EvidenceKind, EvidenceReport, TrialsResult } from "@/lib/contracts";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

interface Fact {
  id: string;
  kind: EvidenceKind;
  fact: string;
}

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
- Every claim must cite one or more evidence IDs from the list, exactly as written. Never cite an ID that is not in the list, and never state a number that is not in the list.
- Set each claim's kind to the kind of the evidence it rests on: measured (lab assay), computed (calculated properties), clinical (human trials).
- Potency in an assay does not establish clinical efficacy or safety. Say so where relevant and never imply the candidate will work in humans.
- Ranks across different assays are indicative only; same-assay (matched) comparisons are the strongest evidence. Prefer them when they exist.
- Write one section for each layer: molecular, preclinical, clinical, safety. If a layer has no evidence, say plainly that none was retrieved and leave its claims empty.
- Choose "insufficient_evidence" when the evidence is too thin to judge; "promising" only when the measured evidence is favourable AND you have stated what is missing.
- Plain, precise language a research scientist would trust. No hype.`;

export function buildFacts(benchmark: BenchmarkResult, trials?: TrialsResult): Fact[] {
  const facts: Fact[] = [];
  const all = [benchmark.candidate, ...benchmark.comparators];
  const total = all.filter((b) => b.n > 0).length;

  for (const b of all) {
    const c = b.compound;
    const role = c.isCandidate ? "CANDIDATE" : "comparator";
    const phase = c.maxPhase == null ? "preclinical/unknown phase" : c.maxPhase >= 4 ? "approved" : `max phase ${c.maxPhase}`;
    facts.push({
      id: c.source.id,
      kind: "measured",
      fact:
        b.n > 0
          ? `${role} ${c.name} (${phase}): ${b.n} comparable ${benchmark.activityType} binding measurements on ${benchmark.target.name}; median pChEMBL ${b.medianPchembl} (range ${b.minPchembl}–${b.maxPchembl}); rank ${b.rank} of ${total} by median.`
          : `${role} ${c.name} (${phase}): no comparable ${benchmark.activityType} binding measurements on ${benchmark.target.name}.`,
    });
    const p = c.properties;
    if (c.isCandidate && p) {
      facts.push({
        id: c.source.id,
        kind: "computed",
        fact: `${c.name} computed properties: MW ${p.molecularWeight ?? "?"}, AlogP ${p.alogp ?? "?"}, Lipinski Ro5 violations ${p.ro5Violations ?? "?"}, QED ${p.qed ?? "?"}.`,
      });
    }
  }

  for (const assay of benchmark.matchedAssays) {
    for (const row of assay.rows) {
      facts.push({
        id: row.source.id,
        kind: "measured",
        fact: `Same-assay comparison ${assay.assayChemblId} ("${assay.assayDescription}"): ${row.compoundName} pChEMBL ${row.pchembl}.`,
      });
    }
  }

  for (const t of trials?.trials ?? []) {
    facts.push({
      id: t.source.id,
      kind: "clinical",
      fact: `${t.nctId} "${t.title}": ${t.phase}, ${t.status}, enrollment ${t.enrollment ?? "?"}, interventions ${t.interventions.join(", ")}; primary outcomes: ${t.primaryOutcomes.join("; ") || "not listed"}; results posted: ${t.hasResults ? "yes" : "no"}.`,
    });
  }
  return facts;
}

export async function generateReport(benchmark: BenchmarkResult, trials?: TrialsResult): Promise<EvidenceReport> {
  const facts = buildFacts(benchmark, trials);
  const evidence = facts.map((f) => `[${f.id}] (${f.kind}) ${f.fact}`).join("\n");
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
    output_config: { effort: "medium", format: betaZodOutputFormat(ReportSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to write this report.");
  if (!response.parsed_output) throw new Error(`Report could not be parsed (stop_reason: ${response.stop_reason}).`);

  return validateCitations(response.parsed_output, new Set(facts.map((f) => f.id)));
}

/** Drop citations to IDs we never retrieved; drop claims left with no valid citation. */
function validateCitations(report: z.infer<typeof ReportSchema>, known: Set<string>): EvidenceReport {
  return {
    ...report,
    sections: report.sections.map((s) => ({
      ...s,
      claims: s.claims
        .map((c) => ({ ...c, sourceIds: c.sourceIds.filter((id) => known.has(id)) }))
        .filter((c) => c.sourceIds.length > 0),
    })),
  };
}
