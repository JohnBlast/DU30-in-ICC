/**
 * Structured logger for Docket observability (Phase 2).
 * Output: JSON lines to stdout/stderr.
 */

export interface DocketEvent {
  timestamp: string;
  event: string;
  level: "info" | "warn" | "error";
  data: Record<string, unknown>;
}

export function logEvent(
  event: string,
  level: "info" | "warn" | "error",
  data: Record<string, unknown>
): void {
  const entry: DocketEvent = {
    timestamp: new Date().toISOString(),
    event,
    level,
    data,
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}
