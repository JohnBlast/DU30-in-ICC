"use client";

/**
 * "What Can I Ask?" expandable section (cursor-false-decline-reduction.md §5.2).
 * Collapsed by default; expands on click.
 * Styled with Primer design system.
 */

import { useState } from "react";
import { ChevronDownIcon } from "@primer/octicons-react";

interface WhatCanIAskProps {
  onOpen?: () => void;
}

export function WhatCanIAsk({ onOpen }: WhatCanIAskProps) {
  const [expanded, setExpanded] = useState(false);

  function toggle() {
    if (!expanded) onOpen?.();
    setExpanded((v) => !v);
  }

  return (
    <div className="border-t border-gray-200 transition-colors">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex min-h-[44px] w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
      >
        <span className="flex items-center gap-2">
          <span className="text-base text-gray-500">?</span>
          What can I ask?
        </span>
        <ChevronDownIcon
          size={20}
          className={`shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/80 px-4 py-4 text-sm text-gray-700">
          <p className="mb-3 font-medium text-gray-900">
            The Docket answers questions about the Duterte ICC case using only official ICC documents.
          </p>
          <div className="space-y-2">
            <p className="font-medium text-green-800">✓ You can ask about:</p>
            <ul className="ml-4 list-disc space-y-1 text-gray-600">
              <li>The charges and counts against Duterte</li>
              <li>Timeline and key dates of the case</li>
              <li>ICC legal concepts (Rome Statute, crimes against humanity)</li>
              <li>What happens next in the proceedings</li>
              <li>Legal terms (in absentia, proprio motu)</li>
              <li>Paste social media posts to fact-check them</li>
            </ul>
            <p className="pt-2 font-medium text-amber-800">✗ Out of scope:</p>
            <ul className="ml-4 list-disc space-y-1 text-gray-600">
              <li>Opinions about guilt or innocence</li>
              <li>Other ICC cases or political commentary</li>
              <li>General knowledge questions</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
