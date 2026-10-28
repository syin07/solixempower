// "Ask the graph" (docs/KG_PRD.md §6): Claude answers a question from the serialized evidence graph only.
// Every claim cites graph edge/node ids; the server drops citations to ids that are not in the graph.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { GraphEdge, GraphNode, GraphResult } from "@/lib/contracts";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_TRIALS_LISTED = 25;
const MAX_HISTORY = 6;

export interface AskTurn {
  question: string;
  answer: string;
}

export interface AskResult {
  answer: string;
  claims: { text: string; edgeIds: string[] }[];
  /** A node id worth expanding when the graph cannot support the answer */
  suggestedExpand: string | null;
  refusal: boolean;
  /** Citations removed because they named ids not in the graph */
  droppedCitations: number;
}

const AskSchema = z.object({
  answer: z.string(),
  claims: z.array(z.object({ text: z.string(), edgeIds: z.array(z.string()) })),
  suggestedExpand: z.string().nullable(),
  refusal: z.boolean(),
});

const SYSTEM = `You answer questions about ONE drug-repurposing evidence graph. The graph is the only knowledge you may use.

Rules:
- Use only the nodes, edges and hypotheses listed. Every claim must cite one or more ids exactly as listed (edge ids like "e:measured_against:drug:…", node ids like "target:CHEMBL203", or hypothesis ids like "hyp:3"). Never cite an id that is not listed and never state a number that is not listed.
- If the graph cannot support an answer, say so plainly (set refusal to true, claims may be empty) and, when a node looks worth expanding to find out, put its id in suggestedExpand. Do not guess and do not use outside knowledge.
- Never state or imply that a drug works, is safe, or is effective in a disease. Potency in an assay, an Open Targets association and a registered trial are each evidence of a different kind and are never combined into one score.
- "Not found" (absent) edges mean a search on the date shown found nothing; they do not prove that nothing exists.
- Write 3–6 sentences in plain scientific prose. Put the substance in "answer"; "claims" restate the factual statements with their citations.`;

const num = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : null);

function nodeLine(n: GraphNode): string {
  const meta = n.meta ?? {};
  const bits: string[] = [];
  for (const k of ["maxPhase", "n", "phase", "status", "hasResults", "score", "nAncestors", "routes", "generic", "resolution"]) {
    if (meta[k] != null) bits.push(`${k}=${Array.isArray(meta[k]) ? (meta[k] as string[]).join("/") : String(meta[k])}`);
  }
  for (const [k, v] of Object.entries(meta)) if (k.startsWith("ot_") && typeof v === "number") bits.push(`${k.slice(3)}=${v.toFixed(2)}`);
  const flags = [n.isCandidate ? "CANDIDATE" : "", n.isQueryDisease ? "QUERY DISEASE" : ""].filter(Boolean).join(" ");
  return `${n.id} | ${n.type} | ${n.label}${flags ? ` | ${flags}` : ""}${bits.length ? ` | ${bits.join(", ")}` : ""}`;
}

function edgeLine(e: GraphEdge): string {
  const s = num(e.strength);
  const extra: string[] = [];
  const m = e.meta ?? {};
  for (const k of ["n", "min", "max", "actionType", "checkedAt", "query", "nctIds"]) {
    if (m[k] != null) extra.push(`${k}=${Array.isArray(m[k]) ? (m[k] as string[]).join("/") : String(m[k])}`);
  }
  for (const [k, v] of Object.entries(m)) if (k.startsWith("ot_") && typeof v === "number") extra.push(`${k.slice(3)}=${v.toFixed(2)}`);
  return `${e.id} | ${e.type} | ${e.from} → ${e.to} | ${e.kind}${s ? ` | strength ${s}` : ""} | ${e.label}${extra.length ? ` | ${extra.join(", ")}` : ""}`;
}

