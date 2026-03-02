/**
 * Layer 1 Deterministic Judge (production-hardening-blueprint.md).
 * Runs BEFORE the LLM Judge to catch prohibited terms, citation bounds, and redaction.
 */

import type { RetrievalChunk } from "./retrieve";

export interface DeterministicJudgeResult {
  pass: boolean;
  reason?: string;
  warnings: string[];
}

const PROCEDURAL_STATUS_EXEMPT_DJ = [
  /\b(has\s+)?not\s+been\s+(convicted|acquitted|sentenced|found\s+guilty)/i,
  /\bwas\s+not\s+(convicted|acquitted|sentenced)/i,
  /\bno\s+(verdict|conviction|acquittal|sentence)\s+(has\s+been|was)\s+(rendered|issued|handed\s+down)/i,
  /\bcase\s+is\s+(at|currently\s+at|in\s+the)\s+/i,
  /\b(has\s+not\s+yet|not\s+yet\s+been)\b/i,
  /\bno\s+trial\s+has\b/i,
];

const PROHIBITED_PATTERNS = [
  {
    pattern: /\b(he|duterte|du30|the\s+accused)\s+(is|was)\s+not\s+(guilty|innocent)\b/i,
    label: "negated guilt/innocence opinion",
  },
  {
    pattern: /\b(he|duterte|du30|the\s+accused)\s+(is|was)\s+found\s+not\s+guilty\b/i,
    label: "not-guilty finding assertion",
  },
  {
    pattern: /\bnot\s+(guilty|innocent)\s+(of|as|for)\b/i,
    label: "negated guilt/innocence",
  },
  {
    pattern: /\b(he|duterte|du30)\s+(is|was)\s+(guilty|innocent|convicted|acquitted)\b/i,
    label: "guilt/innocence",
  },
  {
    pattern: /\b(murderer|tyrant|hero|saint|villain)\b/i,
    label: "loaded characterization",
  },
  {
    pattern: /\b(witch\s+hunt|persecution|justice\s+served)\b/i,
    label: "politically loaded term",
  },
];

const FACT_CHECK_EXEMPT_PATTERNS = [
  /\b(FALSE|indicate\s+otherwise|UNVERIFIABLE|OPINION|NOT\s+IN\s+ICC|no\s+verdict\s+has\s+been\s+rendered)\b/i,
  /\bprocedural\s+status\b/i,
];

function getLineContaining(text: string, index: number): string {
  const before = text.lastIndexOf("\n", index);
  const after = text.indexOf("\n", index);
  return text.slice(
    before === -1 ? 0 : before,
    after === -1 ? text.length : after
  );
}

export function runDeterministicJudge(
  answer: string,
  chunks: RetrievalChunk[],
  isFactCheck: boolean
): DeterministicJudgeResult {
  const warnings: string[] = [];

  // 1. Prohibited terms (exempt fact-check refutation; exempt procedural-status for guilt/innocence)
  for (const { pattern, label } of PROHIBITED_PATTERNS) {
    const match = answer.match(pattern);
    if (match) {
      const line = getLineContaining(answer, match.index ?? 0);
      const isFactCheckExempt =
        isFactCheck && FACT_CHECK_EXEMPT_PATTERNS.some((p) => p.test(line));
      const isProceduralExempt =
        label === "guilt/innocence" &&
        PROCEDURAL_STATUS_EXEMPT_DJ.some((p) => p.test(line));
      if (isFactCheckExempt || isProceduralExempt) continue;
      return {
        pass: false,
        reason: `Prohibited term: ${label} ("${match[0]}")`,
        warnings,
      };
    }
  }

  // 2. Citation bounds
  const citationRefs = [...answer.matchAll(/\[(\d+)\]/g)].map((m) =>
    parseInt(m[1], 10)
  );
  for (const ref of citationRefs) {
    if (ref < 1 || ref > chunks.length) {
      return {
        pass: false,
        reason: `Invalid citation [${ref}] — only ${chunks.length} chunks available`,
        warnings,
      };
    }
  }

  // 3. [REDACTED] content in answer (not in citations or quoted chunks)
  const answerWithoutCitations = answer.replace(/\[\d+\]/g, "");
  if (
    /\bredacted\s+(name|person|witness|individual|identity)/i.test(
      answerWithoutCitations
    )
  ) {
    return {
      pass: false,
      reason: "Answer references redacted content",
      warnings,
    };
  }

  return { pass: true, warnings };
}
