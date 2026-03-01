/**
 * Cost tracking and limits. PRD §4 (Cost Controls).
 * gpt-4o-mini: $0.15/1M input, $0.60/1M output
 */

import { getSupabase } from "./db";

const GPT4O_MINI_INPUT_PER_1M = 0.15;
const GPT4O_MINI_OUTPUT_PER_1M = 0.60;

/** Rough estimate: ~2k input + 300 output for generation, ~2k input + 10 output for judge */
const ESTIMATED_INPUT_PER_QUERY = 4000;
const ESTIMATED_OUTPUT_PER_QUERY = 310;

export function estimateCostPerQuery(): number {
  const inputCost = (ESTIMATED_INPUT_PER_QUERY / 1_000_000) * GPT4O_MINI_INPUT_PER_1M;
  const outputCost = (ESTIMATED_OUTPUT_PER_QUERY / 1_000_000) * GPT4O_MINI_OUTPUT_PER_1M;
  return inputCost + outputCost;
}

/** Get global monthly cap in USD. Default $50. Set GLOBAL_MONTHLY_CAP_USD in env. */
function getGlobalCap(): number {
  const cap = process.env.GLOBAL_MONTHLY_CAP_USD;
  if (cap) return parseFloat(cap);
  return 50;
}

/** Current month as YYYY-MM */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** First day of next month (for reset date) */
function nextMonthFirst(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export interface UsageStatus {
  underCap: boolean;
  globalCost: number;
  resetDate: string;
  dailyCount: number;
  dailyLimitReached: boolean;
}

/** Override with SOFT_DAILY_LIMIT in .env.local for testing (e.g. 2 = nudge after 2 queries) */
export const SOFT_DAILY_LIMIT = process.env.SOFT_DAILY_LIMIT ? parseInt(process.env.SOFT_DAILY_LIMIT, 10) : 30;

/** Check usage status for a user. */
export async function getUsageStatus(userId: string): Promise<UsageStatus> {
  const supabase = getSupabase();
  const month = currentMonth();
  const today = new Date().toISOString().slice(0, 10);

  const { data: globalRows } = await supabase
    .from("usage_tracking")
    .select("global_total_cost")
    .eq("global_month", month);

  const globalCost = (globalRows ?? []).reduce((sum, r) => sum + Number(r.global_total_cost ?? 0), 0);

  const { data: userRows } = await supabase
    .from("usage_tracking")
    .select("query_count")
    .eq("user_id", userId)
    .eq("date", today);

  const dailyCount = (userRows ?? []).reduce((sum, r) => sum + (r.query_count ?? 0), 0);

  return {
    underCap: globalCost < getGlobalCap(),
    globalCost,
    resetDate: nextMonthFirst(),
    dailyCount,
    dailyLimitReached: dailyCount >= SOFT_DAILY_LIMIT,
  };
}

/** Record a query and update usage. Call after successful chat. */
export async function recordQuery(
  userId: string,
  estimatedCost: number
): Promise<void> {
  const supabase = getSupabase();
  const month = currentMonth();
  const today = new Date().toISOString().slice(0, 10);

  const { error } = await supabase.from("usage_tracking").insert({
    user_id: userId,
    date: today,
    query_count: 1,
    global_month: month,
    global_total_cost: estimatedCost,
  });
  if (error) {
    console.error("[Docket:Usage] recordQuery failed:", error.message);
  }
}
