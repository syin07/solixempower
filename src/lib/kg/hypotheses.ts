// Repurposing hypotheses (docs/KG_PRD.md §5): deterministic path templates over the enriched evidence
// graph. No LLM and no score: a hypothesis is a real path (every pathEdgeId exists in the graph), a gap
// check (ChEMBL indications in the graph, then ClinicalTrials.gov) written back as edges, and an
// evidence ladder whose rows are shown separately and never summed.
//
//   target_hop      candidate —measured_against→ T (benchmark target) —associated_with→ D
//   off_target_hop  candidate —measured_against→ T₂ (secondary target)  —associated_with→ D
//   comparator_hop  candidate —measured_against→ T ←measured_against— comparator —indicated_for / tested_in→ D
//
// One card per disease: target_hop > off_target_hop > comparator_hop; a comparator's precedent still
// shows in the ladder. The query disease gets a card too when a path reaches it (PRD §13: "the gap check
// marks NSCLC as already tested"), and that card is never cut by the cap.
import type {
  BenchmarkResult,
  GraphEdge,
  GraphNode,
  GraphResult,
  Hypothesis,
  HypothesisStatus,
  HypothesisTemplate,
  LadderRow,
  SourceRef,
} from "@/lib/contracts";
import { hasTrialFor as liveHasTrialFor, type TrialCheck } from "@/lib/trials/gapcheck";
import { mapLimit } from "@/lib/trials/index";
import { addEdge, addNode, phaseNumber, registerSource } from "./build";
import { edgeId, nodeId, parseNodeId } from "./ids";

const MAX_HYPOTHESES = 6;
/** ClinicalTrials.gov gap checks per graph (PRD §5: ≤ 8 calls). */
const MAX_TRIAL_CHECKS = 8;
const CHECK_CONCURRENCY = 4;
/** Measurement ids cited on the potency ladder row (the edge's own source first). */
const POTENCY_SOURCE_IDS = 5;

/** Open Targets datatypes in display order; anything else follows alphabetically. */
const DATATYPES: [string, string][] = [
  ["genetic_association", "genetic association"],
  ["somatic_mutation", "somatic mutation"],
  ["genetic_literature", "genetic literature"],
  ["animal_model", "animal model"],
  ["known_drug", "known drug"],
  ["clinical", "clinical"],
  ["affected_pathway", "affected pathway"],
  ["rna_expression", "RNA expression"],
  ["literature", "literature"],
];
const TEMPLATE_RANK: Record<HypothesisTemplate, number> = { target_hop: 0, off_target_hop: 1, comparator_hop: 2, route_hop: 3 };
const STATUS_RANK: Record<HypothesisStatus, number> = { proposed: 0, already_tested: 1, already_indicated: 2 };

export interface HypothesisDeps {
  hasTrialFor: (drugName: string, diseaseName: string) => Promise<TrialCheck>;
}

/** A path from the candidate to a disease, before the gap check. */
interface Candidate {
  template: HypothesisTemplate;
  target: GraphNode;
  disease: GraphNode;
  /** candidate —measured_against→ target */
  potency: GraphEdge;
  /** target —associated_with→ disease (target / off-target hops) */
  association?: GraphEdge;
  /** Same-target drug approved or trialed for the disease, best phase first */
  precedent?: Precedent;
}

interface Precedent {
  drug: GraphNode;
  phase: number;
  /** The comparator's own path to the disease: [indicated_for] or [tested_in, for_disease] */
  edges: GraphEdge[];
  /** comparator —measured_against→ target, when the comparator was measured there */
  potency?: GraphEdge;
}

interface Status {
  status: HypothesisStatus;
  edges: GraphEdge[];
  nctIds: string[];
  indicationPhase?: number;
}

