// Enrichment for the evidence graph (docs/KG_PRD.md §4): adds target→disease associations (Open
// Targets), approved routes, ChEMBL indications and curated mechanisms to the graph built by
// buildGraph(). Each source is fetched independently and failures are logged, not thrown, so the
// graph still renders if one source is down. Every edge added here carries a SourceRef.
import { getIndications, getMechanisms, getMolecules, getTarget } from "@/lib/chembl/api";
import { chemblUrl } from "@/lib/chembl/client";
import type { BenchmarkResult, GraphNode, GraphResult, SourceRef } from "@/lib/contracts";
import { addEdge, addNode, QUERY_DISEASE_ID } from "./build";
import { edgeId, nodeId, normalizeEfo, openTargetsEvidenceUrl, parseNodeId } from "./ids";
import {
  associatedDiseases,
  diseaseAncestorCounts,
  diseaseAncestors,
  filterDiseaseRows,
  mapUniprotToEnsembl,
  resolveDisease,
  type DiseaseAssociation,
} from "./opentargets";

const SECONDARY_TARGETS = 3;
/** Indication-only disease nodes with fewer ancestors than this are too generic to draw (PRD §5) */
const MIN_ANCESTORS = 5;
/** Names treated as generic when Open Targets cannot tell us the ancestor count */
const GENERIC_NAMES = /^(malignant )?(carcinoma|neoplasm|tumou?r|solid tumou?r|disease|disorder|syndrome|infection|pain|inflammation)s?$/;
const ROUTES = { oral: "Oral", parenteral: "Parenteral", topical: "Topical" } as const;
const fmt = (n: number) => n.toFixed(2);
const warn = (what: string, e: unknown) => console.warn(`[kg/enrich] ${what} unavailable:`, e instanceof Error ? e.message : e);

