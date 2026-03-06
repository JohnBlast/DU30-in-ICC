"use client";

/**
 * Sliding sidebar with conversation list, New Conversation, delete, bookmark.
 * Collapses on narrow viewports; truncates long titles with hover tooltip.
 * On desktop: stays open when switching conversations. On mobile: closes on select.
 * Styled with Primer design system.
 */

import { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { Button } from "@primer/react";
import { TrashIcon, BookmarkIcon, XIcon } from "@primer/octicons-react";

const MOBILE_BREAKPOINT = 768;

interface Conversation {
  conversation_id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  is_bookmarked?: boolean;
}

interface ConversationSidebarProps {
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onPrefetch?: (id: string) => void;
  onConversationsLoaded?: (conversationIds: string[]) => void;
  /** Controlled open state (optional). If not provided, sidebar manages its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function ConversationItem({
  c,
  currentId,
  onSelect,
  onDelete,
  onBookmark,
  onPrefetch,
}: {
  c: Conversation;
  currentId: string | null;
  onSelect: () => void;
  onDelete: () => void;
  onBookmark: () => void;
  onPrefetch?: () => void;
}) {
  return (
    <li
      className="group flex min-w-0 items-center gap-1"
      onMouseEnter={onPrefetch}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        title={c.title}
        className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-gray-200 ${
          currentId === c.conversation_id ? "bg-gray-200 font-medium" : "hover:bg-gray-100"
        }`}
      >
        <span className="block min-w-0 truncate">{c.title}</span>
      </button>
      <div className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1.5 text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600"
          title="Delete"
          aria-label="Delete conversation"
        >
          <TrashIcon size={16} />
        </button>
        <button
          type="button"
          onClick={onBookmark}
          className={`rounded p-1.5 transition-colors ${c.is_bookmarked ? "text-amber-500" : "text-gray-500 hover:bg-amber-50 hover:text-amber-600"}`}
          title={c.is_bookmarked ? "Unbookmark" : "Bookmark"}
          aria-label={c.is_bookmarked ? "Unbookmark" : "Bookmark"}
        >
          <BookmarkIcon size={16} />
        </button>
      </div>
    </li>
  );
}

async function fetchConversations(): Promise<{ conversations: Conversation[]; error?: string }> {
  const res = await fetch("/api/conversations", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { conversations: [], error: data.error ?? `Failed to load (${res.status})` };
  }
  return { conversations: data.conversations ?? [] };
}

export const ConversationSidebar = forwardRef<
  { refetch: () => Promise<void> },
  ConversationSidebarProps
>(function ConversationSidebar({ currentId, onSelect, onNew, onDelete, onPrefetch, onConversationsLoaded, open: controlledOpen, onOpenChange }, ref) {
  const [internalOpen, setInternalOpen] = useState(true);
  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await fetchConversations();
      setConversations(result.conversations);
      if (result.error) setFetchError(result.error);
      const ids = result.conversations.map((c) => c.conversation_id);
      if (ids.length > 0) onConversationsLoaded?.(ids);
    } catch {
      setConversations([]);
      setFetchError("Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, [onConversationsLoaded]);

  useImperativeHandle(ref, () => ({ refetch }), [refetch]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return (
    <>
      {/* Backdrop when sidebar open on mobile */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Close sidebar"
        onClick={() => setIsOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setIsOpen(false)}
        className={`fixed inset-0 z-30 bg-black/20 transition-opacity duration-200 md:hidden ${isOpen ? "block" : "hidden"}`}
      />

      <aside
        className={`flex h-full w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-gray-50 transition-transform duration-200 ease-out
          fixed left-0 top-0 z-40 h-full shadow-lg
          md:relative md:left-auto md:top-auto md:z-auto md:shadow-none
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden md:border-0 md:min-w-0"}`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-2">
          <Button variant="primary" size="medium" className="flex-1 transition-opacity hover:opacity-95 active:opacity-90" onClick={onNew}>
            New Conversation
          </Button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="ml-2 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded p-1.5 text-gray-500 hover:bg-gray-200 active:bg-gray-300 md:hidden"
          aria-label="Close sidebar"
        >
          <XIcon size={20} />
        </button>
        </div>

      <div className="flex-1 overflow-auto px-2 pb-4">
        {loading ? (
          <p className="px-2 py-4 text-sm text-gray-500 animate-pulse">Loading…</p>
        ) : fetchError ? (
          <div className="px-2 py-4">
            <p className="text-sm text-red-600">{fetchError}</p>
            <Button variant="link" size="small" onClick={refetch} className="mt-2">
              Retry
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-4 text-sm text-gray-500">No conversations yet</p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c) => (
              <ConversationItem
                key={c.conversation_id}
                c={c}
                currentId={currentId}
                onPrefetch={currentId !== c.conversation_id ? () => onPrefetch?.(c.conversation_id) : undefined}
                onSelect={() => {
                  onSelect(c.conversation_id);
                  if (isMobile) setIsOpen(false);
                }}
                onDelete={async () => {
                  const ok = window.confirm("Delete this conversation?");
                  if (!ok) return;
                  const res = await fetch(`/api/conversations/${c.conversation_id}`, {
                    method: "DELETE",
                    credentials: "same-origin",
                  });
                  if (res.ok) {
                    await refetch();
                    onDelete?.(c.conversation_id);
                  }
                }}
                onBookmark={async () => {
                  const res = await fetch(`/api/conversations/${c.conversation_id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    credentials: "same-origin",
                    body: JSON.stringify({ is_bookmarked: !c.is_bookmarked }),
                  });
                  if (res.ok) await refetch();
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
    </>
  );
});
