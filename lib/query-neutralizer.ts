/**
 * Query neutralizer: strips loaded descriptors before classification/generation.
 * False-decline reduction: "What did that murderer Duterte do?" → "What did Duterte do?"
 */

// Use lookahead so we strip the descriptor but keep the name (e.g. "that murderer Duterte" → "Duterte")
const LOADED_DESCRIPTORS = [
  /\b(that\s+)?(murderer|tyrant|dictator|killer|butcher|monster)\s+(?=duterte|du30|he|him|the\s+accused)/gi,
  /\b(the\s+)?(murderous|tyrannical|evil)\s+(?=duterte|du30|president|accused)/gi,
  /\b(criminal)\s+(?=duterte|du30|president|he\b)/gi,
];

const LOADED_QUALIFIERS = [
  /\b(obviously|clearly|undeniably|everyone\s+knows)\s+(that\s+)?/gi,
  /\b(of\s+course|naturally|needless\s+to\s+say)\s*/gi,
];

export function neutralizeQuery(query: string): string {
  let q = query;
  for (const p of LOADED_DESCRIPTORS) {
    q = q.replace(p, "");
  }
  for (const p of LOADED_QUALIFIERS) {
    q = q.replace(p, "");
  }
  return q.replace(/\s{2,}/g, " ").trim() || query;
}
