import type { BenchmarkResult } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";
import { Section } from "./Section";

/** Candidate's functional / cell-based results (PRD §3 layer B): a separate, unranked list. */
export function PreclinicalTable({ benchmark }: { benchmark: BenchmarkResult }) {
  const rows = benchmark.preclinical;
  if (!rows) return null;
  return (
    <Section title={`Preclinical: functional & cell-based assays (${rows.length})`} aside={<EvidenceBadge kind="measured" />}>
      <p className="mb-3 text-sm text-zinc-600">
        {benchmark.candidate.compound.name} in functional and cell-based assays, newest first.{" "}
        <span className="font-semibold text-zinc-800">
          Not comparable to the potency ranking (different assay formats, cell systems and readouts) and not ranked.
        </span>
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No functional or cell-based measurements of the candidate were found in ChEMBL.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-md border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Assay</th>
                <th className="px-3 py-2 font-medium">Cell line / target</th>
                <th className="px-3 py-2 font-medium">Readout</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-right font-medium">pChEMBL</th>
                <th className="px-3 py-2 text-right font-medium">Year</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.source.id} className="border-t border-zinc-100 align-top">
                  <td className="px-3 py-2">
                    <a href={a.source.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-700 underline">
                      {a.assayChemblId}
                    </a>
                    <span className="ml-1.5 text-[11px] text-zinc-500">
                      {a.assayType === "F" ? "functional" : "binding"}
                      {a.assayFormat ? `, ${a.assayFormat.replace(/ format$/, "")}` : ""}
                    </span>
                    <div className="text-zinc-800">{a.assayDescription}</div>
                  </td>
                  <td className="px-3 py-2 text-zinc-700">{a.targetName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{a.activityType}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                    {a.value == null ? "—" : `${a.relation && a.relation !== "=" ? `${a.relation} ` : ""}${a.value} ${a.units ?? ""}`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{a.pchembl?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-zinc-600">{a.year ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
