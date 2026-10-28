// Expand-on-click (docs/KG_PRD.md R1): fetches the next hop around one node and returns only the new
// elements. Target → its Open Targets diseases; disease → its Open Targets targets and the ChEMBL drugs
// indicated for it. Every added edge carries a SourceRef (addEdge enforces it). Failures of one source
// are logged and noted, never thrown, so a partial expansion still renders.
import { getIndicationsForDisease, getMolecules, getTarget, getTargetByAccession } from "@/lib/chembl/api";
import { chemblUrl } from "@/lib/chembl/client";
import type { GraphNode, GraphResult } from "@/lib/contracts";
import { addEdge, addNode } from "./build";
import { addDiseaseAssociation, findDiseaseNode } from "./enrich";
import { edgeId, nodeId, normalizeEfo, openTargetsEvidenceUrl, parseNodeId } from "./ids";
import { diffGraphs, type GraphDelta } from "./merge";
import { associatedDiseases, associatedTargets, filterDiseaseRows, mapUniprotToEnsembl } from "./opentargets";

const EXPAND_DISEASES_PER_TARGET = 12;
const EXPAND_TARGETS_PER_DISEASE = 8;
const EXPAND_DRUGS_PER_DISEASE = 8;
const fmt = (n: number) => n.toFixed(2);
const warn = (what: string, e: unknown) => console.warn(`[kg/expand] ${what} unavailable:`, e instanceof Error ? e.message : e);

const clone = (g: GraphResult): GraphResult => ({
  ...g,
  nodes: g.nodes.map((n) => ({ ...n, meta: n.meta ? { ...n.meta } : undefined })),
  edges: g.edges.map((e) => ({ ...e, meta: e.meta ? { ...e.meta } : undefined })),
  hypotheses: [...g.hypotheses],
  sources: [...g.sources],
});

