// Id helpers for the evidence graph (docs/KG_PRD.md §4). Ids are "<type>:<key>" so the agent and the
// UI can parse them without a lookup.
import type { GraphNodeType } from "@/lib/contracts";

export const nodeId = (type: GraphNodeType, key: string) => `${type}:${key}`;

/** "e:<type>:<from>:<to>" — unique per (type, from, to); a drug–target pair may have several edge types. */
export const edgeId = (type: string, from: string, to: string) => `e:${type}:${from}:${to}`;

/** Parses "drug:CHEMBL941" → { type: "drug", key: "CHEMBL941" }; null if not an id we produce. */
export function parseNodeId(id: string): { type: GraphNodeType; key: string } | null {
  const i = id.indexOf(":");
  if (i <= 0) return null;
  const type = id.slice(0, i) as GraphNodeType;
  const key = id.slice(i + 1);
  return key ? { type, key } : null;
}

/**
 * Normalizes an ontology id to the underscore form used by Open Targets: "EFO:0000768" → "EFO_0000768",
 * "MONDO:0005233" → "MONDO_0005233". Already-normalized ids pass through unchanged.
 */
export const normalizeEfo = (id: string) => id.trim().replace(/^([A-Za-z]+)[:_]/, (_, p: string) => `${p.toUpperCase()}_`);

/** Open Targets evidence page for a target–disease pair (the SourceRef url of associated_with edges). */
export const openTargetsEvidenceUrl = (ensemblId: string, efoId: string) =>
  `https://platform.opentargets.org/evidence/${ensemblId}/${normalizeEfo(efoId)}`;

// Checks (run mentally or in a REPL):
//   normalizeEfo("EFO:0000768") === "EFO_0000768"
//   normalizeEfo("MONDO_0005233") === "MONDO_0005233"
//   parseNodeId("trial:NCT00131274") → { type: "trial", key: "NCT00131274" }
//   edgeId("measured_against", "drug:CHEMBL941", "target:CHEMBL2007") === "e:measured_against:drug:CHEMBL941:target:CHEMBL2007"
