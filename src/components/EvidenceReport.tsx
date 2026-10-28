import type { EvidenceLayer, EvidenceReport as Report, SourceRef } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";
import { MockBanner } from "./MockBanner";
import { Section } from "./Section";

const VERDICT: Record<Report["verdict"], { label: string; className: string }> = {
  promising: { label: "Promising", className: "bg-emerald-600 text-white" },
  mixed: { label: "Mixed", className: "bg-amber-400 text-amber-950" },
  insufficient_evidence: { label: "Insufficient evidence", className: "bg-zinc-500 text-white" },
  unfavorable: { label: "Unfavorable", className: "bg-red-600 text-white" },
};

const LAYER: Record<EvidenceLayer, string> = {
  molecular: "Molecular potency",
  preclinical: "Preclinical (functional assays)",
  clinical: "Clinical landscape",
  safety: "Safety & properties",
};

export function EvidenceReport({ report, sources }: { report: Report; sources: Map<string, SourceRef> }) {
  const v = VERDICT[report.verdict];
  return (
    <Section title="AI evidence report" aside={<EvidenceBadge kind="ai_summary" />}>
      {report.isMock && (
        <div className="mb-3">
          <MockBanner what="this report" />
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold uppercase tracking-wide ${v.className}`}>{v.label}</span>
        <p className="text-base font-medium text-zinc-900">{report.headline}</p>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Written by Claude from the retrieved evidence only. Every claim cites its source. Click a chip to open the record.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {report.sections.map((s) => (
          <div key={s.layer} className={`rounded-md border border-zinc-200 p-4 ${s.layer === "molecular" ? "lg:col-span-3" : ""}`}>
            <h3 className="font-semibold text-zinc-900">{LAYER[s.layer] ?? s.layer}</h3>
            <p className="mt-1 text-sm text-zinc-700">{s.summary}</p>
            {s.claims.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2.5">
                {s.claims.map((c, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-start gap-2">
                      <EvidenceBadge kind={c.kind} />
                      <span className="text-zinc-800">{c.text}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 pl-1">
                      {c.sourceIds.map((id) => (
                        <SourceChip key={id} id={id} source={sources.get(id)} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {(report.openQuestions.length > 0 || report.nextSteps.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <List title="Open questions" items={report.openQuestions} />
          <List title="Suggested next steps" items={report.nextSteps} />
        </div>
      )}
    </Section>
  );
}

function SourceChip({ id, source }: { id: string; source?: SourceRef }) {
  if (!source)
    return (
      <span title="This ID was not in the retrieved evidence" className="rounded border border-red-400 bg-red-50 px-1.5 py-0.5 font-mono text-[11px] text-red-700">
        unverified: {id}
      </span>
    );
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={`${source.database}: ${source.label}`}
      className="max-w-56 truncate rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-blue-700 hover:border-blue-500 hover:bg-blue-50"
    >
      {id}
    </a>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <ul className="mt-1 list-disc pl-5 text-sm text-zinc-700">
        {items.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
    </div>
  );
}
