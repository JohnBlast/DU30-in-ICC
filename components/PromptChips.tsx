"use client";

/**
 * First-run prompt chips (cursor-false-decline-reduction.md §5.1).
 * Visible when conversation is empty. Clicking submits the query.
 * Styled with Primer design system.
 */

import { Button } from "@primer/react";

interface PromptChipsProps {
  onSend: (query: string, pastedText?: string) => void;
  onOpenPaste?: () => void;
  disabled?: boolean;
  onChipClick?: (chipText: string) => void;
}

const CHIPS: Array<{ text: string; isFactCheck?: boolean }> = [
  { text: "Where is the case now? (summary)" },
  { text: "What is Duterte charged with?" },
  { text: "Who are the indirect co-perpetrators?" },
  { text: "When was the arrest warrant issued?" },
  { text: "What happens next in the case?" },
  { text: "What is crimes against humanity?" },
  { text: "Fact-check a post →", isFactCheck: true },
];

export function PromptChips({
  onSend,
  onOpenPaste,
  disabled,
  onChipClick,
}: PromptChipsProps) {
  function handleClick(chip: (typeof CHIPS)[0]) {
    if (disabled) return;
    onChipClick?.(chip.text);
    if (chip.isFactCheck && onOpenPaste) {
      onOpenPaste();
    } else {
      onSend(chip.text);
    }
  }

  return (
    <div className="flex flex-wrap justify-center gap-2 p-4 sm:gap-3 sm:p-6">
      {CHIPS.map((chip) => (
        <Button
          key={chip.text}
          variant="default"
          size="medium"
          onClick={() => handleClick(chip)}
          disabled={disabled}
          className="min-h-[44px] rounded-full px-4 transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
        >
          {chip.text}
        </Button>
      ))}
    </div>
  );
}