export async function generateHypotheses(
  input: GraphResult,
  benchmark: BenchmarkResult,
  deps: HypothesisDeps = { hasTrialFor: liveHasTrialFor },
): Promise<GraphResult> {
  const graph: GraphResult = {
    ...input,
    nodes: input.nodes.map((n) => ({ ...n, meta: n.meta ? { ...n.meta } : undefined })),
    edges: input.edges.map((e) => ({ ...e, meta: e.meta ? { ...e.meta } : undefined })),
    hypotheses: [],
    sources: [...input.sources],
  };
  const g = index(graph);
  const drug = graph.nodes.find((n) => n.type === "drug" && n.isCandidate);
  if (!drug) return graph;

  // 1. Paths: one candidate per disease, best template wins
  const byDisease = new Map<string, Candidate>();
  const offer = (c: Candidate) => {
    const prev = byDisease.get(c.disease.id);
    if (!prev || TEMPLATE_RANK[c.template] < TEMPLATE_RANK[prev.template]) byDisease.set(c.disease.id, { ...c, precedent: c.precedent ?? prev?.precedent });
    else if (!prev.precedent && c.precedent) prev.precedent = c.precedent;
  };
  const mainTargetId = nodeId("target", benchmark.target.chemblId);
  for (const potency of g.out(drug.id, "measured_against")) {
    const target = g.node(potency.to);
    if (!target) continue;
    const template: HypothesisTemplate = target.id === mainTargetId ? "target_hop" : "off_target_hop";
    for (const association of g.out(target.id, "associated_with")) {
      const disease = g.node(association.to);
      if (disease) offer({ template, target, disease, potency, association, precedent: bestPrecedent(g, drug, target, disease) });
    }
    // comparator_hop: same-target drugs that reach a disease through an indication or a trial
    for (const d of precedentDiseases(g, drug, target)) {
      const precedent = bestPrecedent(g, drug, target, d);
      if (precedent) offer({ template: "comparator_hop", target, disease: d, potency, precedent });
    }
  }
  // A comparator_hop only makes sense where the candidate is absent; drop the ones the graph already
  // answers (candidate indicated) unless it is the query disease, whose card we always want.
  const candidates = [...byDisease.values()].filter(
    (c) => c.template !== "comparator_hop" || c.disease.isQueryDisease || !indicationFor(g, drug, c.disease),
  );

  // 2. Gap check from the graph (indications, trials already retrieved), then ClinicalTrials.gov
  const status = new Map<string, Status>();
  for (const c of candidates) {
    const s = statusFromGraph(g, drug, c.disease);
    if (s) status.set(c.disease.id, s);
  }
  // The query disease is checked first: its card is always shown (PRD §13)
  const unchecked = candidates
    .filter((c) => !status.has(c.disease.id))
    .sort((a, b) => Number(Boolean(b.disease.isQueryDisease)) - Number(Boolean(a.disease.isQueryDisease)) || compareCandidates(a, b));
  // A compound without a preferred name would be searched by its ChEMBL id, which matches nothing: that
  // is not evidence of absence, so no trial search is run and the absent edge says only the indication was checked
  const searchable = !/^CHEMBL\d+$/i.test(drug.label.trim());
  const toCheck = searchable ? unchecked.slice(0, MAX_TRIAL_CHECKS) : unchecked;
  if (unchecked.length > toCheck.length)
    console.log(`[kg/hypotheses] gap-check budget: checking ${toCheck.length} of ${unchecked.length} diseases; the rest are not shown`);
  const checks = await mapLimit(toCheck, CHECK_CONCURRENCY, async (c): Promise<TrialCheck | null> => {
    if (!searchable)
      return {
        nctIds: [],
        trials: [],
        query: `no ClinicalTrials.gov search: ${drug.label} has no drug name to search by`,
        checkedAt: new Date().toISOString(),
        totalCount: 0,
        url: drug.source?.url ?? "https://clinicaltrials.gov/",
        trialSearched: false,
      };
    try {
      return await deps.hasTrialFor(displayName(drug.label), c.disease.label);
    } catch (e) {
      // Without a completed check we cannot call it a gap, so the disease is left out
      console.warn(`[kg/hypotheses] trial check failed for ${c.disease.label}:`, e instanceof Error ? e.message : e);
      return null;
    }
  });
  toCheck.forEach((c, i) => {
    const check = checks[i];
    if (check) status.set(c.disease.id, writeCheck(graph, g, drug, c.disease, check));
  });

  // 3. Cards
  const built = candidates
    .filter((c) => status.has(c.disease.id))
    .map((c) => ({ c, s: status.get(c.disease.id)! }))
    .sort((a, b) => STATUS_RANK[a.s.status] - STATUS_RANK[b.s.status] || compareCandidates(a.c, b.c));
  const query = built.find((x) => x.c.disease.isQueryDisease);
  let kept = built.slice(0, MAX_HYPOTHESES);
  if (query && !kept.includes(query)) kept = [...kept.slice(0, MAX_HYPOTHESES - 1), query];

  graph.hypotheses = kept.map(({ c, s }, i) => toHypothesis(graph, g, benchmark, drug, c, s, `hyp:${i + 1}`));
  assertPaths(graph);
  return graph;
}

