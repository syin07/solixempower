// Shared API contracts. Owner: Sandy — announce any change in team chat.
// Gavin's UI and Medhansh's routes both code against these shapes; stubs in
// src/app/api/* return src/fixtures/*.json in exactly these shapes.

export type Database = "ChEMBL" | "ClinicalTrials.gov" | "PubChem" | "Open Targets";

/** Every route returns this with a 4xx/5xx status on failure. Show `error` to the user. */
export interface ApiError {
  error: string;
}

/** How a fact was obtained. The UI must render each kind visibly differently. */
export type EvidenceKind = "measured" | "computed" | "clinical" | "ai_summary";

export interface SourceRef {
  /** Stable id the AI report cites, e.g. "chembl-act:1234567" or "nct:NCT01234567" */
  id: string;
  database: Database;
  label: string;
  url: string;
}

export interface Compound {
  chemblId: string;
  name: string;
  /** 4 = approved, 1–3 = clinical phase, null = preclinical/unknown */
  maxPhase: number | null;
  isCandidate: boolean;
  /** Computed by ChEMBL — EvidenceKind "computed", never "measured" */
  properties?: {
    molecularWeight?: number;
    alogp?: number;
    ro5Violations?: number;
    qed?: number;
  };
  source: SourceRef;
}

export interface Target {
  chemblId: string;
  name: string;
  organism: string;
  source: SourceRef;
}

export type ActivityType = "IC50" | "EC50" | "Ki" | "Kd";

export interface Measurement {
  compoundChemblId: string;
  assayChemblId: string;
  assayDescription: string;
  /** B = binding, F = functional, A = ADME, T = toxicity */
  assayType: "B" | "F" | "A" | "T";
  activityType: ActivityType;
  valueNm: number;
  /** -log10(molar). Higher = more potent. */
  pchembl: number;
  source: SourceRef;
}

/**
 * When `n === 0` (no comparable measurements), medianPchembl/minPchembl/maxPchembl/rank are 0
 * placeholders — do not plot or rank them.
 */
export interface CompoundBenchmark {
  compound: Compound;
  n: number;
  medianPchembl: number;
  minPchembl: number;
  maxPchembl: number;
  /** 1 = most potent among compared compounds */
  rank: number;
  measurements: Measurement[];
}

/** Candidate and comparator(s) measured in the SAME assay — the strongest comparison. */
export interface MatchedAssay {
  assayChemblId: string;
  assayDescription: string;
  rows: { compoundChemblId: string; compoundName: string; pchembl: number; source: SourceRef }[];
}

/**
 * Preclinical layer (PRD §3 B): one of the candidate's functional (F) or cell-/organism-based binding
 * assay results, on any target or cell line. EvidenceKind "measured". These formats are NOT comparable
 * to the binding ranking or to each other — show them as a separate, unranked list.
 */
export interface PreclinicalAssay {
  assayChemblId: string;
  assayDescription: string;
  /** F = functional; B = binding measured in a cell-based / organism-based format */
  assayType: "B" | "F";
  /** ChEMBL BAO format label, e.g. "cell-based format", "organism-based format" */
  assayFormat?: string;
  /** ChEMBL standard_type as recorded, e.g. "IC50", "GI50", "Inhibition" */
  activityType: string;
  /** "=", "<", ">", … — censored values are shown as recorded */
  relation: string | null;
  value: number | null;
  units: string | null;
  /** Present only when ChEMBL could normalize the value */
  pchembl?: number;
  /** Target or cell line as recorded by ChEMBL, e.g. "A-431" or "Epidermal growth factor receptor" */
  targetName?: string;
  targetOrganism?: string;
  year?: number;
  source: SourceRef;
}

/**
 * Safety layer: a ChEMBL regulatory drug warning (e.g. black box, withdrawn) for the candidate or a
 * shown comparator. A regulatory/clinical record — EvidenceKind "clinical", not "measured".
 */
export interface DrugWarning {
  compoundChemblId: string;
  compoundName: string;
  isCandidate: boolean;
  /** e.g. "Black Box Warning", "Withdrawn" */
  warningType: string;
  /** e.g. "hepatotoxicity" */
  warningClass?: string;
  description?: string;
  country?: string;
  year?: number;
  /** id "chembl-warn:<warning_id>"; url = the label/reference when ChEMBL has one, else the compound page */
  source: SourceRef;
}

