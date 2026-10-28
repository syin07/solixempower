import type { BenchmarkResult, SourceRef, TrialsResult } from "@/lib/contracts";

/** Every SourceRef the UI has retrieved, keyed by id, so report citations resolve to clickable links. */
export function indexSources(benchmark: BenchmarkResult | null, trials: TrialsResult | null): Map<string, SourceRef> {
  const index = new Map<string, SourceRef>();
  const add = (ref: SourceRef | undefined) => ref && index.set(ref.id, ref);
  if (benchmark) {
    add(benchmark.target.source);
    for (const cb of [benchmark.candidate, ...benchmark.comparators]) {
      add(cb.compound.source);
      cb.measurements.forEach((m) => add(m.source));
    }
    benchmark.matchedAssays.forEach((a) => a.rows.forEach((r) => add(r.source)));
    benchmark.preclinical?.forEach((a) => add(a.source));
    benchmark.drugWarnings?.forEach((w) => add(w.source));
  }
  trials?.trials.forEach((t) => add(t.source));
  return index;
}

export function phaseLabel(maxPhase: number | null): string {
  if (maxPhase === 4) return "Approved";
  if (maxPhase == null || maxPhase <= 0) return "Preclinical";
  return `Phase ${Number.isInteger(maxPhase) ? maxPhase : maxPhase.toFixed(1)}`;
}