// ---------------------------------------------------------------------------------------------
// Graph lookups
// ---------------------------------------------------------------------------------------------

type Index = ReturnType<typeof index>;

function index(graph: GraphResult) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = (from: string, type: string) => graph.edges.filter((e) => e.from === from && e.type === type);
  const into = (to: string, type: string) => graph.edges.filter((e) => e.to === to && e.type === type);
  return { node: (id: string) => nodes.get(id), add: (n: GraphNode) => nodes.set(n.id, n), out, into };
}

/** Drugs other than the candidate that act on or were measured against the target. */
function sameTargetDrugs(g: Index, candidate: GraphNode, target: GraphNode): { drug: GraphNode; potency?: GraphEdge }[] {
  const seen = new Map<string, { drug: GraphNode; potency?: GraphEdge }>();
  for (const e of [...g.into(target.id, "measured_against"), ...g.into(target.id, "mechanism")]) {
    const d = g.node(e.from);
    if (!d || d.id === candidate.id) continue;
    const entry = seen.get(d.id) ?? { drug: d };
    if (e.type === "measured_against") entry.potency = e;
    seen.set(d.id, entry);
  }
  return [...seen.values()];
}

/** Diseases a same-target drug reaches by an indication or a trial. */
function precedentDiseases(g: Index, candidate: GraphNode, target: GraphNode): GraphNode[] {
  const out = new Map<string, GraphNode>();
  for (const { drug } of sameTargetDrugs(g, candidate, target)) {
    for (const e of g.out(drug.id, "indicated_for")) {
      const d = g.node(e.to);
      if (d) out.set(d.id, d);
    }
    for (const t of g.out(drug.id, "tested_in"))
      for (const f of g.out(t.to, "for_disease")) {
        const d = g.node(f.to);
        if (d) out.set(d.id, d);
      }
  }
  return [...out.values()];
}

/** Highest phase of any same-target drug for the disease (indication or trial); approved wins. */
function bestPrecedent(g: Index, candidate: GraphNode, target: GraphNode, disease: GraphNode): Precedent | undefined {
  let best: Precedent | undefined;
  const consider = (p: Precedent) => {
    if (!best || p.phase > best.phase) best = p;
  };
  for (const { drug, potency } of sameTargetDrugs(g, candidate, target)) {
    for (const e of g.out(drug.id, "indicated_for"))
      if (e.to === disease.id) consider({ drug, potency, phase: Number(e.meta?.maxPhaseForInd ?? e.strength ?? 0), edges: [e] });
    for (const t of g.out(drug.id, "tested_in")) {
      const f = g.out(t.to, "for_disease").find((x) => x.to === disease.id);
      if (f) consider({ drug, potency, phase: t.strength ?? 0, edges: [t, f] });
    }
  }
  return best;
}

/**
 * The candidate's indication for this disease: same node, or the same name once spelling variants are
 * folded (ChEMBL "chronic myelogenous leukemia" vs Open Targets "chronic myeloid leukemia" stay two nodes).
 */