export async function expandNode(input: GraphResult, id: string): Promise<GraphDelta> {
  const node = input.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Node ${id} is not in the graph`);
  const graph = clone(input);
  const target = graph.nodes.find((n) => n.id === id)!;
  const notes: string[] = [];

  if (node.type === "target") await expandTarget(graph, target, notes);
  else if (node.type === "disease") await expandDisease(graph, target, notes);
  else notes.push(`Nodes of type "${node.type}" cannot be expanded`);

  return { ...diffGraphs(input, graph), notes };
}

/** Target → more Open Targets diseases (same PRD §5 filters, cap relaxed to 12, existing ones skipped). */
async function expandTarget(graph: GraphResult, target: GraphNode, notes: string[]): Promise<void> {
  const chemblId = typeof target.meta?.chemblId === "string" ? target.meta.chemblId : parseNodeId(target.id)?.key;
  let ensemblId = typeof target.meta?.ensemblId === "string" ? target.meta.ensemblId : null;
  let symbol = typeof target.meta?.symbol === "string" ? target.meta.symbol : target.label;
  try {
    if (!ensemblId && chemblId && chemblId.startsWith("CHEMBL")) {
      const raw = await getTarget(chemblId);
      const accession = raw.target_components?.[0]?.accession ?? null;
      const mapped = accession ? (await mapUniprotToEnsembl([accession])).get(accession) : undefined;
      if (mapped) {
        ensemblId = mapped.ensemblId;
        symbol = mapped.symbol;
        target.meta = { ...target.meta, uniprot: accession, ensemblId, symbol };
      }
    }
  } catch (e) {
    warn(`target ${chemblId} mapping`, e);
  }
  if (!ensemblId) {
    notes.push(`${target.label}: no Open Targets mapping, nothing to expand`);
    return;
  }
  const query = graph.nodes.find((n) => n.isQueryDisease);
  const exclude = query ? [parseNodeId(query.id)!.key, ...((query.meta?.altIds as string[] | undefined) ?? [])] : [];
  // Diseases already linked from this target are not "new": skip them so the delta is only the next hop
  const linked = new Set(graph.edges.filter((e) => e.type === "associated_with" && e.from === target.id).map((e) => e.to));
  try {
    const rows = filterDiseaseRows((await associatedDiseases(ensemblId, 40)).rows, { excludeIds: exclude, keep: 100 });
    let added = 0;
    for (const r of rows) {
      if (added >= EXPAND_DISEASES_PER_TARGET) break;
      const existing = findDiseaseNode(graph, r.efoId, r.name);
      if (existing && linked.has(existing.id)) continue;
      addDiseaseAssociation(graph, target, { ensemblId, symbol }, r);
      added++;
    }
    if (!added) notes.push(`${target.label}: no further diseases pass the evidence filters`);
  } catch (e) {
    warn(`Open Targets diseases for ${symbol}`, e);
    notes.push(`${target.label}: Open Targets unavailable`);
  }
}

/** Disease → Open Targets targets (mapped to ChEMBL ids when possible) and ChEMBL drugs indicated for it. */
async function expandDisease(graph: GraphResult, disease: GraphNode, notes: string[]): Promise<void> {
  const ids = [parseNodeId(disease.id)!.key, ...((disease.meta?.altIds as string[] | undefined) ?? [])].map(normalizeEfo);

  // (a) targets
  try {
    const rows = await associatedTargets(ids[0], EXPAND_TARGETS_PER_DISEASE);
    for (const r of rows) {
      let targetNode = graph.nodes.find((n) => n.type === "target" && n.meta?.ensemblId === r.ensemblId);
      if (!targetNode) {
        const chembl = r.uniprot ? await getTargetByAccession(r.uniprot).catch((e) => (warn(`ChEMBL target for ${r.symbol}`, e), null)) : null;
        const key = chembl?.target_chembl_id ?? r.ensemblId;
        targetNode = addNode(graph, {
          id: nodeId("target", key),
          type: "target",
          label: chembl?.pref_name ?? r.name ?? r.symbol,
          meta: { chemblId: chembl?.target_chembl_id ?? null, organism: chembl?.organism ?? "Homo sapiens", uniprot: r.uniprot, ensemblId: r.ensemblId, symbol: r.symbol },
          source: chembl
            ? { id: `chembl-target:${chembl.target_chembl_id}`, database: "ChEMBL", label: `${chembl.pref_name} (${chembl.target_chembl_id})`, url: chemblUrl.target(chembl.target_chembl_id) }
            : { id: `ot-target:${r.ensemblId}`, database: "Open Targets", label: `${r.symbol} (${r.ensemblId})`, url: `https://platform.opentargets.org/target/${r.ensemblId}` },
        });
      }
      const sub = Object.fromEntries(Object.entries(r.datatypeScores).map(([k, v]) => [`ot_${k}`, Number(v.toFixed(3))]));
      addEdge(graph, {
        id: edgeId("associated_with", targetNode.id, disease.id),
        type: "associated_with",
        from: targetNode.id,
        to: disease.id,
        kind: "computed",
        strength: r.score,
        label: `Open Targets association ${fmt(r.score)}`,
        meta: { score: Number(r.score.toFixed(3)), ...sub, ensemblId: r.ensemblId },
        source: {
          id: `ot-assoc:${r.ensemblId}:${ids[0]}`,
          database: "Open Targets",
          label: `${r.symbol} – ${disease.label} (Open Targets)`,
          url: openTargetsEvidenceUrl(r.ensemblId, ids[0]),
        },
      });
    }
  } catch (e) {
    warn(`Open Targets targets for ${disease.label}`, e);
    notes.push(`${disease.label}: Open Targets targets unavailable`);
  }

  // (b) drugs indicated for it (ChEMBL only knows EFO ids, in the colon form)
  const efo = ids.find((i) => i.startsWith("EFO_"));
  if (!efo) {
    notes.push(`${disease.label}: no EFO id (only ${ids.join(", ")}), ChEMBL indications skipped`);
    return;
  }
  try {
    const rows = await getIndicationsForDisease(efo.replace("_", ":"));
    const best = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const prev = best.get(r.parent_molecule_chembl_id);
      if (!prev || Number(r.max_phase_for_ind ?? 0) > Number(prev.max_phase_for_ind ?? 0)) best.set(r.parent_molecule_chembl_id, r);
    }
    const top = [...best.values()]
      .sort((a, b) => Number(b.max_phase_for_ind ?? 0) - Number(a.max_phase_for_ind ?? 0))
      .filter((r) => !graph.edges.some((e) => e.type === "indicated_for" && e.from === nodeId("drug", r.parent_molecule_chembl_id) && e.to === disease.id))
      .slice(0, EXPAND_DRUGS_PER_DISEASE);
    const mols = await getMolecules(top.map((r) => r.parent_molecule_chembl_id));
    for (const r of top) {
      const m = mols.find((x) => x.molecule_chembl_id === r.parent_molecule_chembl_id);
      const name = m?.pref_name?.replace(/(\s+(ANHYDROUS|HYDROCHLORIDE|MESYLATE|MALEATE|DIMALEATE|TOSYLATE|MONOHYDRATE|HYDRATE|SODIUM))+$/i, "") || r.parent_molecule_chembl_id;
      const drug = addNode(graph, {
        id: nodeId("drug", r.parent_molecule_chembl_id),
        type: "drug",
        label: name,
        meta: { chemblId: r.parent_molecule_chembl_id, maxPhase: m?.max_phase != null ? Number(m.max_phase) : null, n: 0, viaExpand: true },
        source: { id: `chembl-mol:${r.parent_molecule_chembl_id}`, database: "ChEMBL", label: `${name} (${r.parent_molecule_chembl_id})`, url: chemblUrl.compound(r.parent_molecule_chembl_id) },
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
        source: { id: `chembl-ind:${r.drugind_id}`, database: "ChEMBL", label: `${name} indication: ${r.efo_term ?? disease.label}`, url: chemblUrl.compound(r.molecule_chembl_id) },
      });
    }
  } catch (e) {
    warn(`ChEMBL indications for ${disease.label}`, e);
    notes.push(`${disease.label}: ChEMBL indications unavailable`);
  }
}
