// Lane layout for the evidence graph (docs/KG_PRD.md §7): fixed x per node type so every hypothesis
// reads left to right as drug → target → disease → trial. Pure; the view feeds the result to Cytoscape's
// preset layout. Hypothesis nodes are not drawn in the MVP.
import type { GraphEdge, GraphNode, GraphNodeType, GraphResult } from "@/lib/contracts";

export const LANE_WIDTH = 260;
const ROW_MIN = 34;
/** Trials beyond this count split into two sub-columns within the trial lane. */
const TRIAL_SPLIT_AT = 25;
/** Satellites (route / warning) sit this far left of their drug. */
const SATELLITE_DX = 90;
const SATELLITE_DY = 22;

const LANES: Partial<Record<GraphNodeType, number>> = { drug: 0, target: 1, disease: 2, trial: 3 };

/** Lane index for a node type; satellites share their drug's lane (positioned relative to it). */
export const laneOf = (type: GraphNodeType): number => LANES[type] ?? 0;

export const isDrawn = (n: GraphNode) => n.type !== "hypothesis";

export interface LayoutOptions {
  /** Target height in px; lanes are spread to fill it, never tighter than ROW_MIN */
  height?: number;
}

export type Positions = Map<string, { x: number; y: number }>;

export function positions(graph: GraphResult, opts: LayoutOptions = {}): Positions {
  const out: Positions = new Map();
  const nodes = graph.nodes.filter(isDrawn);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter((e) => byId.has(e.from) && byId.has(e.to));

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const edgesOf = (type: string) => edges.filter((e) => e.type === type);

  // --- Drugs: candidate first, then by measured potency desc, then by name
  const potency = new Map<string, number>();
  for (const e of edgesOf("measured_against")) if (e.strength != null) potency.set(e.from, Math.max(potency.get(e.from) ?? -Infinity, e.strength));
  const drugs = nodes
    .filter((n) => n.type === "drug")
    .sort((a, b) => Number(!!b.isCandidate) - Number(!!a.isCandidate) || (potency.get(b.id) ?? -1) - (potency.get(a.id) ?? -1) || a.label.localeCompare(b.label));

  // --- Targets: the one with most measured edges first
  const targets = nodes.filter((n) => n.type === "target").sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));

  // --- Diseases: query disease first, then by incident edges
  const diseases = nodes
    .filter((n) => n.type === "disease")
    .sort((a, b) => Number(!!b.isQueryDisease) - Number(!!a.isQueryDisease) || (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.label.localeCompare(b.label));

  // --- Trials: grouped under their disease (in disease order), by phase desc within a group
  const diseaseOfTrial = new Map<string, string>();
  for (const e of edgesOf("for_disease")) if (!diseaseOfTrial.has(e.from)) diseaseOfTrial.set(e.from, e.to);
  const diseaseRank = new Map(diseases.map((d, i) => [d.id, i]));
  const phaseOf = (n: GraphNode) => {
    const p = n.meta?.phase;
    const m = typeof p === "string" ? p.match(/\d/g) : null;
    return m ? m.reduce((a, b) => a + Number(b), 0) / m.length : 0;
  };
  const trials = nodes
    .filter((n) => n.type === "trial")
    .sort(
      (a, b) =>
        (diseaseRank.get(diseaseOfTrial.get(a.id) ?? "") ?? 99) - (diseaseRank.get(diseaseOfTrial.get(b.id) ?? "") ?? 99) ||
        phaseOf(b) - phaseOf(a) ||
        a.label.localeCompare(b.label),
    );

  // Satellites: route / warning nodes attached to a drug via administered_by / has_warning
  const satellites = new Map<string, GraphNode[]>();
  for (const e of edges) {
    const to = byId.get(e.to);
    if (!to || (to.type !== "route" && to.type !== "warning")) continue;
    const list = satellites.get(e.from) ?? [];
    if (!list.some((s) => s.id === to.id)) list.push(to);
    satellites.set(e.from, list);
  }
  const placedSatellites = new Set<string>();

  // Lane height: tallest lane decides, bounded below by ROW_MIN per row.
  const trialRows = trials.length > TRIAL_SPLIT_AT ? Math.ceil(trials.length / 2) : trials.length;
  const rowsNeeded = Math.max(drugs.length, targets.length, diseases.length, trialRows, 1);
  const height = Math.max(opts.height ?? 0, rowsNeeded * ROW_MIN);

  const spread = (list: GraphNode[], x: number, rows = list.length) => {
    const step = rows > 1 ? height / rows : 0;
    const y0 = rows > 1 ? step / 2 : height / 2;
    list.forEach((n, i) => out.set(n.id, { x, y: y0 + step * i }));
  };

  spread(drugs, laneOf("drug") * LANE_WIDTH);
  spread(targets, laneOf("target") * LANE_WIDTH);
  spread(diseases, laneOf("disease") * LANE_WIDTH);

  if (trials.length > TRIAL_SPLIT_AT) {
    const x = laneOf("trial") * LANE_WIDTH;
    const half = Math.ceil(trials.length / 2);
    const step = height / half;
    trials.forEach((n, i) => {
      const col = i < half ? 0 : 1;
      const row = col === 0 ? i : i - half;
      // Two sub-columns 48 px apart; the view puts column-0 labels on the left, column-1 on the right.
      out.set(n.id, { x: x + (col ? 24 : -24), y: step / 2 + step * row });
    });
  } else spread(trials, laneOf("trial") * LANE_WIDTH);

  // Satellites next to their drug, stacked
  for (const d of drugs) {
    const sats = satellites.get(d.id) ?? [];
    const p = out.get(d.id)!;
    sats.forEach((s, i) => {
      if (placedSatellites.has(s.id)) return;
      placedSatellites.add(s.id);
      out.set(s.id, { x: p.x - SATELLITE_DX, y: p.y + (i - (sats.length - 1) / 2) * SATELLITE_DY });
    });
  }
  // Orphan satellites (no edge to a drawn drug): park them left of the drug lane
  const orphans = nodes.filter((n) => (n.type === "route" || n.type === "warning") && !out.has(n.id));
  orphans.forEach((n, i) => out.set(n.id, { x: -SATELLITE_DX, y: ROW_MIN * (i + 1) }));

  return out;
}

/** Estimated canvas height for a graph (used by the view when no explicit height is given). */
export function graphHeight(graph: GraphResult): number {
  const count = (t: GraphNodeType) => graph.nodes.filter((n) => n.type === t).length;
  const trialRows = count("trial") > TRIAL_SPLIT_AT ? Math.ceil(count("trial") / 2) : count("trial");
  return Math.min(900, Math.max(420, Math.max(count("drug"), count("disease"), trialRows) * ROW_MIN + 60));
}
export const GRAPH_HEIGHT = 560;

/** Edge ids incident to a node (helper for hover highlighting). */
export const incidentEdges = (graph: GraphResult, nodeId: string): GraphEdge[] => graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
