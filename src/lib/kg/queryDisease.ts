// "Is there an opening for this drug in the disease I typed?" — the disease-directed answer card.
//
// Medhansh's templates (hypotheses.ts) are target-driven: they fan out from the drug's targets to
// whatever diseases pass the §5 filters. This module answers the user's actual question directly:
//   1. drug-side: for every target the candidate was measured on, look up the Open Targets association
//      with the query disease at ANY score (no filter) — a weak link is still an answer;
//   2. disease-side: the disease's top targets intersected with everything the candidate was ever
//      measured on, so a target the benchmark did not pick (e.g. a 6th most-measured one) still counts;
//   3. the same gap check as the other cards (ChEMBL indication, trials in the graph, ClinicalTrials.gov),
//      written back as edges so the UI treats it exactly like the others;
//   4. one card, pinned first. When no target-level path exists it says so and what was checked
//      (PRD §9: "not found", never "none exists").
import type { BenchmarkResult, GraphEdge, GraphNode, GraphResult, Hypothesis, LadderRow, SourceRef } from "@/lib/contracts";
import { getTarget, selectTarget, type RawTarget } from "@/lib/chembl/api";
import { chemblUrl } from "@/lib/chembl/client";
import { hasTrialFor, type TrialCheck } from "@/lib/trials/gapcheck";
import { addEdge, addNode, phaseNumber, QUERY_DISEASE_ID, registerSource } from "./build";
import { addDiseaseAssociation } from "./enrich";
import { edgeId, nodeId, parseNodeId } from "./ids";
import { diseaseTargets, mapUniprotToEnsembl, pairAssociations, type DiseaseAssociation } from "./opentargets";

const QUERY_CARD_ID = "hyp:query";
const MAX_NEW_TARGETS = 5;
const DISEASE_TARGETS = 25;
const POTENCY_SOURCE_IDS = 5;
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

const warn = (what: string, e: unknown) => console.warn(`[kg/query-disease] ${what}:`, e instanceof Error ? e.message : e);
const unique = <T,>(xs: T[]) => [...new Set(xs)];
const fmt = (n: number) => (Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "")) : "?");
const displayName = (label: string) =>
  label === label.toUpperCase() && !/^CHEMBL\d+$/.test(label) ? label.charAt(0) + label.slice(1).toLowerCase() : label;
function phaseText(phase: number): string {
  if (phase >= 4) return "approved";
  if (phase <= 0) return "phase n/a";
  if (phase < 1) return "early phase 1";
  return Number.isInteger(phase) ? `phase ${phase}` : `phase ${Math.floor(phase)}/${Math.ceil(phase)}`;
}

interface Status {
  status: "proposed" | "already_indicated" | "already_tested";
  edges: GraphEdge[];
  nctIds: string[];
  indicationPhase?: number;
  /** What the gap check searched, for the no-path card */
  note: string;
}

/**
 * Adds the direct drug→(targets)→query-disease evidence and the pinned "query_disease" card.
 * Drops any other hypothesis for the query disease (the engine's generic one). Never throws on a
 * failed lookup: the card then says what could not be checked.
 */