export async function enrichGraph(input: GraphResult, benchmark: BenchmarkResult): Promise<GraphResult> {
  const graph: GraphResult = {
    ...input,
    nodes: input.nodes.map((n) => ({ ...n, meta: n.meta ? { ...n.meta } : undefined })),
    edges: input.edges.map((e) => ({ ...e, meta: e.meta ? { ...e.meta } : undefined })),
    hypotheses: [...input.hypotheses],
    sources: [...input.sources],
  };

  // a. Resolve the query disease to an ontology id
  let queryDiseaseId: string | null = null;
  let queryAncestors: string[] = [];
  const queryNode = graph.nodes.find((n) => n.id === QUERY_DISEASE_ID);
  if (queryNode) {
    try {
      const hit = await resolveDisease(queryNode.label);
      if (hit) {
        queryDiseaseId = nodeId("disease", hit.id);
        renameNode(graph, QUERY_DISEASE_ID, queryDiseaseId);
        queryNode.meta = { ...queryNode.meta, resolved: true, efoId: hit.id, otName: hit.name };
        queryAncestors = await diseaseAncestors(hit.id);
      } else {
        queryNode.meta = { ...queryNode.meta, resolved: false, resolution: "no_match" };
      }
    } catch (e) {
      warn("disease resolution", e);
      queryNode.meta = { ...queryNode.meta, resolved: false, resolution: "lookup_failed" };
    }
  }

  const candidate = graph.nodes.find((n) => n.type === "drug" && n.isCandidate);
  const drugNodes = () => graph.nodes.filter((n) => n.type === "drug");

  // b. Target → disease associations (Open Targets), for the benchmark target and secondary targets
  try {
    const targets: { chemblId: string; name: string; n?: number }[] = [{ chemblId: benchmark.target.chemblId, name: benchmark.target.name }];
    for (const t of (benchmark.candidateTargets ?? [])
      .filter((t) => t.chemblId !== benchmark.target.chemblId)
      .sort((a, b) => b.n - a.n)
      .slice(0, SECONDARY_TARGETS))
      targets.push(t);

    const raws = await Promise.all(targets.map((t) => getTarget(t.chemblId).catch((e) => (warn(`target ${t.chemblId}`, e), null))));
    const accessions = raws.map((r) => r?.target_components?.[0]?.accession ?? null);
    const mapping = await mapUniprotToEnsembl(accessions.filter((a): a is string => Boolean(a)));
    const exclude = queryDiseaseId ? [parseNodeId(queryDiseaseId)!.key, ...queryAncestors] : queryAncestors;

    await Promise.all(
      targets.map(async (t, i) => {
        const accession = accessions[i];
        const mapped = accession ? mapping.get(accession) : undefined;
        const targetNode = addNode(graph, {
          id: nodeId("target", t.chemblId),
          type: "target",
          label: t.name,
          meta: { chemblId: t.chemblId, organism: raws[i]?.organism ?? "Homo sapiens" },
          source: { id: `chembl-target:${t.chemblId}`, database: "ChEMBL", label: `${t.name} (${t.chemblId})`, url: chemblUrl.target(t.chemblId) },
        });
        targetNode.meta = { ...targetNode.meta, uniprot: accession, ensemblId: mapped?.ensemblId ?? null, symbol: mapped?.symbol ?? null };

        // Secondary target: the candidate has measurements there but they were not ranked
        if (i > 0 && candidate && t.n != null) {
          addEdge(graph, {
            id: edgeId("measured_against", candidate.id, targetNode.id),
            type: "measured_against",
            from: candidate.id,
            to: targetNode.id,
            kind: "measured",
            label: `${t.n} measurement${t.n === 1 ? "" : "s"} (not ranked)`,
            meta: { n: t.n, ranked: false },
            source: candidate.source!,
          });
        }
        if (!mapped) return;

        let rows: DiseaseAssociation[];
        try {
          rows = filterDiseaseRows((await associatedDiseases(mapped.ensemblId)).rows, { excludeIds: exclude });
        } catch (e) {
          warn(`Open Targets associations for ${mapped.symbol}`, e);
          return;
        }
        for (const r of rows) addDiseaseAssociation(graph, targetNode, mapped, r);
      }),
    );
  } catch (e) {
    warn("Open Targets", e);
  }

  // c. Approved routes (ChEMBL regulatory flags)
  const parentIds = drugNodes().map((d) => String(d.meta?.chemblId ?? parseNodeId(d.id)?.key));
  try {
    const mols = await getMolecules(parentIds);
    for (const d of drugNodes()) {
      const m = mols.find((x) => x.molecule_chembl_id === d.meta?.chemblId);
      if (!m) continue;
      if (m.first_approval != null) d.meta = { ...d.meta, firstApproval: m.first_approval };
      for (const key of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
        if (!m[key]) continue;
        const route = addNode(graph, { id: nodeId("route", key), type: "route", label: ROUTES[key] });
        addEdge(graph, {
          id: edgeId("administered_by", d.id, route.id),
          type: "administered_by",
          from: d.id,
          to: route.id,
          kind: "clinical",
          label: `Approved route: ${key}`,
          meta: { route: key, firstApproval: m.first_approval ?? null },
          source: d.source!,
        });
      }
    }
  } catch (e) {
    warn("routes", e);
  }

  // d. Indications (ChEMBL drug_indication), deduped per drug–disease keeping the highest phase
  try {
    const rows = await getIndications(parentIds);
    const best = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!r.efo_id) continue;
      const key = `${r.parent_molecule_chembl_id}|${normalizeEfo(r.efo_id)}`;
      const prev = best.get(key);
      if (!prev || Number(r.max_phase_for_ind ?? 0) > Number(prev.max_phase_for_ind ?? 0)) best.set(key, r);
    }
    // Keep the graph readable (imatinib alone has 100+ trial indications in ChEMBL): an indicated_for
    // edge is kept only when the disease is the query disease, is already linked to a target (Open
    // Targets), or is among the drug's top indications by phase (candidate 8, comparators 3). Every drug
    // keeps its full count in meta.indicationCount; the candidate also keeps the full id list in
    // meta.indications so a gap check can consult it without the edges.
    const KEEP_CANDIDATE = 8;
    const KEEP_COMPARATOR = 3;
    const linkedIds = new Set(graph.nodes.filter((n) => n.type === "disease").map((n) => n.id));
    const linkedNames = new Set(graph.nodes.filter((n) => n.type === "disease").map((n) => normName(n.label)));
    const queryId = graph.nodes.find((n) => n.type === "disease" && n.isQueryDisease)?.id;
    const byDrug = new Map<string, (typeof rows)[number][]>();
    for (const r of best.values()) {
      const list = byDrug.get(r.parent_molecule_chembl_id) ?? [];
      list.push(r);
      byDrug.set(r.parent_molecule_chembl_id, list);
    }
    const kept = new Set<string>();
    for (const d of drugNodes()) {
      const list = (byDrug.get(String(d.meta?.chemblId ?? "")) ?? []).sort(
        (a, b) => Number(b.max_phase_for_ind ?? 0) - Number(a.max_phase_for_ind ?? 0) || (a.efo_term ?? "").localeCompare(b.efo_term ?? ""),
      );
      const top = list.slice(0, d.isCandidate ? KEEP_CANDIDATE : KEEP_COMPARATOR);
      for (const r of top) kept.add(`${r.parent_molecule_chembl_id}|${normalizeEfo(r.efo_id!)}`);
      d.meta = {
        ...d.meta,
        indicationCount: list.length,
        ...(d.isCandidate ? { indications: list.map((r) => normalizeEfo(r.efo_id!)) } : {}),
      };
    }
    for (const r of best.values()) {
      const drug = graph.nodes.find((n) => n.id === nodeId("drug", r.parent_molecule_chembl_id));
      if (!drug) continue;
      const efo = normalizeEfo(r.efo_id!);
      const id = nodeId("disease", efo);
      const linked =
        id === queryId || linkedIds.has(id) || linkedNames.has(normName(r.efo_term ?? r.mesh_heading ?? ""));
      if (!linked && !kept.has(`${r.parent_molecule_chembl_id}|${efo}`)) continue;
      const disease = addNode(graph, {
        id: nodeId("disease", efo),
        type: "disease",
        label: r.efo_term ?? r.mesh_heading ?? efo,
        meta: { efoId: efo },
      });
      const phase = Number(r.max_phase_for_ind ?? 0);
      addEdge(graph, {
        id: edgeId("indicated_for", drug.id, disease.id),
        type: "indicated_for",
        from: drug.id,
        to: disease.id,
        kind: "clinical",
        strength: phase || undefined,
        label: phase >= 4 ? "Indicated (approved)" : phase > 0 ? `Indicated (phase ${phase})` : "Indicated (phase n/a)",
        meta: { maxPhaseForInd: phase, meshHeading: r.mesh_heading ?? null },
        source: {
          id: `chembl-ind:${r.drugind_id}`,
          database: "ChEMBL",
          label: `${drug.label} indication: ${r.efo_term ?? r.mesh_heading ?? efo}`,
          url: chemblUrl.compound(r.molecule_chembl_id),
        },
      });
    }
  } catch (e) {
    warn("indications", e);
  }

  // d2. Drop generic indication-only diseases ("cancer", "neoplasm"): comparators' indications are not
  // subject to the Open Targets ancestor filter, so apply it here. The query disease and anything the
  // candidate is indicated for are kept (the gap check needs the candidate's full list) but flagged.
  try {
    const dropped = await pruneGenericIndicationDiseases(graph, candidate?.id ?? null);
    if (dropped.length) console.info(`[kg/enrich] dropped ${dropped.length} generic indication-only disease(s): ${dropped.join(", ")}`);
  } catch (e) {
    warn("generic-disease pruning", e);
  }

  // e. Merge disease nodes that are the same disease under different ids (ChEMBL EFO vs Open Targets MONDO)
  mergeDiseasesByName(graph);

  // f. Curated mechanism edges for drugs in the graph
  try {
    const mechs = await getMechanisms(benchmark.target.chemblId);
    const targetId = nodeId("target", benchmark.target.chemblId);
    for (const m of mechs) {
      const parent = m.parent_molecule_chembl_id ?? m.molecule_chembl_id;
      const drug = graph.nodes.find((n) => n.id === nodeId("drug", parent));
      if (!drug) continue;
      addEdge(graph, {
        id: edgeId("mechanism", drug.id, targetId),
        type: "mechanism",
        from: drug.id,
        to: targetId,
        kind: "clinical",
        label: m.action_type ?? "mechanism",
        meta: { directInteraction: m.direct_interaction === 1, mechanismOfAction: m.mechanism_of_action, maxPhase: m.max_phase },
        source: {
          id: `chembl-mech:${m.mec_id}`,
          database: "ChEMBL",
          label: `${drug.label}: ${m.mechanism_of_action ?? m.action_type ?? "mechanism"}`,
          url: chemblUrl.compound(parent),
        },
      });
    }
  } catch (e) {
    warn("mechanisms", e);
  }

  graph.builtAt = new Date().toISOString();
  return graph;
}