function indicationFor(g: Index, drug: GraphNode, disease: GraphNode): GraphEdge | undefined {
  const edges = g.out(drug.id, "indicated_for");
  const name = diseaseName(disease.label);
  return edges.find((e) => e.to === disease.id) ?? edges.find((e) => diseaseName(g.node(e.to)?.label ?? "") === name);
}

const diseaseName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bmyelogenous\b/g, "myeloid")
    .replace(/\bcancer\b/g, "carcinoma")
    .replace(/\btumou?r\b/g, "neoplasm")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Status the graph already answers: an approved indication, a trial in hand, or a clinical-phase indication. */
function statusFromGraph(g: Index, drug: GraphNode, disease: GraphNode): Status | null {
  const indication = indicationFor(g, drug, disease);
  const phase = indication ? Number(indication.meta?.maxPhaseForInd ?? indication.strength ?? 0) : undefined;
  if (indication && phase! >= 4) return { status: "already_indicated", edges: [indication], nctIds: [], indicationPhase: phase };

  const trialEdges: GraphEdge[] = [];
  const nctIds: string[] = [];
  for (const t of g.out(drug.id, "tested_in")) {
    const f = g.out(t.to, "for_disease").find((x) => x.to === disease.id);
    if (!f) continue;
    trialEdges.push(t, f);
    nctIds.push(parseNodeId(t.to)!.key);
  }
  if (nctIds.length) return { status: "already_tested", edges: [...(indication ? [indication] : []), ...trialEdges.slice(0, 6)], nctIds: nctIds.slice(0, 3), indicationPhase: phase };
  // ChEMBL records clinical-phase indications from trials; ask ClinicalTrials.gov for the NCT ids
  return null;
}

/** Writes the ClinicalTrials.gov result into the graph: trial nodes + edges, or an absent edge. */
function writeCheck(graph: GraphResult, g: Index, drug: GraphNode, disease: GraphNode, check: TrialCheck): Status {
  const indication = indicationFor(g, drug, disease);
  const phase = indication ? Number(indication.meta?.maxPhaseForInd ?? indication.strength ?? 0) : undefined;
  if (check.trials.length) {
    const edges: GraphEdge[] = indication ? [indication] : [];
    for (const t of check.trials) {
      const source: SourceRef = { id: `nct:${t.nctId}`, database: "ClinicalTrials.gov", label: t.nctId, url: t.url };
      const trial = addNode(graph, {
        id: nodeId("trial", t.nctId),
        type: "trial",
        label: t.title,
        meta: { nctId: t.nctId, phase: t.phase, status: t.status, hasResults: t.hasResults, foundBy: "gap check" },
        source,
      });
      g.add(trial);
      edges.push(
        addEdge(graph, {
          id: edgeId("tested_in", drug.id, trial.id),
          type: "tested_in",
          from: drug.id,
          to: trial.id,
          kind: "clinical",
          strength: phaseNumber(t.phase),
          label: `${t.phase || "phase n/a"} · ${t.status}`,
          meta: { phase: t.phase, status: t.status, hasResults: t.hasResults },
          source,
        }),
        addEdge(graph, {
          id: edgeId("for_disease", trial.id, disease.id),
          type: "for_disease",
          from: trial.id,
          to: disease.id,
          kind: "clinical",
          label: "trial for disease",
          meta: { query: check.query },
          source,
        }),
      );
    }
    return { status: "already_tested", edges, nctIds: check.nctIds, indicationPhase: phase };
  }
  // A clinical-phase ChEMBL indication without a findable trial is still a record of clinical use
  if (indication) return { status: "already_indicated", edges: [indication], nctIds: [], indicationPhase: phase };

  const day = check.checkedAt.slice(0, 10);
  const searched = check.trialSearched !== false;
  const absent = addEdge(graph, {
    id: edgeId("absent", drug.id, disease.id),
    type: "absent",
    from: drug.id,
    to: disease.id,
    kind: "absent",
    label: searched
      ? `Not found: no ChEMBL indication and no interventional trial (searched ${day})`
      : `Not found: no ChEMBL indication (${day}); trials not searched — no drug name`,
    meta: { checked: searched ? ["indication", "trial"] : ["indication"], checkedAt: check.checkedAt, query: check.query },
    source: {
      id: `check:${parseNodeId(drug.id)!.key}:${parseNodeId(disease.id)!.key}`,
      database: searched ? "ClinicalTrials.gov" : "ChEMBL",
      label: `Not found on ${day}: ${check.query}; no ChEMBL drug_indication row`,
      url: check.url,
    },
  });
  return { status: "proposed", edges: [absent], nctIds: [] };
}

