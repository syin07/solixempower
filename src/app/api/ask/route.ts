import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { askGraph, type AskResult, type AskTurn } from "@/lib/agent/ask";
import type { ApiError, GraphResult } from "@/lib/contracts";

// POST /api/ask  body: { graph: GraphResult, question: string, history?: { question, answer }[] }
export async function POST(req: NextRequest) {
  let body: { graph: GraphResult; question: string; history?: AskTurn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>({ error: "Body must be JSON: { graph, question, history? }" }, { status: 400 });
  }
  const invalid = validateBody(body);
  if (invalid) return NextResponse.json<ApiError>({ error: invalid }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json<ApiError>({ error: "AI is not configured" }, { status: 503 });

  try {
    return NextResponse.json<AskResult>(await askGraph({ graph: body.graph, question: body.question.trim(), history: body.history }));
  } catch (e) {
    console.error(e);
    const message =
      e instanceof Anthropic.RateLimitError
        ? "AI service is busy — try again in a moment."
        : e instanceof Anthropic.APIError
          ? `AI service error (${e.status}).`
          : e instanceof Error
            ? e.message
            : "Question failed.";
    return NextResponse.json<ApiError>({ error: message }, { status: 502 });
  }
}

function validateBody(body: unknown): string | null {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(body) || !isObj(body.graph)) return "Body must be an object: { graph, question, history? }";
  if (!Array.isArray(body.graph.nodes) || !Array.isArray(body.graph.edges) || !Array.isArray(body.graph.hypotheses)) return "graph must have nodes, edges and hypotheses arrays";
  if (typeof body.question !== "string" || !body.question.trim()) return "question is required";
  if (body.question.length > 2000) return "question is too long";
  if (body.history != null) {
    if (!Array.isArray(body.history)) return "history, if sent, must be an array of { question, answer }";
    for (const t of body.history) if (!isObj(t) || typeof t.question !== "string" || typeof t.answer !== "string") return "history entries must be { question, answer }";
  }
  return null;
}
