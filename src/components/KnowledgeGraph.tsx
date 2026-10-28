"use client";

// Evidence graph view (docs/KG_PRD.md §7): Cytoscape with a preset lane layout from src/lib/kg/layout.ts.
// Cytoscape touches `window`, so the parent must load this with
//   const KnowledgeGraph = dynamic(() => import("./KnowledgeGraph"), { ssr: false });
// from inside a client component (next/dynamic's ssr:false is not allowed in server components).
import { useEffect, useRef } from "react";
import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from "cytoscape";
import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeType, GraphResult } from "@/lib/contracts";
import { graphHeight, isDrawn, laneOf, LANE_WIDTH, positions, type Positions } from "@/lib/kg/layout";

export interface KnowledgeGraphProps {
  graph: GraphResult;
  /** Edge ids to light up (the rest dims), e.g. a hypothesis path on card hover */
  highlightEdgeIds?: string[];
  onSelectEdge?: (edge: GraphEdge | null) => void;
  onSelectNode?: (node: GraphNode) => void;
  height?: number;
}

/** Edge colors: the EvidenceBadge palette (src/components/EvidenceBadge.tsx), plus amber for regulatory records. */
export const EDGE_COLORS: Record<GraphEdgeKind, string> = {
  measured: "#2563eb",
  computed: "#7c3aed",
  clinical: "#059669",
  absent: "#dc2626",
  ai_summary: "#71717a",
};
export const REGULATORY_COLOR = "#d97706";
const REGULATORY_TYPES = new Set(["administered_by", "has_warning"]);

export const NODE_FILLS: Record<GraphNodeType, string> = {
  drug: "#e4e4e7",
  target: "#cbd5e1",
  disease: "#f4f4f5",
  trial: "#fafafa",
  route: "#fef3c7",
  warning: "#fee2e2",
  hypothesis: "#f4f4f5",
};

const STAGGER_MS = 250;
/** Insertion order on first mount: the graph visibly builds lane by lane. */
const LANE_ORDER: GraphNodeType[][] = [["drug"], ["route", "warning"], ["target"], ["disease"], ["trial"]];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export function edgeWidth(e: GraphEdge): number {
  const s = e.strength;
  if (s == null) return 1.5;
  switch (e.type) {
    case "measured_against":
      return clamp(1 + ((s - 5) / 4) * 4, 1, 5);
    case "associated_with":
      return clamp(1 + s * 4, 1, 5);
    case "tested_in":
      return clamp(1.5 + ((s - 1) / 3) * 1.5, 1.5, 3);
    default:
      return 1.5;
  }
}

/** Trials in the left sub-column of a split trial lane get their label on the left so the two columns do not collide. */
const labelLeft = (n: GraphNode, pos: Positions) => n.type === "trial" && (pos.get(n.id)?.x ?? 0) < laneOf("trial") * LANE_WIDTH;