/**
 * Adds (or reuses) the disease node for an Open Targets association row and the target→disease
 * `associated_with` edge (kind computed, strength = overall score, sub-scores in meta as ot_<datatype>).
 * Shared by enrichGraph and expand-on-click. Returns the disease node.
 */
export function addDiseaseAssociation(
  graph: GraphResult,
  targetNode: GraphNode,
  mapped: { ensemblId: string; symbol: string },
  r: DiseaseAssociation,
): GraphNode {
  const disease =
    findDiseaseNode(graph, r.efoId, r.name) ??
    addNode(graph, {
      id: nodeId("disease", r.efoId),
      type: "disease",
      label: r.name,
      meta: { efoId: r.efoId, nAncestors: r.nAncestors, therapeuticAreas: r.therapeuticAreas },
    });
  const sub = Object.fromEntries(Object.entries(r.datatypeScores).map(([k, v]) => [`ot_${k}`, Number(v.toFixed(3))]));
  addEdge(graph, {
    id: edgeId("associated_with", targetNode.id, disease.id),
    type: "associated_with",
    from: targetNode.id,
    to: disease.id,
    kind: "computed",
    strength: r.score,
    label: `Open Targets association ${fmt(r.score)}`,
    meta: { score: Number(r.score.toFixed(3)), ...sub, ensemblId: mapped.ensemblId },
    source: {
      id: `ot-assoc:${mapped.ensemblId}:${r.efoId}`,
      database: "Open Targets",
      label: `${mapped.symbol} – ${r.name} (Open Targets)`,
      url: openTargetsEvidenceUrl(mapped.ensemblId, r.efoId),
    },
  });
  return disease;
}

