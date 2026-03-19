/**
 * Chat input validation (Phase 2, H-9).
 * Used by API route and tests.
 */

const MAX_QUERY_LENGTH = 5000;
const MAX_PASTE_LENGTH = 50000;
const MIN_QUERY_LENGTH = 3;

export interface ValidateResult {
  valid: boolean;
  error?: string;
  sanitizedQuery?: string;
  sanitizedPaste?: string;
}

export function validateChatInput(
  query: string,
  pastedText?: string
): ValidateResult {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < MIN_QUERY_LENGTH) {
    return { valid: false, error: "Query too short" };
  }
  if (trimmedQuery.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: "Query exceeds maximum length" };
  }
  if (typeof pastedText === "string" && pastedText.length > MAX_PASTE_LENGTH) {
    return { valid: false, error: "Pasted text exceeds maximum length" };
  }
  const sanitizedQuery = trimmedQuery.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  const sanitizedPaste =
    typeof pastedText === "string"
      ? pastedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      : undefined;
  return { valid: true, sanitizedQuery, sanitizedPaste };
}
