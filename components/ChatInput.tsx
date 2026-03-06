"use client";

/**
 * Chat input: question field + optional paste-text area + send button.
 * cursor-false-decline-reduction §5.4: placeholder rotation, paste label.
 * Styled with Primer design system.
 */

import { useState, useEffect } from "react";
import { Button, TextInput, Textarea } from "@primer/react";
import { PasteIcon } from "@primer/octicons-react";

const PLACEHOLDERS = [
  "Ask about the Duterte ICC case...",
  "e.g., What are the charges against Duterte?",
  "e.g., When was the arrest warrant issued?",
  "e.g., What does 'crimes against humanity' mean?",
  "Paste a social media post to fact-check it",
];

interface ChatInputProps {
  onSend: (query: string, pastedText?: string) => void;
  disabled?: boolean;
  capExceeded?: boolean;
  resetDate?: string;
  showPaste?: boolean;
  onShowPasteChange?: (show: boolean) => void;
}

export function ChatInput({
  onSend,
  disabled,
  capExceeded,
  resetDate,
  showPaste: controlledShowPaste,
  onShowPasteChange,
}: ChatInputProps) {
  const [query, setQuery] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [internalShowPaste, setInternalShowPaste] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const showPaste = controlledShowPaste ?? internalShowPaste;
  const setShowPaste = onShowPasteChange ?? setInternalShowPaste;

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || disabled) return;

    const toPaste = pastedText.trim() || undefined;
    onSend(q, toPaste);
    setQuery("");
    setPastedText("");
    setShowPaste(false);
  }

  if (capExceeded) {
    return (
      <div className="border-t border-gray-200 bg-gray-50 p-4 sm:p-6">
        <p className="text-center text-gray-700">
          The Q&A service has reached its monthly usage limit. You can still browse your
          conversations and the document library. Service resets on {resetDate || "the 1st"}.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-gray-200 bg-white p-3 transition-colors sm:p-4"
    >
      {showPaste && (
        <div className="mb-4 rounded-lg border-2 border-blue-200 bg-blue-50/50 p-3 transition-all duration-200 sm:p-4">
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
            <PasteIcon size={16} />
            Paste content from social media to fact-check it
          </label>
          <p className="mb-2 text-xs text-gray-600">
            Paste ICC document text or a social media post. Then ask &quot;Is this accurate?&quot; or
            &quot;Fact-check this&quot;
          </p>
          <Textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste your text here..."
            rows={5}
            disabled={disabled}
            block
          />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-h-[44px] flex-1 min-w-0 items-stretch sm:min-h-0">
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={PLACEHOLDERS[placeholderIndex]}
            disabled={disabled}
            block
          />
        </div>
        <div className="flex gap-2 sm:gap-3">
          <Button
            type="button"
            variant="default"
            onClick={() => setShowPaste(!showPaste)}
            disabled={disabled}
            leadingVisual={PasteIcon}
            title={showPaste ? "Hide paste area" : "Paste ICC document or social media to verify"}
            className="min-h-[44px] flex-1 sm:min-h-0 sm:flex-initial"
          >
            {showPaste ? "Hide" : "Paste"}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={disabled || !query.trim()}
            className="min-h-[44px] flex-1 sm:min-h-0 sm:flex-initial"
          >
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}
