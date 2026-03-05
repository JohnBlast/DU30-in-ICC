/**
 * Deterministic follow-up query rewriter (cursor-indirect-coperpetration-fix P0-1).
 * Rewrites short follow-up queries ("list them", "what about X") using conversation context
 * so intent classification receives an ICC-grounded query instead of out-of-scope.
 */

const FOLLOW_UP_PATTERNS = [
  /^(can you |could you |please )?(list|name|show|give me|tell me|enumerate|provide)\s+(them|those|the names?|these|it|the list|more|details?|examples?)/i,
  /^(what|who|how|where|when)\s+(about|regarding|is|are|was|were)\s+/i,
  /^(and|but|also|then|so)\s+(what|who|how|where|when)\s+/i,
  /^(more|details?|elaborate|explain\s+more|go\s+on|continue|expand)/i,
  /^(yes|yeah|ok|sure)[,.]?\s+(list|name|show|tell|give|what|who)/i,
  /^(them|those|the names?|these people|this|that)\s*[?.]?\s*$/i,
];

const ANAPHORA_PATTERNS = [
  /\b(them|they|those|these|it|this|that|the above|the list|the names?)\b/i,
  /\b(he|she|his|her|him)\b(?!.*\b(duterte|du30)\b)/i,
];

export interface RewriteResult {
  rewritten: boolean;
  query: string;
  originalQuery: string;
}

/**
 * Rewrite short follow-up queries using conversation history so intent classification
 * receives an ICC-grounded query. Runs before classification.
 */
export function rewriteFollowUp(
  query: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
): RewriteResult {
  const trimmed = query.trim();
  if (!trimmed || conversationHistory.length === 0) {
    return { rewritten: false, query: trimmed, originalQuery: trimmed };
  }

  const isShort = trimmed.split(/\s+/).length <= 12;
  const hasFollowUpPattern = FOLLOW_UP_PATTERNS.some((p) => p.test(trimmed));
  const hasAnaphora = ANAPHORA_PATTERNS.some((p) => p.test(trimmed));

  if (!isShort || (!hasFollowUpPattern && !hasAnaphora)) {
    return { rewritten: false, query: trimmed, originalQuery: trimmed };
  }

  const lastUserMsg = [...conversationHistory]
    .reverse()
    .find((m) => m.role === "user");

  if (!lastUserMsg) {
    return { rewritten: false, query: trimmed, originalQuery: trimmed };
  }

  const priorTopic = lastUserMsg.content.slice(0, 200);

  // "what about [NAME]" → "What is the role of [NAME] in the Duterte ICC case?"
  const whatAboutMatch = trimmed.match(
    /^(?:then\s+)?(?:what|how)\s+about\s+(.+?)(?:\?|$)/i
  );
  if (whatAboutMatch) {
    const name = whatAboutMatch[1].trim();
    if (name.length > 0) {
      return {
        rewritten: true,
        query: `What is the role of ${name} in the Duterte ICC case?`,
        originalQuery: trimmed,
      };
    }
  }

  // "list them" / "name them" / "who are they" → prepend prior topic
  const listMatch = trimmed.match(
    /^(?:can you |could you |please )?(list|name|show|give me|enumerate|tell me)\s+(them|those|the names?|these|the list|more)/i
  );
  if (listMatch) {
    return {
      rewritten: true,
      query: `List the names related to: ${priorTopic}`,
      originalQuery: trimmed,
    };
  }

  // Anaphora with question structure
  if (hasAnaphora) {
    return {
      rewritten: true,
      query: `Regarding "${priorTopic}": ${trimmed}`,
      originalQuery: trimmed,
    };
  }

  return { rewritten: false, query: trimmed, originalQuery: trimmed };
}