/** GET /api/benchmark?candidate=&disease=&target= */
export interface BenchmarkResult {
  query: { candidate: string; disease: string; targetChemblId?: string };
  target: Target;
  activityType: ActivityType;
  candidate: CompoundBenchmark;
  comparators: CompoundBenchmark[];
  matchedAssays: MatchedAssay[];
  warnings: string[];
  /**
   * For the target dropdown: the candidate's human single-protein targets ranked by measurement
   * count (IC50/Ki/Kd/EC50 rows with a pChEMBL value), top ~5, always including the selected target.
   * Pass `chemblId` back as `target=` to switch.
   */
  candidateTargets?: { chemblId: string; name: string; n: number }[];
  /** Candidate's functional / cell-based assay results, up to ~20, unranked. Absent if not retrieved. */
  preclinical?: PreclinicalAssay[];
  /** ChEMBL drug warnings for the candidate + shown comparators. Absent if not retrieved; [] = none recorded. */
  drugWarnings?: DrugWarning[];
  isMock?: boolean;
}

export interface Trial {
  nctId: string;
  title: string;
  phase: string;
  status: string;
  conditions: string[];
  interventions: string[];
  enrollment: number | null;
  hasResults: boolean;
  primaryOutcomes: string[];
  startDate: string | null;
  source: SourceRef;
}

/** GET /api/trials?disease=&drugs=a,b,c */
export interface TrialsResult {
  query: { disease: string; drugs: string[] };
  trials: Trial[];
  isMock?: boolean;
}

export interface ReportClaim {
  text: string;
  kind: EvidenceKind;
  /** Must reference SourceRef.id values present in the request payload */
  sourceIds: string[];
}

export type EvidenceLayer = "molecular" | "preclinical" | "clinical" | "safety";

/** POST /api/report  body: { benchmark: BenchmarkResult, trials: TrialsResult } */
export interface EvidenceReport {
  verdict: "promising" | "mixed" | "insufficient_evidence" | "unfavorable";
  headline: string;
  sections: { layer: EvidenceLayer; summary: string; claims: ReportClaim[] }[];
  openQuestions: string[];
  nextSteps: string[];
  isMock?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Evidence graph (docs/KG_PRD.md §4). Built per query from the retrieved evidence; every edge is a
// record with a SourceRef. Owner: Sandy. Hypotheses are generated by code (src/lib/kg/hypotheses.ts).
// ---------------------------------------------------------------------------------------------

export type GraphNodeType = "drug" | "target" | "disease" | "trial" | "route" | "warning" | "hypothesis";

/** An EvidenceKind, or "absent" for a "checked, not found" edge (query + date in meta). */
export type GraphEdgeKind = EvidenceKind | "absent";

export type GraphMeta = Record<string, string | number | boolean | string[] | null>;

/** Ids are prefixed by type, e.g. "drug:CHEMBL941", "target:CHEMBL2007", "disease:EFO_0000768", "trial:NCT00131274". */
export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  isCandidate?: boolean;
  isQueryDisease?: boolean;
  meta?: GraphMeta;
  source?: SourceRef;
}

/**
 * Edge types: measured_against, mechanism, indicated_for, tested_in, for_disease, associated_with,
 * administered_by, has_warning, absent. `strength` is only comparable within one edge type.
 */
export interface GraphEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  strength?: number;
  label: string;
  meta?: GraphMeta;
  source: SourceRef;
}

export type HypothesisTemplate = "target_hop" | "comparator_hop" | "off_target_hop" | "route_hop" | "query_disease";
/** no_path: the query-disease card when no target-level path reaches the disease */
export type HypothesisStatus = "proposed" | "already_indicated" | "already_tested" | "no_path";

/** One row of the evidence ladder: shown separately per kind, never summed. */
export interface LadderRow {
  kind: GraphEdgeKind;
  label: string;
  value: string;
  sourceIds: string[];
}

export interface Hypothesis {
  id: string;
  template: HypothesisTemplate;
  status: HypothesisStatus;
  /** One sentence, e.g. "Imatinib could be repurposed for idiopathic pulmonary fibrosis via PDGFRA" */
  statement: string;
  drugId: string;
  targetId: string;
  diseaseId: string;
  /** GraphEdge ids forming the path; every id must exist in GraphResult.edges */
  pathEdgeIds: string[];
  ladder: LadderRow[];
  suggestedTest: string;
  /** SourceRef ids the report may cite for this hypothesis */
  sourceIds: string[];
}

/** POST /api/graph  body: { benchmark: BenchmarkResult, trials?: TrialsResult } */
export interface GraphResult {
  query: BenchmarkResult["query"];
  nodes: GraphNode[];
  edges: GraphEdge[];
  hypotheses: Hypothesis[];
  /** ISO timestamp of the build (shown in the provenance line) */
  builtAt: string;
  /** Every SourceRef referenced by a node, edge or hypothesis, for citation lookup */
  sources: SourceRef[];
  isMock?: boolean;
}
