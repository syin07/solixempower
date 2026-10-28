import type { BenchmarkResult } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";
import { phaseLabel } from "./sources";

export function CompoundCard({
  benchmark,
  busy,
  onTargetChange,
}: {
  benchmark: BenchmarkResult;
  busy: boolean;
  onTargetChange: (targetChemblId: string) => void;
}) {
  const { compound, n } = benchmark.candidate;
  const { target } = benchmark;
  const p = compound.properties;
  const props: [string, string | undefined][] = [
    ["Mol. weight", p?.molecularWeight?.toFixed(1)],
    ["AlogP", p?.alogp?.toFixed(2)],
    ["Ro5 violations", p?.ro5Violations?.toString()],
    ["QED", p?.qed?.toFixed(2)],
  ];
  const targets = benchmark.candidateTargets ?? [];

  return (
    <section className="grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_1fr]">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Candidate</div>
        <h2 className="mt-1 text-2xl font-bold text-zinc-900">{compound.name}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <a href={compound.source.url} target="_blank" rel="noreferrer" className="font-mono text-blue-700 underline">
            {compound.chemblId}
          </a>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-white">{phaseLabel(compound.maxPhase)}</span>
          <span className="text-zinc-600">
            {n} comparable {benchmark.activityType} measurement{n === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-700">
            Properties <EvidenceBadge kind="computed" />
            <span className="text-xs font-normal text-zinc-500">calculated by ChEMBL, not measured</span>
          </div>
          <dl className="grid grid-cols-4 gap-2">
            {props.map(([label, value]) => (
              <div key={label} className="rounded border border-dashed border-violet-300 px-2 py-1.5">
                <dt className="text-[11px] text-zinc-500">{label}</dt>
                <dd className="font-mono text-sm text-zinc-900">{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Target</div>
        <h3 className="mt-1 text-xl font-semibold text-zinc-900">{target.name}</h3>
        <div className="mt-2 flex flex-wrap gap-2 text-sm text-zinc-600">
          <a href={target.source.url} target="_blank" rel="noreferrer" className="font-mono text-blue-700 underline">
            {target.chemblId}
          </a>
          <span>{target.organism}</span>
        </div>
        {targets.length > 1 && (
          <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Switch target
            <select
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
              value={target.chemblId}
              disabled={busy}
              onChange={(e) => onTargetChange(e.target.value)}
            >
              {targets.map((t) => (
                <option key={t.chemblId} value={t.chemblId}>
                  {t.name} ({t.chemblId}) — {t.n} measurement{t.n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="mt-3 text-xs text-zinc-500">
          Auto-selected from the candidate&apos;s recorded mechanism or most-measured human single-protein target.
        </p>
      </div>
    </section>
  );
}