/** An existing disease node matching this ontology id (directly or via meta.altIds) or this name. */
export function findDiseaseNode(graph: GraphResult, efoId: string, name?: string): GraphNode | undefined {
  const id = normalizeEfo(efoId);
  const n = name ? normName(name) : null;
  return graph.nodes.find(
    (d) =>
      d.type === "disease" &&
      (d.id === nodeId("disease", id) ||
        (Array.isArray(d.meta?.altIds) && (d.meta!.altIds as string[]).includes(id)) ||
        (n != null && (normName(d.label) === n || (typeof d.meta?.otName === "string" && normName(d.meta.otName) === n)))),
  );
}

/** Gives a node a new id and rewrites every edge that points at it. Merges into an existing node of that id. */
function renameNode(graph: GraphResult, from: string, to: string): void {
  if (from === to) return;
  const node = graph.nodes.find((n) => n.id === from);
  if (!node) return;
  const existing = graph.nodes.find((n) => n.id === to);
  if (existing) {
    existing.isQueryDisease = existing.isQueryDisease || node.isQueryDisease;
    existing.meta = { ...node.meta, ...existing.meta };
    graph.nodes = graph.nodes.filter((n) => n !== node);
  } else {
    node.id = to;
  }
  for (const e of graph.edges) {
    if (e.from === from) e.from = to;
    if (e.to === from) e.to = to;
    e.id = edgeId(e.type, e.from, e.to);
  }
  // Rewriting can create duplicate edge ids (two trials → same disease is fine, same type+from+to is not)
  const seen = new Set<string>();
  graph.edges = graph.edges.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

/**
 * Removes disease nodes reachable only through indicated_for edges when they are generic: fewer than
 * MIN_ANCESTORS ancestors in Open Targets, or unknown to Open Targets and matching GENERIC_NAMES.
 * Nodes linked from the candidate or marked as the query disease are kept and get meta.generic = true.
 * Returns the labels dropped (for logging and checks).
 */
export async function pruneGenericIndicationDiseases(graph: GraphResult, candidateId: string | null): Promise<string[]> {
  const linkedBy = (d: GraphNode, type: string) => graph.edges.some((e) => e.type === type && (e.to === d.id || e.from === d.id));
  const indicationOnly = graph.nodes.filter(
    (d) => d.type === "disease" && !d.isQueryDisease && d.id !== QUERY_DISEASE_ID && !linkedBy(d, "associated_with") && linkedBy(d, "indicated_for"),
  );
  if (!indicationOnly.length) return [];
  const counts = await diseaseAncestorCounts(indicationOnly.map((d) => parseNodeId(d.id)!.key));
  const dropped: string[] = [];
  const remove = new Set<string>();
  for (const d of indicationOnly) {
    const key = parseNodeId(d.id)!.key;
    const n = counts.get(key);
    const generic = n != null ? n < MIN_ANCESTORS : GENERIC_NAMES.test(normName(d.label));
    if (!generic) {
      if (n != null) d.meta = { ...d.meta, nAncestors: n };
      continue;
    }
    const candidateLinked = candidateId != null && graph.edges.some((e) => e.type === "indicated_for" && e.from === candidateId && e.to === d.id);
    if (candidateLinked) {
      d.meta = { ...d.meta, generic: true, nAncestors: n ?? null };
      continue;
    }
    remove.add(d.id);
    dropped.push(d.label);
  }
  if (remove.size) {
    graph.nodes = graph.nodes.filter((n) => !remove.has(n.id));
    graph.edges = graph.edges.filter((e) => !remove.has(e.from) && !remove.has(e.to));
    const used = new Set([...graph.nodes.map((n) => n.source?.id), ...graph.edges.map((e) => e.source.id)]);
    graph.sources = graph.sources.filter((s) => used.has(s.id));
  }
  return dropped;
}

export const normName = (s: string) =>
  s.toLowerCase().replace(/\bcancer\b/g, "carcinoma").replace(/[^a-z0-9]+/g, " ").trim();

/** Same disease name under different ontology ids → one node; the query node wins, else the first. */
function mergeDiseasesByName(graph: GraphResult): void {
  const byName = new Map<string, GraphNode>();
  const diseases = [...graph.nodes.filter((n) => n.type === "disease")].sort((a, b) => Number(Boolean(b.isQueryDisease)) - Number(Boolean(a.isQueryDisease)));
  for (const d of diseases) {
    const names = [d.label, ...(typeof d.meta?.otName === "string" ? [d.meta.otName] : [])].map(normName);
    const keep = names.map((n) => byName.get(n)).find(Boolean);
    if (keep && keep !== d) {
      const alt = Array.isArray(keep.meta?.altIds) ? (keep.meta!.altIds as string[]) : [];
      keep.meta = { ...keep.meta, altIds: [...alt, parseNodeId(d.id)!.key] };
      renameNode(graph, d.id, keep.id);
      continue;
    }
    for (const n of names) byName.set(n, d);
  }
}

/** The SourceRef of an edge or node, for callers that only have an id. */
export function sourceOf(graph: GraphResult, id: string): SourceRef | undefined {
  return graph.sources.find((s) => s.id === id);
}