function applyHighlight(cy: Core, ids: string[]) {
  cy.elements().removeClass("hl dim");
  if (!ids.length) {
    cy.data("pinned", false);
    return;
  }
  cy.data("pinned", true);
  const sel = cy.collection();
  ids.forEach((id) => {
    const e = cy.getElementById(id);
    if (e.nonempty()) sel.merge(e).merge(e.connectedNodes());
  });
  cy.elements().addClass("dim");
  sel.removeClass("dim").addClass("hl");
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function nodeElement(n: GraphNode, pos: { x: number; y: number }, labelLeft = false): ElementDefinition {
  const label = n.type === "trial" ? truncate(n.label, 26) : truncate(n.label, 40);
  const classes = [n.type, n.isCandidate ? "candidate" : "", n.isQueryDisease ? "query-disease" : "", labelLeft ? "label-left" : ""]
    .filter(Boolean)
    .join(" ");
  return { group: "nodes", data: { id: n.id, label, title: n.label, node: n }, position: { ...pos }, classes };
}

function edgeElement(e: GraphEdge): ElementDefinition {
  const color = REGULATORY_TYPES.has(e.type) ? REGULATORY_COLOR : EDGE_COLORS[e.kind];
  const dashed = e.kind === "computed" || e.kind === "absent";
  return {
    group: "edges",
    data: { id: e.id, source: e.from, target: e.to, label: e.label, color, width: edgeWidth(e), edge: e },
    classes: dashed ? `${e.type} dashed` : e.type,
  };
}

const STYLE: StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "font-size": 11,
      "font-family": "ui-sans-serif, system-ui, sans-serif",
      color: "#18181b",
      "text-valign": "center",
      "text-halign": "right",
      "text-margin-x": 6,
      "text-wrap": "none",
      "background-color": "#e4e4e7",
      "border-width": 1,
      "border-color": "#a1a1aa",
      width: 18,
      height: 18,
      "transition-property": "opacity",
      "transition-duration": 150,
    },
  },
  { selector: "node.drug", style: { shape: "ellipse", "background-color": NODE_FILLS.drug, width: 20, height: 20 } },
  { selector: "node.target", style: { shape: "diamond", "background-color": NODE_FILLS.target, width: 26, height: 26, "font-weight": "bold" } },
  { selector: "node.disease", style: { shape: "round-rectangle", "background-color": NODE_FILLS.disease, width: 22, height: 16 } },
  { selector: "node.trial", style: { shape: "rectangle", "background-color": NODE_FILLS.trial, width: 10, height: 10, "font-size": 9, color: "#52525b" } },
  { selector: "node.route", style: { shape: "round-tag", "background-color": NODE_FILLS.route, "border-color": REGULATORY_COLOR, width: 14, height: 12, "font-size": 9, "text-halign": "left", "text-margin-x": -6 } },
  { selector: "node.warning", style: { shape: "round-tag", "background-color": NODE_FILLS.warning, "border-color": "#dc2626", width: 14, height: 12, "font-size": 9, "text-halign": "left", "text-margin-x": -6 } },
  { selector: "node.label-left", style: { "text-halign": "left", "text-margin-x": -6 } },
  { selector: "node.candidate", style: { "border-width": 3, "border-color": "#2563eb", "font-weight": "bold", width: 24, height: 24 } },
  { selector: "node.query-disease", style: { "border-width": 3, "border-color": "#059669", "font-weight": "bold" } },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "line-color": "data(color)",
      width: "data(width)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "data(color)",
      "arrow-scale": 0.6,
      opacity: 0.8,
      "transition-property": "opacity, width",
      "transition-duration": 150,
    },
  },
  { selector: "edge.dashed", style: { "line-style": "dashed" } },
  { selector: "edge.for_disease", style: { "target-arrow-shape": "none", opacity: 0.3 } },
  { selector: "edge.tested_in", style: { opacity: 0.3, "arrow-scale": 0.4 } },
  { selector: ".dim", style: { opacity: 0.18 } },
  { selector: "node.hl", style: { opacity: 1, "border-width": 3, "border-color": "#18181b" } },
  { selector: "node.candidate.hl", style: { "border-color": "#2563eb" } },
  { selector: "edge.hl", style: { opacity: 1, "line-style": "solid", width: "mapData(width, 1, 5, 2.5, 7)", "z-index": 10 } },
  { selector: "edge:selected", style: { opacity: 1, "line-color": "#18181b", "target-arrow-color": "#18181b" } },
  { selector: "node:selected", style: { "border-color": "#18181b", "border-width": 3 } },
];

