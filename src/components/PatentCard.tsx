"use client";

// "Can you own it?" — IP status for the candidate from the FDA Orange Book (approved drugs) or PubChem
// patent cross-references (unapproved compounds). Reads the candidate's "patent" satellite node.
import type { GraphNode, GraphResult } from "@/lib/contracts";
import { EvidenceBadge } from "./EvidenceBadge";

interface PatentRow {
  patentNo: string;
  expires: string;
  useCode?: string;
  substance: boolean;
  product: boolean;
}

function patentRows(node: GraphNode): PatentRow[] {
  const raw = Array.isArray(node.meta?.patents) ? (node.meta!.patents as string[]) : [];
  return raw.map((s) => {
    const [patentNo, expires, useCode, substance, product] = s.split("|");
    return { patentNo, expires, useCode: useCode || undefined, substance: substance === "1", product: product === "1" };
  });
}

const num = (v: unknown) => (typeof v === "number" ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const claim = (p: PatentRow) =>
  p.substance ? "substance" : p.useCode ? `method of use (${p.useCode})` : p.product ? "product / formulation" : "—";

export function PatentCard({ graph }: { graph: GraphResult }) {
  const candidate = graph.nodes.find((n) => n.type === "drug" && n.isCandidate);
  const edge = graph.edges.find((e) => e.type === "has_patent_status" && (!candidate || e.from === candidate.id));
  const node = edge ? graph.nodes.find((n) => n.id === edge.to) : graph.nodes.find((n) => n.type === "patent");
  if (!node) return null;
  const m = node.meta ?? {};
  const orangeBook = m.source === "orange_book";
  const summary = str(m.summary) ?? node.label;
  const patents = patentRows(node);
  const anda = num(m.andaCount) ?? 0;
  const nda = num(m.ndaCount) ?? 0;
  const firstApproval = str(m.firstApproval);
  const exclusivity = str(m.exclusivityUntil);
  const pubchemCount = num(m.pubchemPatentCount);
  const url = node.source?.url ?? edge?.source.url;

  return (
    <div className="rounded-md border border-violet-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-violet-100 px-4 py-2.5">
        <div className="text-sm font-semibold text-zinc-900">Can you own it? — IP status</div>
        <EvidenceBadge kind="clinical" />
      </div>
      <div className="flex flex-col gap-2 px-4 py-3 text-xs text-zinc-700">
        <p className="text-sm text-zinc-900">{summary}</p>
        {orangeBook ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-zinc-500">Approved products</dt>
            <dd>
              {nda} NDA{nda === 1 ? "" : "s"}, {anda} generic{anda === 1 ? "" : "s"} (ANDA{anda === 1 ? "" : "s"})
              {firstApproval ? `, first approved ${firstApproval.slice(0, 4)}` : ""}
            </dd>
            {exclusivity && (
              <>
                <dt className="text-zinc-500">Regulatory exclusivity</dt>
                <dd>until {exclusivity}</dd>
              </>
            )}
          </dl>
        ) : (
          pubchemCount != null && (
            <p>
              No US-approved product in the Orange Book. PubChem lists {pubchemCount.toLocaleString("en-US")} patent documents that mention the
              compound; the originator&apos;s composition-of-matter patents decide ownership.
            </p>
          )
        )}
        {patents.length > 0 && (
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-0.5 pr-2 font-medium">Listed patent</th>
                <th className="py-0.5 pr-2 font-medium">Expires</th>
                <th className="py-0.5 font-medium">Claims</th>
              </tr>
            </thead>
            <tbody>
              {patents.map((p) => (
                <tr key={`${p.patentNo}-${p.expires}-${p.useCode ?? ""}`} className="border-t border-zinc-100">
                  <td className="py-0.5 pr-2 font-mono">
                    <a
                      href={`https://patents.google.com/patent/US${p.patentNo.replace(/\*.*$/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 hover:underline"
                    >
                      {p.patentNo}
                    </a>
                  </td>
                  <td className="py-0.5 pr-2">{p.expires}</td>
                  <td className="py-0.5">{claim(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {num(m.unexpiredPatents) != null && (num(m.unexpiredPatents) ?? 0) > patents.length && (
          <p className="text-zinc-500">
            Showing {patents.length} of {num(m.unexpiredPatents)} unexpired listed patents.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-zinc-500">
            {orangeBook
              ? "The Orange Book lists only patents the sponsor filed with the FDA for approved products; freedom-to-operate needs a real search."
              : "A patent document count is not a freedom-to-operate search."}
          </p>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-semibold text-blue-700 hover:underline">
              Open record ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