// ---------------------------------------------------------------------------------------------
// Ordering (lexicographic, never a score): genetic/somatic evidence, then OT clinical, then potency
// ---------------------------------------------------------------------------------------------

const sub = (e: GraphEdge | undefined, key: string) => (typeof e?.meta?.[`ot_${key}`] === "number" ? (e.meta[`ot_${key}`] as number) : 0);
/** Same threshold as the Open Targets row filter (PRD §5). */
const hasGenetic = (c: Candidate) => sub(c.association, "genetic_association") >= 0.3 || sub(c.association, "somatic_mutation") >= 0.3;

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    Number(hasGenetic(b)) - Number(hasGenetic(a)) ||
    sub(b.association, "clinical") - sub(a.association, "clinical") ||
    (b.potency.strength ?? -Infinity) - (a.potency.strength ?? -Infinity) ||
    TEMPLATE_RANK[a.template] - TEMPLATE_RANK[b.template] ||
    a.disease.label.localeCompare(b.disease.label)
  );
}

// ---------------------------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------------------------

function toHypothesis(
  graph: GraphResult,
  g: Index,
  benchmark: BenchmarkResult,
  drug: GraphNode,
  c: Candidate,
  s: Status,
  id: string,
): Hypothesis {
  const name = displayName(drug.label);
  const via = c.target.label;
  const prec = c.precedent;
  const precText = prec ? `${displayName(prec.drug.label)} (${phaseText(prec.phase)})` : "";

  const path: GraphEdge[] = [c.potency];
  if (c.association) path.push(c.association);
  if (c.template === "comparator_hop" && prec) path.push(...(prec.potency ? [prec.potency] : []), ...prec.edges);
  path.push(...s.edges);
  const pathEdgeIds = unique(path.map((e) => e.id));

  let statement: string;
  if (s.status === "proposed")
    statement =
      c.template === "comparator_hop"
        ? `${name} could be repurposed for ${c.disease.label}: same-target drug ${precText} reaches it via ${via}`
        : `${name} could be repurposed for ${c.disease.label} via ${via}`;
  else if (s.status === "already_tested")
    statement = `${name} for ${c.disease.label} via ${via} was already tested${s.nctIds.length ? ` (${s.nctIds.join(", ")})` : ""}`;
  else statement = `${name} is already indicated for ${c.disease.label} (${phaseText(s.indicationPhase ?? 4)} in ChEMBL)`;
  if (c.disease.isQueryDisease) statement += " — the queried disease";

  return {
    id,
    template: c.template,
    status: s.status,
    statement,
    drugId: drug.id,
    targetId: c.target.id,
    diseaseId: c.disease.id,
    pathEdgeIds,
    ladder: ladder(graph, g, benchmark, drug, c, s),
    suggestedTest: suggestedTest(graph, benchmark, drug, c, s),
    sourceIds: unique(path.map((e) => e.source.id)),
  };
}

