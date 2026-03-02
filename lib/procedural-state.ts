/**
 * Procedural state engine (docket-improvement-plan.md §13).
 * Canonical case state, stage ordinals, deterministic impossibility checker.
 */

export type ProceduralStage =
  | "preliminary_examination"
  | "investigation"
  | "arrest_warrant_issued"
  | "surrender_or_arrest"
  | "confirmation_of_charges"
  | "trial"
  | "verdict"
  | "sentencing"
  | "appeal";

export interface KeyEvent {
  stage: ProceduralStage;
  date: string;
  description: string;
}

export interface ProceduralState {
  caseId: string;
  currentStage: ProceduralStage;
  stageOrdinal: number;
  lastDecisionDate: string | null;
  keyEvents: KeyEvent[];
  asOfDate: string;
}

const STAGE_ORDINALS: Record<ProceduralStage, number> = {
  preliminary_examination: 0,
  investigation: 1,
  arrest_warrant_issued: 2,
  surrender_or_arrest: 3,
  confirmation_of_charges: 4,
  trial: 5,
  verdict: 6,
  sentencing: 7,
  appeal: 8,
};

/** Claim signals that imply a required procedural stage */
const CLAIM_STAGE_SIGNALS: Array<{ pattern: RegExp; requiredStage: ProceduralStage }> = [
  { pattern: /\bconvicted\b/i, requiredStage: "verdict" },
  { pattern: /\bverdict\b/i, requiredStage: "verdict" },
  { pattern: /\bsentenced\b/i, requiredStage: "sentencing" },
  // Procedural appeal (challenge to higher court) — NOT "appealing for witnesses" (requesting)
  { pattern: /\bappeal(?:ed|ing)?\b(?!\s+for\b)/i, requiredStage: "appeal" },
  { pattern: /\bserved?\s+(part\s+of\s+)?(his\s+)?sentence\b/i, requiredStage: "sentencing" },
  { pattern: /\bacquitted\b/i, requiredStage: "verdict" },
  { pattern: /\btrial\s+(began|started|completed)\b/i, requiredStage: "trial" },
  { pattern: /\bconfirmation\s+of\s+charges\b/i, requiredStage: "confirmation_of_charges" },
];

/** Default Duterte ICC case state — at confirmation of charges (as of 2026). Override via CASE_STATE_OVERRIDE env. */
const DEFAULT_STATE: ProceduralState = {
  caseId: "ICC-02/21",
  currentStage: "confirmation_of_charges",
  stageOrdinal: 4,
  lastDecisionDate: "2026-02-28",
  keyEvents: [
    { stage: "arrest_warrant_issued", date: "2024-03-08", description: "Arrest warrant issued" },
    { stage: "confirmation_of_charges", date: "2026-02-24", description: "Hearing held" },
  ],
  asOfDate: new Date().toISOString().slice(0, 10),
};

let cachedState: ProceduralState | null = null;

/**
 * Get current procedural state. Uses env override or default.
 */
export function getProceduralState(): ProceduralState {
  if (cachedState) return cachedState;
  const override = process.env.CASE_STATE_OVERRIDE;
  if (override) {
    try {
      cachedState = JSON.parse(override) as ProceduralState;
      return cachedState;
    } catch {
      // Invalid JSON; fall back to default
    }
  }
  cachedState = DEFAULT_STATE;
  return cachedState;
}

/** Reset cache (e.g. for tests) */
export function resetProceduralStateCache(): void {
  cachedState = null;
}

export interface ProceduralImpossibilityResult {
  impossible: boolean;
  claimedStage?: ProceduralStage;
}

/**
 * Check if a claim asserts an event from a later procedural stage that has not occurred.
 */
export function isProcedurallyImpossible(
  claim: string,
  state: ProceduralState = getProceduralState()
): ProceduralImpossibilityResult {
  const claimLower = claim.toLowerCase();
  for (const { pattern, requiredStage } of CLAIM_STAGE_SIGNALS) {
    if (pattern.test(claimLower)) {
      const requiredOrd = STAGE_ORDINALS[requiredStage];
      if (state.stageOrdinal < requiredOrd) {
        return { impossible: true, claimedStage: requiredStage };
      }
      return { impossible: false };
    }
  }
  return { impossible: false };
}