export async function addQueryDiseaseAnswer(input: GraphResult, benchmark: BenchmarkResult): Promise<GraphResult> {
  const graph: GraphResult = {
    ...input,
    nodes: input.nodes.map((n) => ({ ...n, meta: n.meta ? { ...n.meta } : undefined })),
    edges: input.edges.map((e) => ({ ...e, meta: e.meta ? { ...e.meta } : undefined })),
    hypotheses: [...input.hypotheses],
    sources: [...input.sources],
  };
  const drug = graph.nodes.find((n) => n.type === "drug" && n.isCandidate);
  const disease = graph.nodes.find((n) => n.type === "disease" && n.isQueryDisease);
  if (!drug || !disease || !benchmark.query.disease.trim()) return graph;
  const name = displayName(drug.label);

  if (disease.id === QUERY_DISEASE_ID) {
    graph.hypotheses = [
      card({
        drug,
        disease,
        status: "no_path",
        statement: `"${disease.label}" could not be resolved to a disease in Open Targets, so no target-level path from ${name} could be checked`,
        pathEdgeIds: [],
        ladder: [{ kind: "absent", label: "Disease resolution", value: "no Open Targets match for the disease name — try another spelling or the EFO/MONDO name", sourceIds: [] }],
        suggestedTest: "Rephrase the disease (e.g. the EFO or MONDO preferred name) and rebuild the graph.",
        sourceIds: [],
      }),
      ...graph.hypotheses.filter((h) => h.diseaseId !== disease.id),
    ];
    return graph;
  }

  const queryKey = parseNodeId(disease.id)!.key;
  const altIds = Array.isArray(disease.meta?.altIds) ? (disease.meta!.altIds as string[]) : [];
  const efoIds = unique([queryKey, ...altIds]);
  const out = (from: string, type: string) => graph.edges.filter((e) => e.from === from && e.type === type);
  const node = (id: string) => graph.nodes.find((n) => n.id === id);
  const candidateKey = parseNodeId(drug.id)!.key;
  const notes: string[] = [];

  // 1. Drug-side: every measured target × the query disease, at any score
  const measuredTargets = out(drug.id, "measured_against").map((e) => node(e.to)).filter((t): t is GraphNode => Boolean(t));
  let checkedTargets = 0;
  try {
    const unmapped = measuredTargets.filter((t) => !t.meta?.ensemblId);
    if (unmapped.length) {
      const raws = await Promise.all(unmapped.map((t) => getTarget(parseNodeId(t.id)!.key).catch(() => null)));
      const acc = raws.map((r) => r?.target_components?.[0]?.accession ?? null);
      const mapping = await mapUniprotToEnsembl(acc.filter((a): a is string => Boolean(a)));
      unmapped.forEach((t, i) => {
        const m = acc[i] ? mapping.get(acc[i]!) : undefined;
        t.meta = { ...t.meta, uniprot: acc[i], ensemblId: m?.ensemblId ?? null, symbol: m?.symbol ?? null };
      });
    }
    await Promise.all(
      measuredTargets.map(async (t) => {
        const ensemblId = typeof t.meta?.ensemblId === "string" ? t.meta.ensemblId : null;
        if (!ensemblId) return;
        checkedTargets++;
        const { symbol, rows } = await pairAssociations(ensemblId, efoIds);
        for (const r of rows) markDirect(graph, addAssociation(graph, t, { ensemblId, symbol: symbol || String(t.meta?.symbol ?? t.label) }, r, disease));
      }),
    );
  } catch (e) {
    warn("drug-side pair lookup failed", e);
    notes.push("drug-side Open Targets lookup failed");
  }

  // 2. Disease-side: the disease's top targets ∩ everything the candidate was measured on
  let diseaseSideChecked = 0;
  try {
    const [top, selection] = await Promise.all([diseaseTargets(queryKey, DISEASE_TARGETS), selectTarget(candidateKey)]);
    diseaseSideChecked = top.length;
    const byAccession = new Map<string, { target: RawTarget; n: number }>();
    for (const r of selection.ranked) {
      const acc = r.target.target_components?.[0]?.accession;
      if (acc && r.n > 0) byAccession.set(acc, r);
    }
    let added = 0;
    for (const t of top) {
      if (!t.uniprot || added >= MAX_NEW_TARGETS) continue;
      const hit = byAccession.get(t.uniprot);
      if (!hit) continue;
      const id = nodeId("target", hit.target.target_chembl_id);
      const targetNode = addNode(graph, {
        id,
        type: "target",
        label: hit.target.pref_name,
        meta: { chemblId: hit.target.target_chembl_id, organism: hit.target.organism, uniprot: t.uniprot, ensemblId: t.ensemblId, symbol: t.symbol, foundBy: "disease side" },
        source: { id: `chembl-target:${hit.target.target_chembl_id}`, database: "ChEMBL", label: `${hit.target.pref_name} (${hit.target.target_chembl_id})`, url: chemblUrl.target(hit.target.target_chembl_id) },
      });
      targetNode.meta = { ...targetNode.meta, ensemblId: t.ensemblId, symbol: t.symbol, uniprot: t.uniprot };
      if (!out(drug.id, "measured_against").some((e) => e.to === id)) {
        added++;
        addEdge(graph, {
          id: edgeId("measured_against", drug.id, id),
          type: "measured_against",
          from: drug.id,
          to: id,
          kind: "measured",
          label: `${hit.n} measurement${hit.n === 1 ? "" : "s"} (not ranked)`,
          meta: { n: hit.n, ranked: false },
          source: drug.source!,
        });
      }
      const row: DiseaseAssociation = {
        efoId: queryKey,
        name: disease.label,
        score: t.score,
        datatypeScores: t.datatypeScores,
        nAncestors: Number(disease.meta?.nAncestors ?? 0),
        ancestors: [],
        therapeuticAreas: Array.isArray(disease.meta?.therapeuticAreas) ? (disease.meta!.therapeuticAreas as string[]) : [],
      };
      markDirect(graph, addAssociation(graph, targetNode, { ensemblId: t.ensemblId, symbol: t.symbol }, row, disease));
    }
  } catch (e) {
    warn("disease-side lookup failed", e);
    notes.push("disease-side Open Targets lookup failed");
  }

  // 3. The path: every measured target with an association edge to the query disease, best by score
  const paths = out(drug.id, "measured_against")
    .flatMap((potency) => {
      const t = node(potency.to);
      const association = t && out(t.id, "associated_with").find((e) => e.to === disease.id);
      return t && association ? [{ target: t, potency, association }] : [];
    })
    .sort((a, b) => (b.association.strength ?? 0) - (a.association.strength ?? 0));
  const best = paths[0];

  // 4. Gap check, same conventions as the other cards
  const s = await gapCheck(graph, drug, disease);
  const pathEdges: GraphEdge[] = [...paths.flatMap((p) => [p.potency, p.association]), ...s.edges];
  const ladder = buildLadder(graph, drug, disease, paths, best, s);
  const known = new Set(graph.sources.map((x) => x.id));
  const cleaned = ladder.map((r) => ({ ...r, sourceIds: r.sourceIds.filter((id) => known.has(id)) }));

  let statement: string;
  let status: Hypothesis["status"];
  let suggestedTest: string;
  const weak = Boolean(best) && (best!.association.strength ?? 0) < 0.3;
  const via = best ? `${best.target.label} (${weak ? "weak link, " : ""}Open Targets ${fmt(best.association.strength ?? 0)})` : "";
  if (!best) {
    status = "no_path";
    statement = `No target-level path from ${name} to ${disease.label} in ChEMBL + Open Targets (checked ${checkedTargets} measured target${checkedTargets === 1 ? "" : "s"} and the disease's top ${diseaseSideChecked} targets)${notes.length ? ` — ${notes.join("; ")}` : ""}`;
    suggestedTest =
      s.status === "already_tested"
        ? `Trials exist (${s.nctIds.join(", ")}) without a measured target link in ChEMBL: read them for the proposed mechanism before any new study.`
        : "No mechanistic rationale in the retrieved evidence. Expand the disease node to see its top targets; a measured link to one of them would be the first experiment.";
  } else if (s.status === "proposed") {
    status = "proposed";
    statement = `${name} reaches ${disease.label} via ${via}; no indication or trial found — ${weak ? "a weak but open repurposing question" : "an open repurposing question"}`;
    suggestedTest = `Confirm ${best.target.label} engagement in a ${disease.label}-relevant cell model (Open Targets association ${fmt(best.association.strength ?? 0)} is computed, not measured) before any in vivo work.`;
  } else if (s.status === "already_tested") {
    status = "already_tested";
    statement = `${name} for ${disease.label} via ${via} was already tested${s.nctIds.length ? ` (${s.nctIds.join(", ")})` : ""}`;
    suggestedTest = s.nctIds.length
      ? `Read the posted trial(s) ${s.nctIds.join(", ")} before proposing a new study.`
      : `Read the ChEMBL indication record (${phaseText(s.indicationPhase ?? 0)}) and its trial references before proposing a new study.`;
  } else {
    status = "already_indicated";
    statement = `${name} is already indicated for ${disease.label} (${phaseText(s.indicationPhase ?? 4)} in ChEMBL); path via ${via}`;
    suggestedTest = `Already indicated (${phaseText(s.indicationPhase ?? 4)}); compare against the approved label rather than propose a new indication.`;
  }

  const queryCard = card({
    drug,
    disease,
    status,
    statement,
    targetId: best?.target.id ?? "",
    pathEdgeIds: unique(pathEdges.map((e) => e.id)),
    ladder: cleaned,
    suggestedTest,
    sourceIds: unique(pathEdges.map((e) => e.source.id)).filter((id) => known.has(id)),
  });
  graph.hypotheses = [queryCard, ...graph.hypotheses.filter((h) => h.diseaseId !== disease.id && h.id !== QUERY_CARD_ID)];
  graph.builtAt = new Date().toISOString();
  return graph;
}

