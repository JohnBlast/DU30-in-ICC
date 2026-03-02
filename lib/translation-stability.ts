/**
 * Translation stability audit (production-hardening-blueprint.md).
 * Logs when Filipino modal markers may have been converted to certain English assertions.
 */

export interface TranslationStabilityResult {
  stable: boolean;
  warning?: string;
}

const FILIPINO_MODAL_MARKERS =
  /\b(maaari|dapat|pwede|siguro|baka|malamang|posible)\b/gi;
const ENGLISH_CERTAINTY =
  /\b(will|shall|must|definitely|certainly)\s+(be\s+)?(convicted|sentenced|charged|killed|arrested)\b/gi;

export function checkTranslationStability(
  originalFilipino: string,
  englishTranslation: string
): TranslationStabilityResult {
  const filipinoModals = (originalFilipino.match(FILIPINO_MODAL_MARKERS) ?? []).length;
  const englishCertainty = (
    englishTranslation.match(ENGLISH_CERTAINTY) ?? []
  ).length;

  if (filipinoModals > 0 && englishCertainty > 0) {
    return {
      stable: false,
      warning:
        "Translation may have converted uncertain Filipino markers to certain English assertions",
    };
  }

  return { stable: true };
}
