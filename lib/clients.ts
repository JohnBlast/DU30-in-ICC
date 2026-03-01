/**
 * Centralized client imports for Task Group 1 verification.
 * Each import must resolve without error (Tasks 1.2-1.5).
 */

// Task 1.2: Supabase client
import { createClient } from "@supabase/supabase-js";

// Task 1.3: OpenAI client
import OpenAI from "openai";

// Task 1.4: Firecrawl client
import { Firecrawl } from "@mendable/firecrawl-js";

// Task 1.5: LangChain text splitter
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/**
 * Get a configured Supabase client (browser-safe, uses anon key).
 */
export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase env vars");
  }
  return createClient(url, anonKey);
}

/**
 * Get a configured OpenAI client.
 */
export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  return new OpenAI({ apiKey });
}

/**
 * Get a configured Firecrawl client.
 */
export function getFirecrawlClient() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY");
  }
  return new Firecrawl({ apiKey });
}

/** Approximate chars per token for English legal text. */
const CHARS_PER_TOKEN = 4;

/**
 * Create a LangChain text splitter for RAG 1 (600 tokens / 60 overlap).
 */
export function createRag1Splitter() {
  return new RecursiveCharacterTextSplitter({
    chunkSize: 600 * CHARS_PER_TOKEN,
    chunkOverlap: 60 * CHARS_PER_TOKEN,
  });
}

/**
 * Create a LangChain text splitter for RAG 2 (400 tokens / 40 overlap).
 */
export function createRag2Splitter() {
  return new RecursiveCharacterTextSplitter({
    chunkSize: 400 * CHARS_PER_TOKEN,
    chunkOverlap: 40 * CHARS_PER_TOKEN,
  });
}
