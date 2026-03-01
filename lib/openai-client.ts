/**
 * Shared OpenAI client with optional LangSmith tracing.
 * When LANGSMITH_TRACING=true and LANGSMITH_API_KEY are set, traces are sent to LangSmith.
 * See: https://docs.langchain.com/langsmith/trace-openai
 */

import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers/openai";

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY!;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const client = new OpenAI({ apiKey });

  const tracingOn =
    process.env.LANGSMITH_TRACING === "true" ||
    process.env.LANGCHAIN_TRACING_V2 === "true";
  const langsmithKey = process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY;

  if (tracingOn && langsmithKey) {
    return wrapOpenAI(client) as unknown as OpenAI;
  }

  return client;
}

let _cached: OpenAI | null = null;

/** Get OpenAI client (cached per process). Use for chat, intent, embeddings. */
export function getOpenAIClient(): OpenAI {
  if (!_cached) _cached = getOpenAI();
  return _cached;
}
