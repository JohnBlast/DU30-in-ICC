"use client";

/**
 * Chat input: question field + optional paste-text area + send button.
 */

import { useState } from "react";

interface ChatInputProps {
  onSend: (query: string, pastedText?: string) => void;
  disabled?: boolean;
  capExceeded?: boolean;
  resetDate?: string;
}

export function ChatInput({ onSend, disabled, capExceeded, resetDate }: ChatInputProps) {
  const [query, setQuery] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [showPaste, setShowPaste] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || disabled) return;

    onSend(q, pastedText.trim() || undefined);
    setQuery("");
    setPastedText("");
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
        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Pasted ICC document text (optional)
          </label>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste text from an ICC document to verify and ask about it..."
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={disabled}
          />
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question about the Duterte ICC case..."
          className="flex-1 rounded-md border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => setShowPaste(!showPaste)}
          className="rounded-md border border-gray-300 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          title={showPaste ? "Hide paste area" : "Add pasted text"}
        >
          {showPaste ? "−" : "+"} Paste
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
