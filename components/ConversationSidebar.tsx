"use client";

/**
 * Sliding sidebar with conversation list, New Conversation, delete, bookmark.
 * Collapses on narrow viewports; truncates long titles with hover tooltip.
 * On desktop: stays open when switching conversations. On mobile: closes on select.
 */

import { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";

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
}: {
  c: Conversation;
  currentId: string | null;
  onSelect: () => void;
  onDelete: () => void;
  onBookmark: () => void;
}) {
  return (
    <li className="group flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        title={c.title}
        className={`min-w-0 flex-1 rounded px-3 py-2 text-left text-sm hover:bg-gray-200 ${
          currentId === c.conversation_id ? "bg-gray-200 font-medium" : ""
        }`}
      >
        <span className="block min-w-0 truncate">{c.title}</span>
      </button>
      <div className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-gray-500 hover:bg-red-100 hover:text-red-600"
          title="Delete"
          aria-label="Delete conversation"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onBookmark}
          className={`rounded p-1 ${c.is_bookmarked ? "text-amber-500" : "text-gray-500 hover:bg-amber-50 hover:text-amber-600"}`}
          title={c.is_bookmarked ? "Unbookmark" : "Bookmark"}
          aria-label={c.is_bookmarked ? "Unbookmark" : "Bookmark"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill={c.is_bookmarked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
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
>(function ConversationSidebar({ currentId, onSelect, onNew, onDelete, open: controlledOpen, onOpenChange }, ref) {
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
    } catch {
      setConversations([]);
      setFetchError("Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({ refetch }), [refetch]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return (
    <>
      {/* Toggle button - visible when sidebar is closed (mobile only) */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`fixed left-0 top-20 z-40 rounded-r-md border border-l-0 border-gray-200 bg-gray-50 px-2 py-2 shadow-sm transition-all hover:bg-gray-100 md:hidden ${
          isOpen ? "-translate-x-full" : "translate-x-0"
        }`}
        aria-label="Open conversation list"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Backdrop when sidebar open on mobile */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Close sidebar"
        onClick={() => setIsOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setIsOpen(false)}
        className={`fixed inset-0 z-30 bg-black/20 md:hidden ${isOpen ? "block" : "hidden"}`}
      />

      <aside
        className={`flex h-full w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-gray-50 transition-transform duration-200 ease-out
          fixed left-0 top-0 z-40 h-full shadow-lg
          md:relative md:left-auto md:top-auto md:z-auto md:shadow-none
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden md:border-0 md:min-w-0"}`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-2">
          <button
            type="button"
            onClick={onNew}
            className="flex-1 rounded-md bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Conversation
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="ml-2 rounded p-1.5 text-gray-500 hover:bg-gray-200 md:hidden"
            aria-label="Close sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

      <div className="flex-1 overflow-auto px-2 pb-4">
        {loading ? (
          <p className="px-2 py-4 text-sm text-gray-500">Loading…</p>
        ) : fetchError ? (
          <div className="px-2 py-4">
            <p className="text-sm text-red-600">{fetchError}</p>
            <button
              type="button"
              onClick={refetch}
              className="mt-2 text-sm text-blue-600 hover:underline"
            >
              Retry
            </button>
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
