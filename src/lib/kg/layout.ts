// Lane layout for the evidence graph (docs/KG_PRD.md §7): fixed x per node type so every hypothesis
// reads left to right as drug → target → disease → trial. Pure; the view feeds the result to Cytoscape's
// preset layout. Hypothesis nodes are not drawn in the MVP.
import type { GraphEdge, GraphNode, GraphNodeType, GraphResult } from "@/lib/contracts";

export const LANE_WIDTH = 260;
export const LANE_WIDTH_MIN = 200;
export const LANE_WIDTH_MAX = 360;
const ROW_MIN = 34;
/** At most this many trials are drawn (the candidate's own first); the rest stay in the data and citable. */
export const MAX_TRIALS_DRAWN = 24;
/** Trials beyond this count split into two sub-columns within the trial lane. */
const TRIAL_SPLIT_AT = 25;
/** Node types drawn as satellites beside their drug rather than in a lane. */
export const SATELLITE_TYPES = new Set<GraphNodeType>(["route", "warning", "safety", "patent"]);
/** Satellites (route / warning / safety / patent) sit this fraction of a lane width left of their drug (90 px at 260). */
const SATELLITE_DX_RATIO = 90 / 260;
const SATELLITE_DY = 22;

const LANES: Partial<Record<GraphNodeType, number>> = { drug: 0, target: 1, disease: 2, trial: 3 };

/** Lane index for a node type; satellites share their drug's lane (positioned relative to it). */
export const laneOf = (type: GraphNodeType): number => LANES[type] ?? 0;

const phaseOf = (n: GraphNode) => {
  const p = n.meta?.phase;
  const m = typeof p === "string" ? p.match(/\d/g) : null;
  return m ? m.reduce((a, b) => a + Number(b), 0) / m.length : 0;
};

/**
 * Trial ids that are drawn: the candidate's own trials first (tested_in edge from the candidate), then by
 * phase desc, then results posted, capped at MAX_TRIALS_DRAWN. Undrawn trials remain in the data.
 */
export function drawnTrialIds(graph: GraphResult): Set<string> {
  const candidate = graph.nodes.find((n) => n.type === "drug" && n.isCandidate)?.id;
  const own = new Set(graph.edges.filter((e) => e.type === "tested_in" && e.from === candidate).map((e) => e.to));
  const trials = graph.nodes
    .filter((n) => n.type === "trial")
    .sort(
      (a, b) =>
        Number(own.has(b.id)) - Number(own.has(a.id)) ||
        phaseOf(b) - phaseOf(a) ||
        Number(!!b.meta?.hasResults) - Number(!!a.meta?.hasResults) ||
        a.label.localeCompare(b.label),
    );
  return new Set(trials.slice(0, MAX_TRIALS_DRAWN).map((n) => n.id));
}

/** Type rule only (safe for `.filter(isDrawn)`): hypothesis nodes are never drawn. Use drawnNodes() for the trial cap. */
export const isDrawn = (n: GraphNode) => n.type !== "hypothesis";

/** The drawn subset of a graph's nodes (hypothesis nodes and overflow trials removed). */
export function drawnNodes(graph: GraphResult): GraphNode[] {
  const trials = drawnTrialIds(graph);
  return graph.nodes.filter((n) => isDrawn(n) && (n.type !== "trial" || trials.has(n.id)));
}

export interface LayoutOptions {
  /** Target height in px; lanes are spread to fill it, never tighter than ROW_MIN */
  height?: number;
  /** Horizontal distance between lanes (default LANE_WIDTH); the view derives it from its container width */
  laneWidth?: number;
}

export type Positions = Map<string, { x: number; y: number }>;