function card(x: {
  drug: GraphNode;
  disease: GraphNode;
  status: Hypothesis["status"];
  statement: string;
  targetId?: string;
  pathEdgeIds: string[];
  ladder: LadderRow[];
  suggestedTest: string;
  sourceIds: string[];
}): Hypothesis {
  return {
    id: QUERY_CARD_ID,
    template: "query_disease",
    status: x.status,
    statement: x.statement,
    drugId: x.drug.id,
    targetId: x.targetId ?? "",
    diseaseId: x.disease.id,
    pathEdgeIds: x.pathEdgeIds,
    ladder: x.ladder,
    suggestedTest: x.suggestedTest,
    sourceIds: x.sourceIds,
  };
}

/** addDiseaseAssociation, but always onto the query node (it matches by id, altIds or name). */
function addAssociation(graph: GraphResult, target: GraphNode, mapped: { ensemblId: string; symbol: string }, r: DiseaseAssociation, disease: GraphNode): GraphEdge {
  const d = addDiseaseAssociation(graph, target, mapped, r);
  const edge = graph.edges.find((e) => e.id === edgeId("associated_with", target.id, d.id))!;
  if (d.id !== disease.id) {
    // The row's id was neither the node's id nor an altId: remember it so later lookups merge
    disease.meta = { ...disease.meta, altIds: unique([...(Array.isArray(disease.meta?.altIds) ? (disease.meta!.altIds as string[]) : []), r.efoId]) };
  }
  return edge;
}

