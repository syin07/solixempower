"use client";

// Evidence graph view (docs/KG_PRD.md §7): Cytoscape with a preset lane layout from src/lib/kg/layout.ts.
// Cytoscape touches `window`, so the parent must load this with
//   const KnowledgeGraph = dynamic(() => import("./KnowledgeGraph"), { ssr: false });
// from inside a client component (next/dynamic's ssr:false is not allowed in server components).
import { useCallback, useEffect, useRef, useState } from "react";
import cytoscape, { type Core, type ElementDefinition, type NodeSingular, type StylesheetJson } from "cytoscape";
import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeType, GraphResult } from "@/lib/contracts";
import { drawnNodes, graphHeight, LANE_WIDTH, LANE_WIDTH_MAX, LANE_WIDTH_MIN, laneOf, positions, type Positions } from "@/lib/kg/layout";

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

const NODE_TYPE_LABEL: Record<GraphNodeType, string> = {
  drug: "Drug",
  target: "Target",
  disease: "Disease",
  trial: "Clinical trial",
  route: "Route of administration",
  warning: "Drug warning",
  hypothesis: "Hypothesis",
};

const STAGGER_MS = 250;
/** Insertion order on first mount: the graph visibly builds lane by lane. */
const LANE_ORDER: GraphNodeType[][] = [["drug"], ["route", "warning"], ["target"], ["disease"], ["trial"]];
/** Space reserved for the satellites on the left and the trial labels on the right when sizing lanes. */
const LEFT_GUTTER = 110;
const RIGHT_GUTTER = 190;
const FIT_PADDING = 24;

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

/** Short edge label shown only when the edge is highlighted or hovered. */
export function edgeShortLabel(e: GraphEdge): string {
  const s = e.strength;
  switch (e.type) {
    case "measured_against":
      return s == null ? "measured" : `pChEMBL ${s.toFixed(1)}`;
    case "associated_with":
      return s == null ? "OT" : `OT ${s.toFixed(2)}`;
    case "tested_in":
      return s == null ? "trial" : `Phase ${Number.isInteger(s) ? s : s.toFixed(1)}`;
    case "indicated_for":
      return s == null ? "indicated" : s >= 4 ? "approved" : `phase ${s}`;
    case "mechanism":
      return typeof e.meta?.actionType === "string" ? String(e.meta.actionType).toLowerCase() : "mechanism";
    case "administered_by":
      return "route";
    case "has_warning":
      return "warning";
    case "absent":
      return "not found";
    default:
      return e.type.replace(/_/g, " ");
  }
}

/** Lane spacing that lets four lanes plus gutters fill the container, within the layout's bounds. */
export const laneWidthFor = (containerWidth: number) =>
  containerWidth > 0 ? clamp((containerWidth - LEFT_GUTTER - RIGHT_GUTTER) / 3, LANE_WIDTH_MIN, LANE_WIDTH_MAX) : LANE_WIDTH;

/** Trials in the left sub-column of a split trial lane get their label on the left so the two columns do not collide. */
const labelLeft = (n: GraphNode, pos: Positions, laneWidth: number) =>
  n.type === "trial" && (pos.get(n.id)?.x ?? 0) < laneOf("trial") * laneWidth;

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

const LABEL_MAX: Partial<Record<GraphNodeType, number>> = { trial: 26, disease: 26, drug: 24, target: 34, route: 14, warning: 22 };
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function nodeElement(n: GraphNode, pos: { x: number; y: number }, labelLeft = false): ElementDefinition {
  const label = truncate(n.label, LABEL_MAX[n.type] ?? 30);
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
    data: { id: e.id, source: e.from, target: e.to, label: edgeShortLabel(e), color, width: edgeWidth(e), edge: e },
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
      "transition-property": "opacity, border-width",
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
      // Labels only when highlighted or hovered (see edge.hl / edge.hover below)
      label: "",
      "font-size": 9,
      color: "#3f3f46",
      "text-rotation": "autorotate",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.85,
      "text-background-padding": "2px",
      "text-background-shape": "roundrectangle",
    },
  },
  { selector: "edge.dashed", style: { "line-style": "dashed" } },
  { selector: "edge.for_disease", style: { "target-arrow-shape": "none", opacity: 0.3 } },
  { selector: "edge.tested_in", style: { opacity: 0.3, "arrow-scale": 0.4 } },
  { selector: ".dim", style: { opacity: 0.18 } },
  { selector: "node.hl", style: { opacity: 1, "border-width": 3, "border-color": "#18181b" } },
  { selector: "node.candidate.hl", style: { "border-color": "#2563eb" } },
  { selector: "edge.hl", style: { opacity: 1, "line-style": "solid", width: "mapData(width, 1, 5, 2.5, 7)", "z-index": 10, label: "data(label)" } },
  { selector: "edge.hover", style: { opacity: 1, "z-index": 11, label: "data(label)" } },
  { selector: "edge:selected", style: { opacity: 1, "line-color": "#18181b", "target-arrow-color": "#18181b", label: "data(label)" } },
  { selector: "node:selected", style: { "border-color": "#18181b", "border-width": 3 } },
];

