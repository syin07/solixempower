import type { BenchmarkResult } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";
import { Section } from "./Section";

/** ChEMBL regulatory drug warnings (black box / withdrawn) for the candidate and shown comparators. */
export function DrugWarningsPanel({ benchmark }: { benchmark: BenchmarkResult }) {
  const warnings = benchmark.drugWarnings;
  if (!warnings) return null;
  const name = benchmark.candidate.compound.name;
  const forCandidate = warnings.some((w) => w.isCandidate);
  return (
    <Section title={`Safety: drug warnings (${warnings.length})`} aside={<EvidenceBadge kind="clinical" />}>
      <p className="mb-3 text-sm text-zinc-600">
        Regulatory warnings recorded in ChEMBL for the candidate and the comparators shown. A comparator&apos;s warning describes that
        drug, not the candidate.
      </p>
      {!forCandidate && (
        <p className="mb-3 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          None recorded for {name}. For an investigational compound this is not evidence of safety.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-2">
          {warnings.map((w) => (
            <li
              key={w.source.id}
              className={`rounded-md border px-3 py-2 text-sm ${w.isCandidate ? "border-blue-300 bg-blue-50" : "border-zinc-200"}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-zinc-900">{w.compoundName}</span>
                <a href={w.source.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-blue-700 underline">
                  {w.source.id}
                </a>
              </div>
              <div className="text-zinc-800">
                {w.warningType}
                {w.warningClass ? `: ${w.warningClass}` : ""}
              </div>
              {(w.country || w.year) && <div className="text-xs text-zinc-500">{[w.country, w.year].filter(Boolean).join(", ")}</div>}
              {w.description && <div className="mt-1 text-xs text-zinc-600">{w.description}</div>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
