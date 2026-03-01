"use client";

/**
 * Single message with citation markers, glossary links, copy, and source preview.
 * User messages: right-aligned. Assistant: left-aligned.
 */

import { useState } from "react";
import Link from "next/link";
import { splitGlossaryTerms } from "@/lib/glossary-terms";

export interface Citation {
  marker: string;
  document_title: string;
  date_published: string;
  url: string;
  source_passage: string;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  warning?: string | null;
  knowledge_base_last_updated?: string;
  verified?: boolean;
}

function linkGlossaryInText(text: string, keyPrefix: string): React.ReactNode[] {
  const segments = splitGlossaryTerms(text);
  return segments.map((seg, i) =>
    seg.type === "text" ? (
      seg.value
    ) : (
      <Link
        key={`${keyPrefix}-${i}`}
        href={`/glossary#${seg.slug}`}
        className="font-medium text-blue-700 underline hover:text-blue-800"
      >
        {seg.term}
      </Link>
    )
  );
}

function renderContentWithCitations(
  content: string,
  citations: Citation[],
  onCitationClick: (citation: Citation) => void
) {
  const parts: React.ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let partKey = 0;
  let m;

  while ((m = regex.exec(content)) !== null) {
    const textSegment = content.slice(lastIndex, m.index);
    parts.push(
      <span key={`seg-${partKey++}`}>
        {linkGlossaryInText(textSegment, `gl-${partKey}`)}
      </span>
    );
    const n = parseInt(m[1], 10);
    const citation = citations.find((c) => c.marker === `[${n}]`);
    if (citation) {
      parts.push(
        <button
          key={m.index}
          type="button"
          onClick={() => onCitationClick(citation)}
          className="mx-0.5 inline-flex cursor-pointer rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-200"
        >
          [{n}]
        </button>
      );
    } else {
      parts.push(m[0]);
    }
    lastIndex = regex.lastIndex;
  }
  parts.push(
    <span key={`seg-${partKey}`}>{linkGlossaryInText(content.slice(lastIndex), `gl-end`)}</span>
  );

  return parts;
}

export function ChatMessage({
  role,
  content,
  citations = [],
  warning,
  knowledge_base_last_updated,
}: ChatMessageProps) {
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [copied, setCopied] = useState(false);

  const isUser = role === "user";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`group relative max-w-[85%] rounded-lg px-4 py-3 ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900"
        }`}
      >
        {warning && (
          <div className="mb-3 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            {warning}
          </div>
        )}

        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {isUser
            ? content
            : renderContentWithCitations(content, citations, setActiveCitation)}
        </div>

        {!isUser && (
          <p className="mt-3 text-xs text-gray-500">
            AI-generated summary based on ICC official documents. Not legal advice.
            {knowledge_base_last_updated && (
              <> Last updated from ICC records: {knowledge_base_last_updated}</>
            )}
          </p>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className={`absolute right-2 top-2 rounded p-1.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/10 ${
            isUser ? "text-white/90 hover:bg-white/20" : "text-gray-600 hover:bg-black/5"
          }`}
          title="Copy"
          aria-label="Copy message"
        >
          {copied ? (
            <span className={`text-xs ${isUser ? "text-green-200" : "text-green-600"}`}>Copied</span>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>

      {activeCitation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setActiveCitation(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Source passage"
        >
          <div
            className="max-h-[80vh] max-w-lg overflow-auto rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900">{activeCitation.document_title}</h3>
            <p className="mt-1 text-xs text-gray-500">{activeCitation.date_published}</p>
            <p className="mt-4 text-sm text-gray-700 leading-relaxed">
              {activeCitation.source_passage}
            </p>
            {activeCitation.url && (
              <a
                href={activeCitation.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 block text-sm text-blue-600 hover:underline"
              >
                View full document →
              </a>
            )}
            <button
              type="button"
              onClick={() => setActiveCitation(null)}
              className="mt-4 rounded bg-gray-200 px-3 py-1.5 text-sm hover:bg-gray-300"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
