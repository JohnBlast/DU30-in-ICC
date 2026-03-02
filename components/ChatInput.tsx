"use client";

/**
 * Chat input: question field + optional paste-text area + send button.
 * cursor-false-decline-reduction §5.4: placeholder rotation, paste label.
 */

import { useState, useEffect } from "react";

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
      <div className="border-t border-gray-200 bg-gray-50 p-6">
        <p className="text-center text-gray-700">
          The Q&A service has reached its monthly usage limit. You can still browse your
          conversations and the document library. Service resets on {resetDate || "the 1st"}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 bg-white p-4">
      {showPaste && (
        <div className="mb-4 rounded-lg border-2 border-blue-200 bg-blue-50/50 p-4">
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
            <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Paste content from social media to fact-check it
          </label>
          <p className="mb-2 text-xs text-gray-600">
            Paste ICC document text or a social media post. Then ask &quot;Is this accurate?&quot; or &quot;Fact-check this&quot;
          </p>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste your text here..."
            rows={5}
            className="w-full rounded-lg border border-blue-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
            disabled={disabled}
          />
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PLACEHOLDERS[placeholderIndex]}
          className="flex-1 rounded-md border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => setShowPaste(!showPaste)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-2.5 text-sm font-medium disabled:opacity-50 ${
            showPaste
              ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              : "border-2 border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-500"
          }`}
          title={showPaste ? "Hide paste area" : "Paste ICC document or social media to verify"}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {showPaste ? "Hide" : "Paste"}
        </button>
        <button
          type="submit"
          disabled={disabled || !query.trim()}
          className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </form>
  );
}
