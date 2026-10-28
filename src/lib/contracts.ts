// Shared API contracts. Owner: Sandy — announce any change in team chat.
// Gavin's UI and Medhansh's routes both code against these shapes; stubs in
// src/app/api/* return src/fixtures/*.json in exactly these shapes.

export type Database = "ChEMBL" | "ClinicalTrials.gov" | "PubChem";

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

/** GET /api/benchmark?candidate=&disease=&target= */
export interface BenchmarkResult {
  query: { candidate: string; disease: string; targetChemblId?: string };
  target: Target;
  activityType: ActivityType;
  candidate: CompoundBenchmark;
  comparators: CompoundBenchmark[];
  matchedAssays: MatchedAssay[];
  warnings: string[];
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
