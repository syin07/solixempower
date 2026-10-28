import type { EvidenceKind } from "@/lib/contracts";

const STYLES: Record<EvidenceKind, { label: string; className: string }> = {
  measured: { label: "Measured", className: "bg-blue-600 text-white border-blue-600" },
  computed: { label: "Computed", className: "bg-white text-violet-700 border-violet-500 border-dashed" },
  clinical: { label: "Clinical", className: "bg-emerald-50 text-emerald-800 border-emerald-600" },
  ai_summary: { label: "AI summary", className: "bg-zinc-100 text-zinc-700 border-zinc-400 italic" },
};

/** Labels how a fact was obtained (PRD §7). Text + style, never color alone. */
export function EvidenceBadge({ kind }: { kind: EvidenceKind }) {
  const s = STYLES[kind];
  return (
    <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.className}`}>
      {s.label}
    </span>
  );
}
