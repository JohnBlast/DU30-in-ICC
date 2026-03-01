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

export type ClaimVerdict =
  | "verified"
  | "false"
  | "unverifiable"
  | "not_in_icc_records"
  | "opinion";

export interface VerifiedClaim {
  extractedText: string;
  verdict: ClaimVerdict;
  iccSays: string | null;
  citationMarker: string;
  evidenceType?: string;
}

export interface FactCheckResult {
  overallVerdict: ClaimVerdict;
  pastedContentPreview: string;
  claims: VerifiedClaim[];
  copyText: string;
  mode?: string;
  inputPreview?: string;
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  warning?: string | null;
  knowledge_base_last_updated?: string;
  verified?: boolean;
  factCheck?: FactCheckResult | null;
}

/** Parse user message content that may include pasted text */
function parseUserContent(content: string): { pasted?: string; query: string } | null {
  if (!content.startsWith("[Pasted text]\n")) return null;
  const rest = content.slice("[Pasted text]\n".length);
  const idx = rest.lastIndexOf("\n\n");
  if (idx === -1) return null;
  return {
    pasted: rest.slice(0, idx).trim(),
    query: rest.slice(idx + 2).trim(),
  };
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

const verdictColors: Record<string, { bg: string; text: string; label: string }> = {
  verified: { bg: "bg-green-100", text: "text-green-800", label: "VERIFIED" },
  false: { bg: "bg-red-100", text: "text-red-800", label: "FALSE" },
  unverifiable: { bg: "bg-gray-100", text: "text-gray-600", label: "UNVERIFIABLE" },
  not_in_icc_records: { bg: "bg-gray-100", text: "text-gray-600", label: "NOT IN ICC RECORDS" },
  opinion: { bg: "bg-blue-100", text: "text-blue-700", label: "OPINION" },
  out_of_scope: { bg: "bg-gray-100", text: "text-gray-500", label: "OUT OF SCOPE" },
};

function getClaimSummary(claims: VerifiedClaim[]): string {
  const total = claims.length;
  const falseCount = claims.filter((c) => c.verdict === "false").length;
  const verifiedCount = claims.filter((c) => c.verdict === "verified").length;

  if (falseCount > 0) return `${total} claim${total !== 1 ? "s" : ""} checked — ${falseCount} false`;
  if (verifiedCount === total) return `${total} claim${total !== 1 ? "s" : ""} verified`;
  return `${total} claim${total !== 1 ? "s" : ""} checked`;
}

function VerdictBadge({ verdict, evidenceType }: { verdict: ClaimVerdict; evidenceType?: string }) {
  const displayKey =
    verdict === "opinion" && evidenceType === "out_of_scope" ? "out_of_scope" : verdict;
  const style = verdictColors[displayKey] ?? verdictColors.unverifiable;
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

export function ChatMessage({
  role,
  content,
  citations = [],
  warning,
  knowledge_base_last_updated,
  factCheck,
}: ChatMessageProps) {
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pastedExpanded, setPastedExpanded] = useState(false);

  const isUser = role === "user";
  const parsedUser = isUser ? parseUserContent(content) : null;

  async function handleCopy() {
    try {
      const text = factCheck?.copyText ?? content;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className={`flex w-full min-w-0 ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`group relative max-w-[85%] overflow-visible rounded-lg px-4 py-3 ${
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

        {!isUser && factCheck && (
          <div className="mb-2">
            <div
              className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
              onClick={() => setExpanded(!expanded)}
            >
              <div className="flex items-center gap-3">
                <VerdictBadge verdict={factCheck.overallVerdict} />
                <span className="text-sm text-gray-600">
                  {getClaimSummary(factCheck.claims)}
                </span>
              </div>
              <svg
                className={`h-5 w-5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {expanded && (
              <div className="mb-3 mt-3 space-y-3">
                {factCheck.claims.length > 0 && (
                  <div className="space-y-2">
                    {factCheck.claims.map((c, i) => {
                      const borderColor: Record<string, string> = {
                        verified: "border-l-green-500",
                        false: "border-l-red-500",
                        unverifiable: "border-l-gray-400",
                        not_in_icc_records: "border-l-gray-400",
                        opinion: "border-l-blue-400",
                      };
                      const key =
                        c.verdict === "opinion" && c.evidenceType === "out_of_scope"
                          ? "opinion"
                          : c.verdict;
                      const markers = (c.citationMarker ?? "")
                        .match(/\[\d+\]/g)
                        ?.map((m) => citations?.find((cit) => cit.marker === m))
                        .filter(Boolean) as Citation[] | undefined;
                      return (
                        <div
                          key={i}
                          className={`rounded-lg border border-gray-200 border-l-4 ${borderColor[key] ?? "border-l-gray-400"} bg-white px-4 py-3 text-sm shadow-sm`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                              <p className="font-medium leading-snug text-gray-900">
                                &ldquo;{c.extractedText}&rdquo;
                              </p>
                              {markers && markers.length > 0 && (
                                <span className="flex items-center gap-1">
                                  {markers.map((cit) => (
                                    <button
                                      key={cit.marker}
                                      type="button"
                                      onClick={() => setActiveCitation(cit)}
                                      className="inline-flex cursor-pointer rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-200"
                                    >
                                      {cit.marker}
                                    </button>
                                  ))}
                                </span>
                              )}
                            </div>
                            <div className="shrink-0 pt-0.5">
                              <VerdictBadge verdict={c.verdict} evidenceType={c.evidenceType} />
                            </div>
                          </div>

                          {c.verdict === "opinion" && c.evidenceType === "out_of_scope" ? (
                            <p className="mt-2 text-sm italic text-gray-500">
                              Outside the scope of the Duterte ICC case.
                            </p>
                          ) : c.verdict === "opinion" ? (
                            <p className="mt-2 text-sm italic text-gray-500">
                              Statement of opinion — not a verifiable factual claim.
                            </p>
                          ) : c.iccSays ? (
                            <div className="mt-2 rounded bg-gray-50 px-3 py-2">
                              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                                ICC Documents
                              </p>
                              <p className="text-sm leading-relaxed text-gray-700">{c.iccSays}</p>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Copy fact-check
                </button>
              </div>
            )}
          </div>
        )}

        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {isUser ? (
            parsedUser ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-white/30 bg-white/10">
                  <button
                    type="button"
                    onClick={() => setPastedExpanded(!pastedExpanded)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                  >
                    <span className="font-medium opacity-90">[Pasted text]</span>
                    <svg
                      className={`h-4 w-4 opacity-80 transition-transform ${pastedExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {pastedExpanded && parsedUser.pasted && (
                    <div className="max-h-48 overflow-y-auto border-t border-white/20 px-3 py-2 text-sm opacity-90">
                      {parsedUser.pasted}
                    </div>
                  )}
                </div>
                <p>{parsedUser.query}</p>
              </div>
            ) : (
              content
            )
          ) : (
            renderContentWithCitations(content, citations, setActiveCitation)
          )}
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
          className={`absolute right-3 top-3 z-10 rounded p-1.5 opacity-0 transition-opacity pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-black/10 ${
            isUser ? "text-white/90 hover:bg-white/20" : "text-gray-600 hover:bg-black/5"
          }`}
          title={factCheck ? "Copy fact-check" : "Copy"}
          aria-label={factCheck ? "Copy fact-check" : "Copy message"}
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
