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

const PROHIBITED_PATTERNS = [
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

  // 1. Prohibited terms (exempt fact-check refutation lines)
  for (const { pattern, label } of PROHIBITED_PATTERNS) {
    const match = answer.match(pattern);
    if (match) {
      const line = getLineContaining(answer, match.index ?? 0);
      const isExempt =
        isFactCheck && FACT_CHECK_EXEMPT_PATTERNS.some((p) => p.test(line));
      if (!isExempt) {
        return {
          pass: false,
          reason: `Prohibited term: ${label} ("${match[0]}")`,
          warnings,
        };
      }
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