interface Chip {
  node: GraphNode;
  x: number;
  y: number;
}
interface Tip {
  text: string;
  x: number;
  y: number;
}

/** One-shot pulse of the candidate's ring when it first appears (no continuous animation). */
function pulse(node: NodeSingular) {
  node
    .animate({ style: { "border-width": 9 } }, { duration: 350, easing: "ease-out" })
    .animate({ style: { "border-width": 3 } }, { duration: 450, easing: "ease-in" });
}

export function KnowledgeGraph({ graph, highlightEdgeIds, onSelectEdge, onSelectNode, height }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const builtRef = useRef(false);
  const highlightRef = useRef<string[]>([]);
  const callbacks = useRef({ onSelectEdge, onSelectNode });
  const [laneWidth, setLaneWidth] = useState<number>(LANE_WIDTH);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  /** Canvas height trimmed to the rendered content after a build, keyed to the graph it was measured for. */
  const [fitHeight, setFitHeight] = useState<{ key: string; h: number } | null>(null);
  const [chip, setChip] = useState<Chip | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    callbacks.current = { onSelectEdge, onSelectNode };
  }, [onSelectEdge, onSelectNode]);
  const requested = height ?? graphHeight(graph);
  const fitKey = `${graph.builtAt}|${graph.nodes.length}|${requested}`;
  const h = fitHeight && fitHeight.key === fitKey && fitHeight.h < requested ? fitHeight.h : requested;

  const fit = useCallback(() => cyRef.current?.fit(undefined, FIT_PADDING), []);
  /** After a fit, shrink the canvas to the content so a wide, short graph does not leave a blank band below. */
  const trimHeight = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || cy.elements().empty()) return;
    const bb = cy.elements().renderedBoundingBox();
    const needed = Math.ceil(bb.h + 2 * FIT_PADDING);
    if (needed >= 420 && needed < requested - 8) setFitHeight({ key: fitKey, h: needed });
  }, [requested, fitKey]);

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
      const node = ev.target as NodeSingular;
      const data = node.data("node") as GraphNode;
      if (data && node.data("label") !== data.label) {
        const p = node.renderedPosition();
        setTip({ text: data.label, x: p.x, y: p.y });
      }
      if (cy.data("pinned")) return;
      const hood = node.closedNeighborhood();
      cy.elements().addClass("dim");
      hood.removeClass("dim").addClass("hl");
    });
    cy.on("mouseout", "node", () => {
      setTip(null);
      clearHover();
    });
    cy.on("mouseover", "edge", (ev) => ev.target.addClass("hover"));
    cy.on("mouseout", "edge", (ev) => ev.target.removeClass("hover"));
    cy.on("tap", "edge", (ev) => {
      setChip(null);
      callbacks.current.onSelectEdge?.(ev.target.data("edge") as GraphEdge);
    });
    cy.on("tap", "node", (ev) => {
      const node = ev.target as NodeSingular;
      const data = node.data("node") as GraphNode;
      const p = node.renderedPosition();
      setChip({ node: data, x: p.x, y: p.y });
      callbacks.current.onSelectNode?.(data);
    });
    cy.on("tap", (ev) => {
      if (ev.target === cy) {
        setChip(null);
        callbacks.current.onSelectEdge?.(null);
      }
    });
    // The chip is anchored in rendered pixels; hide it when the viewport moves rather than track it.
    cy.on("pan zoom", () => {
      setChip(null);
      setTip(null);
    });
    cy.on("drag", "node", () => setChip(null));

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      cy.destroy();
      cyRef.current = null;
      builtRef.current = false;
    };
  }, []);

  // Lane spacing follows the container width (mount + resize); a hidden container (mobile) keeps the default.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) {
        setLaneWidth(laneWidthFor(w));
        setContainerWidth(w);
      }
      cyRef.current?.resize();
      cyRef.current?.fit(undefined, FIT_PADDING);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sync elements with the graph: staggered lane-by-lane build on first mount, diff-by-id afterwards.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const pos = positions(graph, { height: h - 48, laneWidth });
    const nodes = drawnNodes(graph);
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
          cy.add(batch.map((n) => nodeElement(n, pos.get(n.id) ?? { x: laneOf(n.type) * laneWidth, y: 0 }, labelLeft(n, pos, laneWidth))));
          cy.add(edgesFor(added));
          cy.fit(undefined, FIT_PADDING);
          if (i === 0) cy.nodes(".candidate").forEach(pulse);
          if (i === LANE_ORDER.length - 1) trimHeight();
          if (highlightRef.current.length) applyHighlight(cy, highlightRef.current);
        }, STAGGER_MS * i);
        timersRef.current.push(t);
      });
      return;
    }

    // Later updates (expand, resize): add what is new, drop what is gone, re-place everything.
    const keep = new Set([...nodeIds, ...edges.map((e) => e.id)]);
    cy.elements().filter((el) => !keep.has(el.id())).remove();
    const fresh = nodes.filter((n) => !present.has(n.id));
    fresh.forEach((n) => present.add(n.id));
    cy.add(fresh.map((n) => nodeElement(n, pos.get(n.id) ?? { x: 0, y: 0 }, labelLeft(n, pos, laneWidth))));
    cy.add(edgesFor(new Set(nodes.map((n) => n.id))));
    cy.nodes().forEach((n) => {
      const p = pos.get(n.id());
      if (p) n.animate({ position: p }, { duration: 300 });
    });
    const t = setTimeout(() => {
      cy.fit(undefined, FIT_PADDING);
      trimHeight();
    }, 320);
    timersRef.current.push(t);
    cy.fit(undefined, FIT_PADDING);
  }, [graph, h, laneWidth, trimHeight]);

  // External highlight (hypothesis card hover): pin the highlight so node hover does not fight it.
  // Re-applied after every staggered batch, since the edges may not exist yet when the prop arrives.
  useEffect(() => {
    highlightRef.current = highlightEdgeIds ?? [];
    if (cyRef.current) applyHighlight(cyRef.current, highlightRef.current);
  }, [highlightEdgeIds, graph]);

  const chipUrl = chip?.node.source?.url;
  return (
    <>
      <div className="relative hidden w-full overflow-hidden rounded-md border border-zinc-200 bg-white min-[900px]:block" style={{ height: h }}>
        <div ref={containerRef} className="h-full w-full" />
        <button
          type="button"
          onClick={fit}
          className="absolute right-2 top-2 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 shadow-sm hover:bg-zinc-50"
        >
          Fit
        </button>
        {tip && !chip && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs -translate-x-1/2 rounded bg-zinc-900 px-2 py-1 text-xs text-white shadow"
            style={{ left: tip.x, top: Math.max(0, tip.y - 34) }}
          >
            {tip.text}
          </div>
        )}
        {chip && (
          <div
            className="absolute z-20 flex max-w-xs -translate-x-1/2 flex-col gap-0.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: clamp(chip.x, 90, Math.max(90, (containerWidth || 400) - 90)), top: chip.y + 14 }}
          >
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">{NODE_TYPE_LABEL[chip.node.type]}</span>
            <span className="font-medium text-zinc-900">{chip.node.label}</span>
            <span className="flex items-center gap-3">
              {chipUrl ? (
                <a href={chipUrl} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline">
                  Open record ↗
                </a>
              ) : (
                <span className="text-zinc-400">no record link</span>
              )}
              <button type="button" onClick={() => setChip(null)} className="ml-auto text-zinc-500 hover:text-zinc-800">
                ✕
              </button>
            </span>
          </div>
        )}
      </div>
      <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-500 min-[900px]:hidden">
        Graph view needs a wider screen; hypotheses and sources are listed below.
      </p>
    </>
  );
}

export default KnowledgeGraph;