/** Compact text form of the graph for the prompt. Trials beyond a cap are summarized as a count. */
export function serializeGraph(graph: GraphResult): string {
  const trials = graph.nodes.filter((n) => n.type === "trial");
  const candidate = graph.nodes.find((n) => n.isCandidate)?.id;
  const ownTrials = new Set(graph.edges.filter((e) => e.type === "tested_in" && e.from === candidate).map((e) => e.to));
  const listedTrials = [...trials].sort((a, b) => Number(ownTrials.has(b.id)) - Number(ownTrials.has(a.id))).slice(0, MAX_TRIALS_LISTED);
  const listedTrialIds = new Set(listedTrials.map((t) => t.id));
  const nodes = graph.nodes.filter((n) => n.type !== "trial" && n.type !== "hypothesis").concat(listedTrials);
  const edges = graph.edges.filter((e) => {
    const t = e.type === "tested_in" ? e.to : e.type === "for_disease" ? e.from : null;
    return !t || listedTrialIds.has(t);
  });
  const hyps = graph.hypotheses.map((h) => {
    const ladder = h.ladder.map((r) => `${r.label}: ${r.value} [${r.kind}]`).join("; ");
    return `${h.id} | ${h.template} | ${h.status} | ${h.statement} | path: ${h.pathEdgeIds.join(", ")} | test: ${h.suggestedTest} | ladder: ${ladder}`;
  });
  const omitted = trials.length - listedTrials.length;
  return [
    `Query: candidate "${graph.query.candidate}", disease "${graph.query.disease}". Built ${graph.builtAt}.`,
    `NODES (${nodes.length}${omitted > 0 ? `; ${omitted} further trials not listed` : ""}):`,
    ...nodes.map(nodeLine),
    `EDGES (${edges.length}):`,
    ...edges.map(edgeLine),
    `HYPOTHESES (${hyps.length}):`,
    ...hyps,
  ].join("\n");
}

export async function askGraph(opts: { graph: GraphResult; question: string; history?: AskTurn[] }): Promise<AskResult> {
  const { graph, question } = opts;
  const history = (opts.history ?? []).slice(-MAX_HISTORY);
  const client = new Anthropic();

  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  const context = `GRAPH:\n${serializeGraph(graph)}`;
  history.forEach((t, i) => {
    messages.push({ role: "user", content: i === 0 ? `${context}\n\nQuestion: ${t.question}` : `Question: ${t.question}` });
    messages.push({ role: "assistant", content: t.answer });
  });
  messages.push({ role: "user", content: history.length ? `Question: ${question}` : `${context}\n\nQuestion: ${question}` });

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(AskSchema) },
    system: SYSTEM,
    messages,
  });

  if (response.stop_reason === "refusal") return { answer: "The model declined to answer this question.", claims: [], suggestedExpand: null, refusal: true, droppedCitations: 0 };
  if (!response.parsed_output) throw new Error(`Answer could not be parsed (stop_reason: ${response.stop_reason}).`);
  return validate(response.parsed_output, graph);
}

/** Drop citations to ids not in the graph and claims left with none. */
function validate(out: z.infer<typeof AskSchema>, graph: GraphResult): AskResult {
  const known = new Set<string>([...graph.nodes.map((n) => n.id), ...graph.edges.map((e) => e.id), ...graph.hypotheses.map((h) => h.id)]);
  let dropped = 0;
  const claims = out.claims.flatMap((c) => {
    const ids = [...new Set(c.edgeIds)].filter((id) => {
      const ok = known.has(id);
      if (!ok) dropped++;
      return ok;
    });
    return ids.length ? [{ text: c.text, edgeIds: ids }] : [];
  });
  const removedAll = out.claims.length > 0 && claims.length === 0 && !out.refusal;
  const suggestedExpand = out.suggestedExpand && known.has(out.suggestedExpand) ? out.suggestedExpand : null;
  if (dropped) console.warn(`[ask] dropped ${dropped} citation(s) not in the graph`);
  return {
    answer: removedAll ? `(Some statements were removed because they cited nothing in the graph.) ${out.answer}` : out.answer,
    claims,
    suggestedExpand,
    refusal: out.refusal,
    droppedCitations: dropped,
  };
}
