"use client";

import { useState } from "react";
import type { BenchmarkResult, CompoundBenchmark } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";
import { Section } from "./Section";
import { phaseLabel } from "./sources";

const CANDIDATE = "#2a78d6";
const COMPARATOR = "#898781";

/** Range (min–max) bar + median dot per compound on one pChEMBL axis; candidate highlighted. */
export function PotencyChart({ benchmark }: { benchmark: BenchmarkResult }) {
  const [hover, setHover] = useState<string | null>(null);
  const all = [benchmark.candidate, ...benchmark.comparators];
  const ranked = all.filter((c) => c.n > 0).sort((a, b) => a.rank - b.rank);
  const unranked = all.filter((c) => c.n === 0);

  if (ranked.length === 0)
    return (
      <Section title="Potency benchmark">
        <p className="text-sm text-zinc-600">No comparable measurements on this target.</p>
      </Section>
    );

  const values = ranked.flatMap((c) => [c.minPchembl, c.maxPchembl]);
  const lo = Math.floor(Math.min(...values)) - 0.5;
  const hi = Math.ceil(Math.max(...values)) + 0.5;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo); t <= hi; t++) ticks.push(t);

  const cand = benchmark.candidate;
  const headline =
    cand.n > 0
      ? `${cand.compound.name} ranks #${cand.rank} of ${ranked.length} by median pChEMBL`
      : `${cand.compound.name} has no comparable measurements on this target`;

  return (
    <Section title="Potency benchmark" aside={<EvidenceBadge kind="measured" />}>
      <p className="text-base font-semibold text-zinc-900">{headline}</p>
      <p className="mb-4 mt-1 text-sm text-zinc-600">
        Only comparable data is ranked: {benchmark.activityType}, binding assays, exact (=) values, human {benchmark.target.name}{" "}
        wild-type. Bar = range, dot = median, ticks = individual measurements.
      </p>

      <div className="flex flex-col">
        {ranked.map((c) => (
          <Row key={c.compound.chemblId} c={c} x={x} hovered={hover === c.compound.chemblId} onHover={setHover} />
        ))}
        {/* axis */}
        <div className="grid grid-cols-[17rem_1fr] gap-3">
          <div />
          <div className="relative h-6 border-t border-zinc-300">
            {ticks.map((t) => (
              <span key={t} className="absolute top-1 -translate-x-1/2 text-xs text-zinc-500" style={{ left: x(t) }}>
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[17rem_1fr] gap-3">
          <div />
          <div className="text-center text-xs font-medium text-zinc-600">pChEMBL (higher = more potent) →</div>
        </div>
      </div>

      {unranked.length > 0 && (
        <p className="mt-3 text-xs text-zinc-500">
          Not ranked (no comparable measurements): {unranked.map((c) => c.compound.name).join(", ")}
        </p>
      )}
    </Section>
  );
}

function Row({
  c,
  x,
  hovered,
  onHover,
}: {
  c: CompoundBenchmark;
  x: (v: number) => string;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const color = c.compound.isCandidate ? CANDIDATE : COMPARATOR;
  const id = c.compound.chemblId;
  return (
    <div
      className={`grid grid-cols-[17rem_1fr] items-center gap-3 rounded ${c.compound.isCandidate ? "bg-blue-50" : hovered ? "bg-zinc-50" : ""}`}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-center gap-1.5 truncate py-1.5 pl-2 text-sm">
        <span className="w-7 shrink-0 text-right font-mono text-xs text-zinc-500">#{c.rank}</span>
        <a
          href={c.compound.source.url}
          target="_blank"
          rel="noreferrer"
          className={`truncate hover:underline ${c.compound.isCandidate ? "font-bold text-blue-800" : "text-zinc-800"}`}
        >
          {c.compound.name}
        </a>
        {c.compound.maxPhase === 4 && (
          <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] font-semibold uppercase text-zinc-700">Approved</span>
        )}
        <span className="shrink-0 text-xs text-zinc-500">n={c.n}</span>
      </div>
      <div className="relative h-8">
        {/* range bar */}
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-40"
          style={{ left: x(c.minPchembl), width: `calc(${x(c.maxPchembl)} - ${x(c.minPchembl)})`, minWidth: 2, background: color }}
        />
        {/* individual measurements */}
        {c.measurements.map((m) => (
          <span
            key={m.source.id}
            className="absolute top-1/2 h-3 w-px -translate-y-1/2"
            style={{ left: x(m.pchembl), background: color }}
          />
        ))}
        {/* median */}
        <span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
          style={{ left: x(c.medianPchembl), background: color }}
        />
        {hovered && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs text-white shadow"
            style={{ left: x(c.medianPchembl) }}
          >
            <div className="font-semibold">
              {c.compound.name} · {phaseLabel(c.compound.maxPhase)}
            </div>
            median {c.medianPchembl.toFixed(2)} · range {c.minPchembl.toFixed(2)}–{c.maxPchembl.toFixed(2)} · n={c.n}
          </div>
        )}
      </div>
    </div>
  );
}