/** Fixed order: potency · target–disease sub-scores · clinical precedent · safety · route · gap check. */
function ladder(graph: GraphResult, g: Index, benchmark: BenchmarkResult, drug: GraphNode, c: Candidate, s: Status): LadderRow[] {
  const rows: LadderRow[] = [];
  const p = c.potency;
  const alsoValid = Array.isArray(p.meta?.alsoValid) ? (p.meta.alsoValid as string[]) : [];
  rows.push({
    kind: "measured",
    label: `Measured potency on ${c.target.label}`,
    value:
      p.strength != null
        ? `median pChEMBL ${fmt(p.strength)} (n=${p.meta?.n}, ${fmt(Number(p.meta?.min))}–${fmt(Number(p.meta?.max))})`
        : `${p.meta?.n ?? "?"} measurement(s), not ranked against comparators`,
    sourceIds: [p.source.id, ...alsoValid].slice(0, POTENCY_SOURCE_IDS),
  });

  if (c.association) {
    const scores = Object.entries(c.association.meta ?? {})
      .filter(([k, v]) => k.startsWith("ot_") && typeof v === "number")
      .map(([k, v]) => [k.slice(3), v as number] as const);
    const order = (k: string) => {
      const i = DATATYPES.findIndex(([id]) => id === k);
      return i < 0 ? DATATYPES.length : i;
    };
    scores.sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
    for (const [k, v] of scores)
      rows.push({
        kind: "computed",
        label: `Open Targets ${c.target.meta?.symbol ?? c.target.label}–${c.disease.label}: ${DATATYPES.find(([id]) => id === k)?.[1] ?? k.replace(/_/g, " ")}`,
        value: v < 0.01 ? "< 0.01" : v.toFixed(2),
        sourceIds: [c.association.source.id],
      });
  }

  const prec = c.precedent;
  rows.push({
    kind: "clinical",
    label: `Clinical precedent: highest phase of a same-target drug for ${c.disease.label}`,
    value: prec ? `${phaseText(prec.phase)} — ${displayName(prec.drug.label)}` : "none in the retrieved records",
    sourceIds: prec ? unique(prec.edges.map((e) => e.source.id)) : [],
  });

  const warnings = g.out(drug.id, "has_warning");
  rows.push({
    kind: "clinical",
    label: `Safety flags on ${displayName(drug.label)}`,
    value: warnings.length
      ? unique(warnings.map((w) => g.node(w.to)?.label ?? w.label)).join("; ")
      : benchmark.drugWarnings
        ? "no ChEMBL drug warning recorded"
        : "drug warnings not retrieved",
    sourceIds: unique(warnings.map((w) => w.source.id)),
  });

  const routes = g.out(drug.id, "administered_by");
  rows.push({
    kind: "clinical",
    label: `Approved route(s) of ${displayName(drug.label)}`,
    value: routes.length
      ? routes.map((r) => g.node(r.to)?.label ?? r.to).join(", ")
      : drug.meta?.maxPhase === 4
        ? "no route flag recorded in ChEMBL"
        : "no approved route (not approved)",
    sourceIds: unique(routes.map((r) => r.source.id)),
  });

  if (s.status === "proposed") {
    const absent = s.edges[0];
    rows.push({ kind: "absent", label: "Gap check", value: absent.label, sourceIds: [absent.source.id] });
  } else if (s.status === "already_tested") {
    rows.push({
      kind: "clinical",
      label: "Gap check",
      value: `interventional trial(s) found: ${s.nctIds.join(", ")}`,
      sourceIds: s.nctIds.map((n) => `nct:${n}`),
    });
  } else {
    rows.push({ kind: "clinical", label: "Gap check", value: `ChEMBL indication, ${phaseText(s.indicationPhase ?? 4)}`, sourceIds: [s.edges[0].source.id] });
  }
  // Only cite what the graph carries (e.g. measurement ids the builder did not register)
  const known = new Set(graph.sources.map((x) => x.id));
  return rows.map((r) => ({ ...r, sourceIds: r.sourceIds.filter((id) => known.has(id)) }));
}

