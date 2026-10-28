// Evidence report: flatten the retrieved evidence into citable facts, ask Claude for a structured
// EvidenceReport, then validate it server-side (citations, claim kinds, layers, verdict).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { BenchmarkResult, EvidenceKind, EvidenceLayer, EvidenceReport, Trial, TrialsResult } from "@/lib/contracts";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

interface Fact {
  /** SourceRef ids shown to the model for this fact */
  ids: string[];
  /** Further ids that are valid citations for this fact (e.g. measurements beyond the shown cap) */
  alsoValid?: string[];
  kind: EvidenceKind;
  /** The report section this evidence belongs to */
  layer: EvidenceLayer;
  fact: string;
}

const LAYERS: EvidenceLayer[] = ["molecular", "preclinical", "clinical", "safety"];
const MAX_IDS_SHOWN = 10;
/** Trials sent to the model (candidate's own first, then by phase); the rest are not citable */
const MAX_TRIALS = 25;

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
  - preclinical: ONLY the evidence lines tagged layer "preclinical": the candidate's functional and cell-/organism-based assay results (e.g. growth inhibition in named cell lines), kind measured. Say plainly that these come from different assay formats and cell systems, are NOT comparable to the binding ranking or to each other, and must not be ranked or pooled. Report what was measured where (cell line or target, readout, value as recorded, including censored values like ">"). If no preclinical lines are listed, say none were retrieved and leave claims empty. Do not put binding-ranking data or computed properties here.
  - clinical: human trials. Trial facts show development stage only (phase, status, enrollment, endpoints). State how many of the listed trials test the candidate itself (its name appears in the interventions) versus only comparators. When trials have results posted, say results exist on ClinicalTrials.gov but outcome data were not retrieved or analysed here — never state or imply efficacy or safety outcomes. If no trial data was retrieved, say so and leave claims empty.
  - safety: the candidate's computed properties (MW, AlogP, Lipinski Ro5 violations, QED), labelled computed and explicitly NOT a safety assessment, plus the ChEMBL regulatory drug warnings listed (black box / withdrawn records for the candidate or comparators, kind clinical). A comparator's warning describes that approved drug, not the candidate. No recorded warning for an investigational candidate is NOT evidence of safety — it has simply not been through regulatory labelling.
- Each evidence line is tagged (kind; layer). Put claims in the section of the layer they rest on.
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
      layer: "molecular",
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
        layer: "safety",
        fact: `${c.name} computed properties (calculated by ChEMBL, not a safety assessment): MW ${p.molecularWeight ?? "?"}, AlogP ${p.alogp ?? "?"}, Lipinski Ro5 violations ${p.ro5Violations ?? "?"}, QED ${p.qed ?? "?"}.`,
      });
    }
  }

  for (const assay of benchmark.matchedAssays) {
    for (const row of assay.rows) {
      facts.push({
        ids: [row.source.id],
        kind: "measured",
        layer: "molecular",
        fact: `Same-assay comparison ${assay.assayChemblId} ("${assay.assayDescription}"): ${row.compoundName} pChEMBL ${row.pchembl}.`,
      });
    }
  }

  const candName = benchmark.candidate.compound.name;
  for (const a of benchmark.preclinical ?? []) {
    const where = [a.targetName, a.targetOrganism].filter(Boolean).join(", ");
    const value = a.value == null ? "value not recorded" : `${a.relation ?? ""} ${a.value} ${a.units ?? ""}`.replace(/\s+/g, " ").trim();
    facts.push({
      ids: [a.source.id],
      kind: "measured",
      layer: "preclinical",
      fact:
        `CANDIDATE ${candName} ${a.assayType === "F" ? "functional" : "binding"} assay ${a.assayChemblId} (${a.assayFormat ?? "format not recorded"}` +
        `${where ? `; ${where}` : ""}${a.year ? `; ${a.year}` : ""}) "${a.assayDescription}": ${a.activityType} ${value}` +
        `${a.pchembl != null ? ` (pChEMBL ${a.pchembl})` : ""}. Not comparable to the binding ranking.`,
    });
  }

  for (const w of benchmark.drugWarnings ?? []) {
    facts.push({
      ids: [w.source.id],
      kind: "clinical",
      layer: "safety",
      fact:
        `${w.isCandidate ? "CANDIDATE" : "comparator"} ${w.compoundName}: ChEMBL regulatory drug warning — ${w.warningType}` +
        `${w.warningClass ? `, class ${w.warningClass}` : ""}${w.country ? `, ${w.country}` : ""}${w.year ? `, ${w.year}` : ""}` +
        `${w.description ? `: ${w.description}` : ""}.`,
    });
  }

  for (const t of topTrials(trials, candName)) {
    facts.push({
      ids: [t.source.id],
      kind: "clinical",
      layer: "clinical",
      fact: `${t.nctId} "${t.title}": ${t.phase}, ${t.status}, enrollment ${t.enrollment ?? "?"}, interventions ${t.interventions.join(", ")}; primary outcomes: ${t.primaryOutcomes.join("; ") || "not listed"}; results posted: ${t.hasResults ? "yes" : "no"}.`,
    });
  }
  return facts;
}