export function KnowledgeGraph({ graph, highlightEdgeIds, onSelectEdge, onSelectNode, height }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const builtRef = useRef(false);
  const highlightRef = useRef<string[]>([]);
  const callbacks = useRef({ onSelectEdge, onSelectNode });
  useEffect(() => {
    callbacks.current = { onSelectEdge, onSelectNode };
  }, [onSelectEdge, onSelectNode]);
  const h = height ?? graphHeight(graph);

  // Create the instance once.
  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: STYLE,
      layout: { name: "preset" },
      boxSelectionEnabled: false,
      autounselectify: false,
      minZoom: 0.3,
      maxZoom: 3,
    });
    cyRef.current = cy;

    const clearHover = () => {
      if (cy.data("pinned")) return;
      cy.elements().removeClass("hl dim");
    };
    cy.on("mouseover", "node", (ev) => {
      if (cy.data("pinned")) return;
      const node = ev.target;
      const hood = node.closedNeighborhood();
      cy.elements().addClass("dim");
      hood.removeClass("dim").addClass("hl");
    });
    cy.on("mouseout", "node", clearHover);
    cy.on("tap", "edge", (ev) => callbacks.current.onSelectEdge?.(ev.target.data("edge") as GraphEdge));
    cy.on("tap", "node", (ev) => callbacks.current.onSelectNode?.(ev.target.data("node") as GraphNode));
    cy.on("tap", (ev) => {
      if (ev.target === cy) callbacks.current.onSelectEdge?.(null);
    });

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      cy.destroy();
      cyRef.current = null;
      builtRef.current = false;
    };
  }, []);

  // Sync elements with the graph: staggered lane-by-lane build on first mount, diff-by-id afterwards.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const pos = positions(graph, { height: h - 48 });
    const nodes = graph.nodes.filter(isDrawn);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

    const present = new Set(cy.elements().map((el) => el.id()));
    const edgesFor = (added: Set<string>) =>
      edges.filter((e) => !present.has(e.id) && added.has(e.from) && added.has(e.to)).map((e) => {
        present.add(e.id);
        return edgeElement(e);
      });

    if (!builtRef.current) {
      builtRef.current = true;
      const added = new Set<string>();
      LANE_ORDER.forEach((types, i) => {
        const t = setTimeout(() => {
          const batch = nodes.filter((n) => types.includes(n.type) && !present.has(n.id));
          batch.forEach((n) => {
            present.add(n.id);
            added.add(n.id);
          });
          cy.add(batch.map((n) => nodeElement(n, pos.get(n.id) ?? { x: laneOf(n.type) * LANE_WIDTH, y: 0 }, labelLeft(n, pos))));
          cy.add(edgesFor(added));
          cy.fit(undefined, 24);
          if (highlightRef.current.length) applyHighlight(cy, highlightRef.current);
        }, STAGGER_MS * i);
        timersRef.current.push(t);
      });
      return;
    }

    // Later updates (e.g. expand): add what is new, drop what is gone, re-place everything.
    const keep = new Set([...nodeIds, ...edges.map((e) => e.id)]);
    cy.elements().filter((el) => !keep.has(el.id())).remove();
    const fresh = nodes.filter((n) => !present.has(n.id));
    fresh.forEach((n) => present.add(n.id));
    cy.add(fresh.map((n) => nodeElement(n, pos.get(n.id) ?? { x: 0, y: 0 }, labelLeft(n, pos))));
    cy.add(edgesFor(new Set(nodes.map((n) => n.id))));
    cy.nodes().forEach((n) => {
      const p = pos.get(n.id());
      if (p) n.animate({ position: p }, { duration: 300 });
    });
    cy.fit(undefined, 24);
  }, [graph, h]);

  // External highlight (hypothesis card hover): pin the highlight so node hover does not fight it.
  // Re-applied after every staggered batch, since the edges may not exist yet when the prop arrives.
  useEffect(() => {
    highlightRef.current = highlightEdgeIds ?? [];
    if (cyRef.current) applyHighlight(cyRef.current, highlightRef.current);
  }, [highlightEdgeIds, graph]);

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-zinc-200 bg-white" style={{ height: h }}>
      <div ref={containerRef} className="h-full w-full" />
      <button
        type="button"
        onClick={() => cyRef.current?.fit(undefined, 24)}
        className="absolute right-2 top-2 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 shadow-sm hover:bg-zinc-50"
      >
        Fit
      </button>
    </div>
  );
}

export default KnowledgeGraph;
