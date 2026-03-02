/**
 * Client-side telemetry (cursor-false-decline-reduction §5.5).
 * Fire-and-forget; no PII. Query previews truncated to 50 chars.
 */

export function logUiEvent(event: string, data?: Record<string, unknown>) {
  const payload: Record<string, unknown> = { ...data };
  if (payload.query_preview && typeof payload.query_preview === "string") {
    payload.query_preview = payload.query_preview.slice(0, 50);
  }
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, data: payload }),
  }).catch(() => {});
}
