// Pure builder for the evidence graph (docs/KG_PRD.md §4): turns the already-retrieved benchmark and
// trials payloads into typed nodes and edges. No network. Every edge carries the SourceRef of the
// record it came from; S3 (enrich.ts) and hypotheses.ts extend the result with addNode/addEdge.
import type { BenchmarkResult, GraphEdge, GraphNode, GraphResult, SourceRef, TrialsResult } from "@/lib/contracts";
import { edgeId, nodeId } from "./ids";

export const QUERY_DISEASE_ID = "disease:query";

/** Adds a node unless one with the same id exists; registers its source. Returns the stored node. */
export function addNode(graph: GraphResult, node: GraphNode): GraphNode {
  const existing = graph.nodes.find((n) => n.id === node.id);
  if (existing) return existing;
  graph.nodes.push(node);
  if (node.source) registerSource(graph, node.source);
  return node;
}

/** Adds an edge unless one with the same id exists. Throws if the edge has no source (PRD §9). */
export function addEdge(graph: GraphResult, edge: GraphEdge): GraphEdge {
  if (!edge.source || !edge.source.id) throw new Error(`Edge ${edge.id} has no source — every edge must be a record`);
  const existing = graph.edges.find((e) => e.id === edge.id);
  if (existing) return existing;
  graph.edges.push(edge);
  registerSource(graph, edge.source);
  return edge;
}

export function registerSource(graph: GraphResult, source: SourceRef): void {
  if (!graph.sources.some((s) => s.id === source.id)) graph.sources.push(source);
}

export function emptyGraph(query: BenchmarkResult["query"]): GraphResult {
  return { query, nodes: [], edges: [], hypotheses: [], builtAt: new Date().toISOString(), sources: [] };
}

/** Numeric phase from a ClinicalTrials.gov phase label ("Phase 2/3" → 2.5, "Phase 1" → 1), else undefined. */
export function phaseNumber(phase: string | null | undefined): number | undefined {
  if (!phase) return undefined;
  const nums = [...phase.matchAll(/(\d)/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 4);
  if (!nums.length) return undefined;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

export function buildGraph(benchmark: BenchmarkResult, trials?: TrialsResult): GraphResult {
  const graph = emptyGraph(benchmark.query);

  const target = addNode(graph, {
    id: nodeId("target", benchmark.target.chemblId),
    type: "target",
    label: benchmark.target.name,
    meta: { chemblId: benchmark.target.chemblId, organism: benchmark.target.organism },
    source: benchmark.target.source,
  });

  const drugs: GraphNode[] = [];
  for (const cb of [benchmark.candidate, ...benchmark.comparators]) {
    const c = cb.compound;
    const drug = addNode(graph, {
      id: nodeId("drug", c.chemblId),
      type: "drug",
      label: c.name,
      isCandidate: c.isCandidate || undefined,
      meta: { chemblId: c.chemblId, maxPhase: c.maxPhase, n: cb.n },
      source: c.source,
    });
    drugs.push(drug);
    if (cb.n > 0 && cb.measurements.length) {
      const [first, ...rest] = cb.measurements;
      addEdge(graph, {
        id: edgeId("measured_against", drug.id, target.id),
        type: "measured_against",
        from: drug.id,
        to: target.id,
        kind: "measured",
        strength: cb.medianPchembl,
        label: `median pChEMBL ${fmt(cb.medianPchembl)} (n=${cb.n})`,
        meta: {
          n: cb.n,
          min: cb.minPchembl,
          max: cb.maxPchembl,
          activityType: benchmark.activityType,
          rank: cb.rank,
          alsoValid: rest.map((m) => m.source.id),
        },
        source: first.source,
      });
      for (const m of rest) registerSource(graph, m.source);
    }
  }

  for (const w of benchmark.drugWarnings ?? []) {
    const drugNode = drugs.find((d) => d.id === nodeId("drug", w.compoundChemblId));
    if (!drugNode) continue;
    const warning = addNode(graph, {
      id: nodeId("warning", w.source.id.replace(/^chembl-warn:/, "")),
      type: "warning",
      label: w.warningType + (w.warningClass ? ` (${w.warningClass})` : ""),
      meta: { warningClass: w.warningClass ?? null, year: w.year ?? null, country: w.country ?? null, description: w.description ?? null },
      source: w.source,
    });
    addEdge(graph, {
      id: edgeId("has_warning", drugNode.id, warning.id),
      type: "has_warning",
      from: drugNode.id,
      to: warning.id,
      kind: "clinical",
      label: w.warningType,
      source: w.source,
    });
  }

  const diseaseName = benchmark.query.disease?.trim();
  const disease = diseaseName
    ? addNode(graph, { id: QUERY_DISEASE_ID, type: "disease", label: diseaseName, isQueryDisease: true, meta: { resolved: false } })
    : null;

  for (const t of trials?.trials ?? []) {
    const trial = addNode(graph, {
      id: nodeId("trial", t.nctId),
      type: "trial",
      label: t.title,
      meta: {
        nctId: t.nctId,
        phase: t.phase,
        status: t.status,
        hasResults: t.hasResults,
        enrollment: t.enrollment,
        startDate: t.startDate,
        interventions: t.interventions,
        conditions: t.conditions,
      },
      source: t.source,
    });
    const interventions = t.interventions.map((i) => i.toLowerCase());
    for (const d of drugs) {
      const name = d.label.toLowerCase();
      if (!name || !interventions.some((i) => i.includes(name))) continue;
      addEdge(graph, {
        id: edgeId("tested_in", d.id, trial.id),
        type: "tested_in",
        from: d.id,
        to: trial.id,
        kind: "clinical",
        strength: phaseNumber(t.phase),
        label: `${t.phase || "phase n/a"} · ${t.status}`,
        meta: { phase: t.phase, status: t.status, hasResults: t.hasResults },
        source: t.source,
      });
    }
    if (disease) {
      addEdge(graph, {
        id: edgeId("for_disease", trial.id, disease.id),
        type: "for_disease",
        from: trial.id,
        to: disease.id,
        kind: "clinical",
        label: "trial for disease",
        meta: { conditions: t.conditions },
        source: t.source,
      });
    }
  }

  return graph;
}