export function positions(graph: GraphResult, opts: LayoutOptions = {}): Positions {
  const out: Positions = new Map();
  const laneWidth = Math.max(LANE_WIDTH_MIN, Math.min(LANE_WIDTH_MAX, opts.laneWidth ?? LANE_WIDTH));
  const satelliteDx = laneWidth * SATELLITE_DX_RATIO;
  const nodes = drawnNodes(graph);
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

  // --- Diseases: query disease pinned first, generic ones last, then candidate-indicated, then by incident edges
  const candidateId = drugs.find((d) => d.isCandidate)?.id;
  const candidateIndicated = new Set(edgesOf("indicated_for").filter((e) => e.from === candidateId).map((e) => e.to));
  const diseases = nodes
    .filter((n) => n.type === "disease")
    .sort(
      (a, b) =>
        Number(!!b.isQueryDisease) - Number(!!a.isQueryDisease) ||
        // generic terms ("cancer") kept only for the gap check sink to the bottom
        Number(a.meta?.generic === true) - Number(b.meta?.generic === true) ||
        Number(candidateIndicated.has(b.id)) - Number(candidateIndicated.has(a.id)) ||
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
        a.label.localeCompare(b.label),
    );

  // --- Trials: grouped under their disease (in disease order), by phase desc within a group
  const diseaseOfTrial = new Map<string, string>();
  for (const e of edgesOf("for_disease")) if (!diseaseOfTrial.has(e.from)) diseaseOfTrial.set(e.from, e.to);
  const diseaseRank = new Map(diseases.map((d, i) => [d.id, i]));
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
    if (!to || !SATELLITE_TYPES.has(to.type)) continue;
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

  spread(drugs, laneOf("drug") * laneWidth);
  spread(targets, laneOf("target") * laneWidth);
  spread(diseases, laneOf("disease") * laneWidth);

  if (trials.length > TRIAL_SPLIT_AT) {
    const x = laneOf("trial") * laneWidth;
    const half = Math.ceil(trials.length / 2);
    const step = height / half;
    trials.forEach((n, i) => {
      const col = i < half ? 0 : 1;
      const row = col === 0 ? i : i - half;
      // Two sub-columns 48 px apart; the view puts column-0 labels on the left, column-1 on the right.
      out.set(n.id, { x: x + (col ? 24 : -24), y: step / 2 + step * row });
    });
  } else spread(trials, laneOf("trial") * laneWidth);

  // Satellites next to their drug, stacked
  for (const d of drugs) {
    const sats = satellites.get(d.id) ?? [];
    const p = out.get(d.id)!;
    sats.forEach((s, i) => {
      if (placedSatellites.has(s.id)) return;
      placedSatellites.add(s.id);
      out.set(s.id, { x: p.x - satelliteDx, y: p.y + (i - (sats.length - 1) / 2) * SATELLITE_DY });
    });
  }
  // Orphan satellites (no edge to a drawn drug): park them left of the drug lane
  const orphans = nodes.filter((n) => SATELLITE_TYPES.has(n.type) && !out.has(n.id));
  orphans.forEach((n, i) => out.set(n.id, { x: -satelliteDx, y: ROW_MIN * (i + 1) }));

  return out;
}

/** Upper bound for the canvas height; the view trims to the rendered content (and grows back after expansions). */
export const GRAPH_HEIGHT_MAX = 1400;

/**
 * Estimated canvas height for a graph (used by the view when no explicit height is given): enough rows for
 * the tallest lane, so an expansion that adds many diseases gets more room rather than a cramped lane.
 */
export function graphHeight(graph: GraphResult): number {
  const drawn = drawnNodes(graph);
  const count = (t: GraphNodeType) => drawn.filter((n) => n.type === t).length;
  const trialRows = count("trial") > TRIAL_SPLIT_AT ? Math.ceil(count("trial") / 2) : count("trial");
  return Math.min(GRAPH_HEIGHT_MAX, Math.max(420, Math.max(count("drug"), count("target"), count("disease"), trialRows) * ROW_MIN + 60));
}
export const GRAPH_HEIGHT = 560;

/** Edge ids incident to a node (helper for hover highlighting). */
export const incidentEdges = (graph: GraphResult, nodeId: string): GraphEdge[] => graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
