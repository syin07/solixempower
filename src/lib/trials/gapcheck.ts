// Gap check (docs/KG_PRD.md §5): has this drug been trialed for this disease at all? One small
// ClinicalTrials.gov query per (drug, disease) pair, interventional studies only. Responses are cached
// by ctgovStudies (memory + .cache/trials, stale served on failure), so repeat checks are free.
import { ctgovStudies, ctgovStudyUrl } from "./client";
import { formatPhase, formatStatus } from "./index";

export interface CheckedTrial {
  nctId: string;
  title: string;
  /** "Phase 2/3", "N/A", … (same strings as Trial.phase) */
  phase: string;
  status: string;
  hasResults: boolean;
  url: string;
}

export interface TrialCheck {
  /** Up to 3 NCT ids, empty when nothing was found */
  nctIds: string[];
  /** The same studies with the fields needed for a trial node */
  trials: CheckedTrial[];
  /** What was searched, shown on "not found" edges (PRD §9: state the query) */
  query: string;
  /** ISO timestamp of the check */
  checkedAt: string;
  /** Total matching studies reported by ClinicalTrials.gov (may exceed nctIds.length) */
  totalCount: number;
  /** The same search on the ClinicalTrials.gov website, for an "open search" link */
  url: string;
  /** false when no search was possible (e.g. the compound has no name); absence then says nothing about trials */
  trialSearched?: boolean;
}

const PAGE_SIZE = 3;

export async function hasTrialFor(drugName: string, diseaseName: string): Promise<TrialCheck> {
  const drug = drugName.trim();
  const disease = diseaseName.trim();
  const page = await ctgovStudies({
    "query.intr": drug,
    "query.cond": disease,
    "filter.advanced": "AREA[StudyType]INTERVENTIONAL",
    countTotal: "true",
    pageSize: PAGE_SIZE,
    fields: "NCTId,BriefTitle,Phase,OverallStatus,HasResults",
  });
  const trials: CheckedTrial[] = [];
  for (const s of page.studies ?? []) {
    const p = s.protocolSection;
    const nctId = p?.identificationModule?.nctId;
    if (!nctId) continue;
    trials.push({
      nctId,
      title: p.identificationModule?.briefTitle?.trim() || nctId,
      phase: formatPhase(p.designModule?.phases),
      status: formatStatus(p.statusModule?.overallStatus),
      hasResults: s.hasResults === true,
      url: ctgovStudyUrl(nctId),
    });
  }
  return {
    nctIds: trials.map((t) => t.nctId),
    trials,
    query: `ClinicalTrials.gov interventional studies: intervention "${drug}" × condition "${disease}"`,
    checkedAt: new Date().toISOString(),
    totalCount: page.totalCount ?? trials.length,
    url: `https://clinicaltrials.gov/search?${new URLSearchParams({ intr: drug, cond: disease, aggFilters: "studyType:int" })}`,
  };
}