/** PRD §5 deterministic strings. */
function suggestedTest(graph: GraphResult, benchmark: BenchmarkResult, drug: GraphNode, c: Candidate, s: Status): string {
  if (s.status === "already_tested")
    return s.nctIds.length
      ? `Read the posted trial(s) ${s.nctIds.join(", ")} before proposing a new study.`
      : `Read the ChEMBL indication record (${phaseText(s.indicationPhase ?? 0)}) and its trial references before proposing a new study.`;
  if (s.status === "already_indicated")
    return `Already indicated (${phaseText(s.indicationPhase ?? 4)}); compare against the approved label rather than propose a new indication.`;

  const candidateKey = parseNodeId(drug.id)!.key;
  const prec = c.precedent;
  if (prec) {
    const compKey = parseNodeId(prec.drug.id)!.key;
    for (const a of benchmark.matchedAssays) {
      const mine = a.rows.filter((r) => r.compoundChemblId === candidateKey);
      const theirs = a.rows.filter((r) => r.compoundChemblId === compKey);
      if (!mine.length || !theirs.length) continue;
      for (const r of [...mine, ...theirs]) registerSource(graph, r.source);
      return (
        `Head-to-head in ChEMBL assay ${a.assayChemblId} (same assay as ${displayName(prec.drug.label)}): ` +
        `candidate median pChEMBL ${fmt(median(mine.map((r) => r.pchembl)))} vs ${fmt(median(theirs.map((r) => r.pchembl)))}.`
      );
    }
  }
  // Nearest = on this target, else in a cell line; a result on a different protein target is not "near"
  const proteins = new Set(graph.nodes.filter((n) => n.type === "target").map((n) => n.label));
  const cell = (benchmark.preclinical ?? []).filter((p) => /cell/i.test(p.assayFormat ?? ""));
  const nearest = cell.find((p) => p.targetName === c.target.label) ?? cell.find((p) => p.targetName && !proteins.has(p.targetName));
  if (nearest) {
    registerSource(graph, nearest.source);
    const readout = [nearest.activityType, nearest.relation && nearest.relation !== "=" ? nearest.relation : "", nearest.value != null ? `${nearest.value}${nearest.units ? ` ${nearest.units}` : ""}` : ""]
      .filter(Boolean)
      .join(" ");
    return `Run a ${c.disease.label}-relevant cell model; nearest existing measurement: ${nearest.targetName ?? "cell-based assay"} / ${readout} (${nearest.assayChemblId}).`;
  }
  return `Confirm ${c.target.label} engagement in a ${c.disease.label}-relevant cell model before any in vivo work.`;
}

/** Every path edge and cited source must exist; a violation is a bug, not a data gap. */
function assertPaths(graph: GraphResult): void {
  const edges = new Set(graph.edges.map((e) => e.id));
  const sources = new Set(graph.sources.map((s) => s.id));
  for (const h of graph.hypotheses) {
    const missing = h.pathEdgeIds.filter((id) => !edges.has(id));
    if (missing.length) throw new Error(`${h.id}: path edges not in graph: ${missing.join(", ")}`);
    const unknown = [...h.sourceIds, ...h.ladder.flatMap((r) => r.sourceIds)].filter((id) => !sources.has(id));
    if (unknown.length) throw new Error(`${h.id}: sources not in graph: ${unknown.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------------------------

const unique = <T,>(xs: T[]) => [...new Set(xs)];
const fmt = (n: number) => (Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "")) : "?");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** 4 → "approved", 2.5 → "phase 2/3", 0 → "phase n/a". */
function phaseText(phase: number): string {
  if (phase >= 4) return "approved";
  if (phase <= 0) return "phase n/a";
  if (phase < 1) return "early phase 1";
  return Number.isInteger(phase) ? `phase ${phase}` : `phase ${Math.floor(phase)}/${Math.ceil(phase)}`;
}
/** "POZIOTINIB" → "Poziotinib"; mixed-case names and ChEMBL ids are kept. */
const displayName = (label: string) =>
  label === label.toUpperCase() && !/^CHEMBL\d+$/.test(label) ? label.charAt(0) + label.slice(1).toLowerCase() : label;
