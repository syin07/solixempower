import type { BenchmarkResult } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";
import { Section } from "./Section";

export function MatchedAssayTable({ benchmark }: { benchmark: BenchmarkResult }) {
  const candidateId = benchmark.candidate.compound.chemblId;
  return (
    <Section title="Measured in the same assay" aside={<EvidenceBadge kind="measured" />}>
      <p className="mb-3 text-sm text-zinc-600">
        Candidate and comparator tested side by side in one assay: same lab and protocol. This is the strongest comparison available.
      </p>
      {benchmark.matchedAssays.length === 0 ? (
        <p className="text-sm text-zinc-500">No assay measured the candidate alongside a comparator.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {benchmark.matchedAssays.map((a) => {
            const cand = a.rows.find((r) => r.compoundChemblId === candidateId);
            const rows = [...a.rows].sort((p, q) => q.pchembl - p.pchembl);
            return (
              <div key={a.assayChemblId} className="overflow-hidden rounded-md border border-zinc-200">
                <div className="bg-zinc-50 px-3 py-2 text-sm">
                  <a
                    href={`https://www.ebi.ac.uk/chembl/explore/assay/${a.assayChemblId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-blue-700 underline"
                  >
                    {a.assayChemblId}
                  </a>
                  <span className="ml-2 text-zinc-700">{a.assayDescription}</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-zinc-500">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Compound</th>
                      <th className="px-3 py-1.5 text-right font-medium">pChEMBL</th>
                      <th className="px-3 py-1.5 text-right font-medium">vs candidate</th>
                      <th className="px-3 py-1.5 text-right font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const isCand = r.compoundChemblId === candidateId;
                      const diff = cand && !isCand ? r.pchembl - cand.pchembl : null;
                      return (
                        <tr key={r.source.id} className={`border-t border-zinc-100 ${isCand ? "bg-blue-50 font-semibold" : ""}`}>
                          <td className="px-3 py-1.5">{r.compoundName}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{r.pchembl.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-zinc-600">
                            {isCand ? "—" : diff == null ? "" : `${diff > 0 ? "+" : ""}${diff.toFixed(2)}`}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <a href={r.source.url} target="_blank" rel="noreferrer" className="text-xs text-blue-700 underline">
                              {r.source.id}
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