const markDirect = (graph: GraphResult, edge: GraphEdge) => {
  edge.meta = { ...edge.meta, direct: true };
  void graph;
};

/** Indication → trials in the graph → ClinicalTrials.gov → absent edge. Mirrors hypotheses.ts so the UI treats both alike. */
async function gapCheck(graph: GraphResult, drug: GraphNode, disease: GraphNode): Promise<Status> {
  const out = (from: string, type: string) => graph.edges.filter((e) => e.from === from && e.type === type);
  const indication = out(drug.id, "indicated_for").find((e) => e.to === disease.id);
  const phase = indication ? Number(indication.meta?.maxPhaseForInd ?? indication.strength ?? 0) : undefined;
  if (indication && phase! >= 4) return { status: "already_indicated", edges: [indication], nctIds: [], indicationPhase: phase, note: "ChEMBL indication" };

  const trialEdges: GraphEdge[] = [];
  const nctIds: string[] = [];
  for (const t of out(drug.id, "tested_in")) {
    const f = out(t.to, "for_disease").find((x) => x.to === disease.id);
    if (!f) continue;
    trialEdges.push(t, f);
    nctIds.push(parseNodeId(t.to)!.key);
  }
  if (nctIds.length) return { status: "already_tested", edges: [...(indication ? [indication] : []), ...trialEdges.slice(0, 6)], nctIds: nctIds.slice(0, 3), indicationPhase: phase, note: "trials in graph" };

  const searchable = !/^CHEMBL\d+$/i.test(drug.label.trim());
  let check: TrialCheck;
  try {
    check = searchable
      ? await hasTrialFor(displayName(drug.label), disease.label)
      : { nctIds: [], trials: [], query: `no ClinicalTrials.gov search: ${drug.label} has no drug name to search by`, checkedAt: new Date().toISOString(), totalCount: 0, url: drug.source?.url ?? "https://clinicaltrials.gov/", trialSearched: false };
  } catch (e) {
    warn("ClinicalTrials.gov check failed", e);
    check = { nctIds: [], trials: [], query: `ClinicalTrials.gov search failed for ${drug.label} × ${disease.label}`, checkedAt: new Date().toISOString(), totalCount: 0, url: "https://clinicaltrials.gov/", trialSearched: false };
  }
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
      edges.push(
        addEdge(graph, { id: edgeId("tested_in", drug.id, trial.id), type: "tested_in", from: drug.id, to: trial.id, kind: "clinical", strength: phaseNumber(t.phase), label: `${t.phase || "phase n/a"} · ${t.status}`, meta: { phase: t.phase, status: t.status, hasResults: t.hasResults }, source }),
        addEdge(graph, { id: edgeId("for_disease", trial.id, disease.id), type: "for_disease", from: trial.id, to: disease.id, kind: "clinical", label: "trial for disease", meta: { query: check.query }, source }),
      );
    }
    return { status: "already_tested", edges, nctIds: check.nctIds, indicationPhase: phase, note: check.query };
  }
  if (indication) return { status: "already_indicated", edges: [indication], nctIds: [], indicationPhase: phase, note: "ChEMBL indication" };

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
      : `Not found: no ChEMBL indication (${day}); trials not searched — ${check.query}`,
    meta: { checked: searched ? ["indication", "trial"] : ["indication"], checkedAt: check.checkedAt, query: check.query },
    source: {
      id: `check:${parseNodeId(drug.id)!.key}:${parseNodeId(disease.id)!.key}`,
      database: searched ? "ClinicalTrials.gov" : "ChEMBL",
      label: `Not found on ${day}: ${check.query}; no ChEMBL drug_indication row`,
      url: check.url,
    },
  });
  registerSource(graph, absent.source);
  return { status: "proposed", edges: [absent], nctIds: [], note: check.query };
}

