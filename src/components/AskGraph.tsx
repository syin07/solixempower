"use client";

// "Ask the graph" (docs/KG_PRD.md §6): a question box whose answers come only from the graph on screen.
// Each answer lists its claims with the edge/node ids it cites; hovering an answer highlights those
// edges via onHighlight. Session-only thread, reset whenever a new graph is built.
import { useState, type FormEvent } from "react";
import type { GraphResult } from "@/lib/contracts";

interface Claim {
  text: string;
  edgeIds: string[];
}
interface Turn {
  question: string;
  answer: string;
  claims: Claim[];
  suggestedExpand: string | null;
  refusal: boolean;
}

const SUGGESTED = [
  "Which of these hypotheses were already tested?",
  "Why is the first target linked to the disease I asked about?",
  "What is missing before an in vivo study?",
];

export function AskGraph({ graph, onHighlight }: { graph: GraphResult; onHighlight: (edgeIds: string[]) => void }) {
  const [thread, setThread] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reset the thread when a new graph arrives ("adjust state on prop change" pattern)
  const [builtAt, setBuiltAt] = useState(graph.builtAt);
  if (builtAt !== graph.builtAt) {
    setBuiltAt(graph.builtAt);
    setThread([]);
    setError(null);
  }

  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setQuestion("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph, question: text, history: thread.map((t) => ({ question: t.question, answer: t.answer })) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setThread((t) => [...t, { question: text, ...(body as Omit<Turn, "question">) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  return (
    <div className="rounded-md border border-zinc-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-zinc-100 px-4 py-2.5">
        <div className="text-sm font-semibold text-zinc-900">Ask the graph</div>
        <span className="text-xs text-zinc-500" title="Answers use only the graph on screen; every statement cites an edge">
          cited answers
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        {thread.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => void ask(s)}
                className="rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700 hover:border-blue-500 hover:text-blue-700 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {thread.map((t, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="self-end rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white">{t.question}</div>
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${t.refusal ? "border-amber-300 bg-amber-50 text-amber-900" : "border-zinc-200 bg-zinc-50 text-zinc-800"}`}
              onMouseEnter={() => onHighlight([...new Set(t.claims.flatMap((c) => c.edgeIds))])}
              onMouseLeave={() => onHighlight([])}
            >
              <p>{t.answer}</p>
              {t.claims.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 border-t border-zinc-200 pt-2 text-xs text-zinc-700">
                  {t.claims.map((c, j) => (
                    <li key={j}>
                      {c.text}
                      <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                        {c.edgeIds.map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onHighlight([id])}
                            title={labelOf(id)}
                            className="max-w-48 truncate rounded border border-zinc-300 bg-white px-1 py-0.5 font-mono text-[10px] text-blue-700 hover:border-blue-500"
                          >
                            {id}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {t.suggestedExpand && (
                // Expansion itself lives in EvidenceGraphSection; this only points the user at the node.
                <button
                  type="button"
                  onClick={() => onHighlight([t.suggestedExpand!])}
                  className="mt-2 rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs text-violet-800 hover:border-violet-500"
                >
                  Try expanding {labelOf(t.suggestedExpand)}
                </button>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-zinc-500">thinking…</div>}
        {error && <div className="text-xs text-red-700">{error}</div>}
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about this graph…"
            disabled={busy}
            className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:border-blue-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
