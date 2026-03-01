/**
 * Step 1: Translation (nl-interpretation.md §2.3.2).
 * Translates Filipino (Tagalog/Tanglish) to English for retrieval.
 * Preserves ICC terms, proper nouns, [REDACTED]. On failure → fall back to original.
 */

import { getOpenAIClient } from "./openai-client";
import { logEvent } from "./logger";

export interface TranslationResult {
  translatedText: string;
  originalText: string;
  success: boolean;
}

/** Translation prompt from prompt-spec.md §4c */
const TRANSLATION_PROMPT = `You are a translator. Translate the following text from Tagalog or Tanglish (Filipino-English code-switching) into English.

RULES:
- Translate ONLY. Do not interpret, answer, or add information.
- Preserve these ICC terms EXACTLY in English (do not translate): "crimes against humanity", "Rome Statute", "confirmation of charges", "Pre-Trial Chamber", "arrest warrant", "in absentia", "proprio motu", "Document Containing the Charges"
- Preserve these proper nouns EXACTLY: Duterte, ICC, Philippines, The Hague
- Keep English code-switched phrases as-is (if the user already used English, leave it)
- Keep [REDACTED] markers exactly as-is — never translate or modify them
- Output ONLY the English translation, no explanations

Text to translate:`;

/**
 * Translate Filipino text to English for retrieval.
 * On any error: returns original text with success: false.
 */
export async function translateToEnglish(text: string): Promise<TranslationResult> {
  if (!text?.trim()) {
    return { translatedText: text, originalText: text, success: true };
  }

  try {
    const openai = getOpenAIClient();
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: TRANSLATION_PROMPT },
        { role: "user", content: text.slice(0, 4000) },
      ],
      max_tokens: 1024,
      temperature: 0,
    });

    const translated = res.choices[0]?.message?.content?.trim();
    if (translated) {
      logEvent("translate.success", "info", {
        original_length: text.length,
        translated_length: translated.length,
      });
      return {
        translatedText: translated,
        originalText: text,
        success: true,
      };
    }
  } catch (err) {
    logEvent("translate.failure", "warn", {
      error_message: String(err),
      original_length: text.length,
    });
  }

  return {
    translatedText: text,
    originalText: text,
    success: false,
  };
}