/** Phase string ("Phase 2/3", "Early Phase 1") → sortable number. */
const phaseRank = (phase: string) =>
  /early/i.test(phase) ? 0.5 : Math.max(0, ...(phase.match(/\d/g)?.map(Number) ?? []));

/** Trials that mention the candidate first, then by phase (desc), capped so large landscapes don't flood the prompt. */
function topTrials(trials: TrialsResult | undefined, candidate: string): Trial[] {
  const name = candidate.toLowerCase();
  const mentions = (t: Trial) => t.interventions.some((i) => i.toLowerCase().includes(name));
  return [...(trials?.trials ?? [])]
    .sort((a, b) => Number(mentions(b)) - Number(mentions(a)) || phaseRank(b.phase) - phaseRank(a.phase))
    .slice(0, MAX_TRIALS);
}

export async function generateReport(benchmark: BenchmarkResult, trials?: TrialsResult): Promise<EvidenceReport> {
  const facts = buildFacts(benchmark, trials);
  const evidence = facts.map((f) => `[${f.ids.join(", ")}] (${f.kind}; ${f.layer}) ${f.fact}`).join("\n");
  const nTrials = trials?.trials.length ?? 0;
  const nPre = benchmark.preclinical?.length ?? 0;
  const candLower = benchmark.candidate.compound.name.toLowerCase();
  const candTrials = (trials?.trials ?? []).filter((t) => t.interventions.some((i) => i.toLowerCase().includes(candLower)));
  const withResults = (trials?.trials ?? []).filter((t) => t.hasResults).length;
  const warnings = benchmark.drugWarnings;
  const prompt = `Candidate: ${benchmark.candidate.compound.name}
Disease of interest: ${benchmark.query.disease || "not specified"}
Target: ${benchmark.target.name} (${benchmark.target.chemblId})
Clinical trial data: ${trials ? `${nTrials} trials retrieved${nTrials > MAX_TRIALS ? ` (the ${MAX_TRIALS} most relevant are listed)` : ""}; ${candTrials.length} test the candidate itself (${candTrials.filter((t) => t.hasResults).length} with results posted); ${withResults} of ${nTrials} have results posted on ClinicalTrials.gov (outcome data not retrieved here)` : "NOT YET RETRIEVED — say so in the clinical section"}
Preclinical (functional / cell-based) assays: ${nPre ? `${nPre} candidate results listed (a sample, unranked)` : "NONE RETRIEVED — say so in the preclinical section"}
Regulatory drug warnings: ${warnings == null ? "not retrieved" : `${warnings.length} listed${warnings.some((w) => w.isCandidate) ? "" : " (none recorded for the candidate)"}`}

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
  const preclinicalIds = new Set<string>();
  for (const f of facts) {
    for (const id of [...f.ids, ...(f.alsoValid ?? [])]) {
      if (!kindsById.has(id)) kindsById.set(id, new Set());
      kindsById.get(id)!.add(f.kind);
      if (f.layer === "preclinical") preclinicalIds.add(id);
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

  // The preclinical section may only hold claims resting on preclinical (functional / cell-based)
  // evidence; anything else the model put there moves to its own layer.
  const home: Partial<Record<EvidenceKind, EvidenceLayer>> = { measured: "molecular", computed: "safety", clinical: "clinical" };
  const pre = byLayer.get("preclinical");
  const keep: EvidenceReport["sections"][number]["claims"] = [];
  for (const c of pre?.claims ?? []) {
    if (c.sourceIds.some((id) => preclinicalIds.has(id))) {
      keep.push(c);
      continue;
    }
    const layer = home[c.kind];
    if (!layer) continue;
    if (!byLayer.has(layer)) byLayer.set(layer, { layer, summary: "", claims: [] });
    byLayer.get(layer)!.claims.push(c);
  }
  byLayer.set(
    "preclinical",
    preclinicalIds.size && pre
      ? { ...pre, claims: keep }
      : { layer: "preclinical", summary: "No functional, cell-based or in vivo evidence was retrieved yet.", claims: [] },
  );

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
