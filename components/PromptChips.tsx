"use client";

/**
 * First-run prompt chips (cursor-false-decline-reduction.md §5.1).
 * Visible when conversation is empty. Clicking submits the query.
 */

interface PromptChipsProps {
  onSend: (query: string, pastedText?: string) => void;
  onOpenPaste?: () => void;
  disabled?: boolean;
  onChipClick?: (chipText: string) => void;
}

const CHIPS: Array<{ text: string; isFactCheck?: boolean }> = [
  { text: "What is Duterte charged with?" },
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
    <div className="flex flex-wrap justify-center gap-2 p-4">
      {CHIPS.map((chip) => (
        <button
          key={chip.text}
          type="button"
          onClick={() => handleClick(chip)}
          disabled={disabled}
          className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {chip.text}
        </button>
      ))}
    </div>
  );
}