function buildLadder(
  graph: GraphResult,
  drug: GraphNode,
  disease: GraphNode,
  paths: { target: GraphNode; potency: GraphEdge; association: GraphEdge }[],
  best: { target: GraphNode; potency: GraphEdge; association: GraphEdge } | undefined,
  s: Status,
): LadderRow[] {
  const rows: LadderRow[] = [];
  const out = (from: string, type: string) => graph.edges.filter((e) => e.from === from && e.type === type);
  const node = (id: string) => graph.nodes.find((n) => n.id === id);

  for (const p of paths) {
    const alsoValid = Array.isArray(p.potency.meta?.alsoValid) ? (p.potency.meta.alsoValid as string[]) : [];
    rows.push({
      kind: "measured",
      label: `Measured potency on ${p.target.label}`,
      value:
        p.potency.strength != null
          ? `median pChEMBL ${fmt(p.potency.strength)} (n=${p.potency.meta?.n}, ${fmt(Number(p.potency.meta?.min))}–${fmt(Number(p.potency.meta?.max))})`
          : `${p.potency.meta?.n ?? "?"} measurement(s), not ranked against comparators`,
      sourceIds: [p.potency.source.id, ...alsoValid].slice(0, POTENCY_SOURCE_IDS),
    });
  }
  if (!paths.length) {
    const measured = out(drug.id, "measured_against").map((e) => node(e.to)?.label).filter(Boolean);
    rows.push({ kind: "measured", label: `Measured targets of ${displayName(drug.label)}`, value: measured.length ? `${measured.join(", ")} — none linked to ${disease.label} in Open Targets` : "none retrieved", sourceIds: [] });
  }

  if (best) {
    const scores = Object.entries(best.association.meta ?? {})
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
        label: `Open Targets ${best.target.meta?.symbol ?? best.target.label}–${disease.label}: ${DATATYPES.find(([id]) => id === k)?.[1] ?? k.replace(/_/g, " ")}`,
        value: v < 0.01 ? "< 0.01" : v.toFixed(2),
        sourceIds: [best.association.source.id],
      });
  }

  // Clinical precedent: highest-phase same-target drug indicated for the disease
  let precedent: { drug: GraphNode; phase: number; edge: GraphEdge } | undefined;
  for (const p of paths) {
    for (const e of graph.edges.filter((e) => e.type === "measured_against" && e.to === p.target.id && e.from !== drug.id)) {
      const ind = out(e.from, "indicated_for").find((x) => x.to === disease.id);
      if (!ind) continue;
      const phase = Number(ind.meta?.maxPhaseForInd ?? ind.strength ?? 0);
      const d = node(e.from);
      if (d && (!precedent || phase > precedent.phase)) precedent = { drug: d, phase, edge: ind };
    }
  }
  rows.push({
    kind: "clinical",
    label: `Clinical precedent: highest phase of a same-target drug for ${disease.label}`,
    value: precedent ? `${phaseText(precedent.phase)} — ${displayName(precedent.drug.label)}` : "none in the retrieved records",
    sourceIds: precedent ? [precedent.edge.source.id] : [],
  });

  if (s.status === "proposed") rows.push({ kind: "absent", label: "Gap check", value: s.edges[0].label, sourceIds: [s.edges[0].source.id] });
  else if (s.status === "already_tested")
    rows.push({ kind: "clinical", label: "Gap check", value: `interventional trial(s) found: ${s.nctIds.join(", ")}`, sourceIds: s.nctIds.map((n) => `nct:${n}`) });
  else rows.push({ kind: "clinical", label: "Gap check", value: `ChEMBL indication, ${phaseText(s.indicationPhase ?? 4)}`, sourceIds: [s.edges[0].source.id] });
  return rows;
}
