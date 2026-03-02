"use client";

/**
 * Chat page: sidebar + message list + input.
 * PRD §3 Journey 1, 2, 4. Task Group 8.
 * cursor-false-decline-reduction §5: PromptChips, WhatCanIAsk, telemetry.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ChatMessage, type Citation, type FactCheckResult } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { PromptChips } from "@/components/PromptChips";
import { WhatCanIAsk } from "@/components/WhatCanIAsk";
import { logUiEvent } from "@/lib/log-client";

type ResponseLanguage = "en" | "tl" | "taglish";

interface Message {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  warning?: string | null;
  knowledge_base_last_updated?: string;
  verified?: boolean;
  factCheck?: FactCheckResult | null;
}

export default function Home() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [capExceeded, setCapExceeded] = useState(false);
  const [resetDate, setResetDate] = useState<string>("");
  const [dailyLimitNudge, setDailyLimitNudge] = useState(false);
  const [conversationExpired, setConversationExpired] = useState(false);
  const [responseLanguage, setResponseLanguage] = useState<ResponseLanguage>("en");
  const [showPaste, setShowPaste] = useState(false);
  const lastDeclineRef = useRef<{ query: string; timestamp: number } | null>(null);
  const sidebarRef = useRef<{ refetch: () => Promise<void> }>(null);
  const skipNextLoadRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const loadMessages = useCallback(async (id: string) => {
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    setConversationExpired(false);
    const res = await fetch(`/api/conversations/${id}/messages`, {
      credentials: "same-origin",
    });
    if (!res.ok) {
      if (res.status === 410) {
        setConversationExpired(true);
        setMessages([]);
      }
      return;
    }
    const data = await res.json();
    const rawMessages = data.messages ?? [];
    const parsed: Message[] = rawMessages.map((m: { message_id: string; role: string; content: string; citations?: unknown }) => {
      const citationsRaw = m.citations;
      let citations: Citation[] = [];
      let factCheck: FactCheckResult | undefined;
      if (Array.isArray(citationsRaw)) {
        citations = citationsRaw as Citation[];
      } else if (citationsRaw && typeof citationsRaw === "object" && "citations" in citationsRaw) {
        citations = (citationsRaw.citations ?? []) as Citation[];
        factCheck = (citationsRaw as { factCheck?: FactCheckResult }).factCheck;
      }
      return {
        message_id: m.message_id,
        role: m.role as "user" | "assistant",
        content: m.content,
        citations,
        factCheck,
      };
    });
    setMessages(parsed);
    const validLanguages = ["en", "tl", "taglish"];
    if (data.response_language && validLanguages.includes(data.response_language)) {
      setResponseLanguage(data.response_language as ResponseLanguage);
    } else {
      setResponseLanguage("en");
    }
  }, []);

  useEffect(() => {
    if (conversationId) {
      loadMessages(conversationId);
    } else {
      setMessages([]);
      setConversationExpired(false);
    }
  }, [conversationId, loadMessages]);

  useEffect(() => {
    fetch("/api/usage", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !data.underCap) {
          setCapExceeded(true);
          setResetDate(data.resetDate ?? "");
        }
      })
      .catch(() => {});
  }, []);

  async function handleNewConversation() {
    setConversationId(null);
    setMessages([]);
    setConversationExpired(false);
    setResponseLanguage("en");
  }

  function handleSelectConversation(id: string) {
    setConversationId(id);
  }

  async function handleSend(query: string, pastedText?: string) {
    if (lastDeclineRef.current && Date.now() - lastDeclineRef.current.timestamp < 60_000) {
      logUiEvent("rephrase_after_decline", {
        original_query: lastDeclineRef.current.query.slice(0, 50),
        new_query: query.slice(0, 50),
      });
    }
    lastDeclineRef.current = null;

    const userContent = pastedText ? `[Pasted text]\n${pastedText}\n\n${query}` : query;
    const userMsgId = "u-" + Date.now();

    setMessages((prev) => [
      ...prev,
      { message_id: userMsgId, role: "user", content: userContent },
    ]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          query,
          pastedText: pastedText || undefined,
          conversationId: conversationId || undefined,
          responseLanguage,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429 && data.capExceeded) {
          setCapExceeded(true);
          setResetDate(data.resetDate ?? "");
        }
        setMessages((prev) => [
          ...prev,
          {
            message_id: "err-" + Date.now(),
            role: "assistant",
            content: data.answer ?? "Something went wrong.",
          },
        ]);
        return;
      }

      if (data.dailyLimitReached) setDailyLimitNudge(true);

      const assistantMsg = {
        message_id: "a-" + Date.now(),
        role: "assistant" as const,
        content: data.answer,
        citations: data.citations ?? [],
        warning: data.warning ?? null,
        knowledge_base_last_updated: data.knowledge_base_last_updated,
        verified: data.verified,
        factCheck: data.factCheck ?? null,
      };
      if (data.answer?.trim().startsWith("This is not addressed in current ICC records.")) {
        lastDeclineRef.current = { query, timestamp: Date.now() };
      }
      setMessages((prev) => [...prev, assistantMsg]);

      if (data.conversationId && !conversationId) {
        skipNextLoadRef.current = true;
        setConversationId(data.conversationId);
        if (responseLanguage !== "en") {
          await fetch(`/api/conversations/${data.conversationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ response_language: responseLanguage }),
          });
        }
      }
      await sidebarRef.current?.refetch();
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          message_id: "err-" + Date.now(),
          role: "assistant",
          content: "The Q&A service is temporarily unavailable. Please try again shortly.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <ConversationSidebar
        ref={sidebarRef}
        currentId={conversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={(id) => {
          if (id === conversationId) handleNewConversation();
        }}
      />

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-900">The Docket</h1>
            <a
              href="/glossary"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Glossary
            </a>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Response:</span>
              <select
                value={responseLanguage}
                onChange={async (e) => {
                  const lang = e.target.value as ResponseLanguage;
                  setResponseLanguage(lang);
                  if (conversationId) {
                    await fetch(`/api/conversations/${conversationId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      credentials: "same-origin",
                      body: JSON.stringify({ response_language: lang }),
                    });
                  }
                }}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700"
              >
                <option value="en">English</option>
                <option value="tl">Tagalog</option>
                <option value="taglish">Tanglish</option>
              </select>
            </div>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              Sign out
            </button>
          </form>
        </header>

        <div className="flex-1 overflow-auto">
          {conversationExpired ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <h2 className="text-lg font-semibold text-gray-900">
                This conversation has expired
              </h2>
              <p className="mt-2 max-w-md text-sm text-gray-600">
                Please start a new conversation.
              </p>
              <button
                type="button"
                onClick={handleNewConversation}
                className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                New conversation
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <h2 className="text-lg font-semibold text-gray-900">
                Ask a question about the Duterte ICC case
              </h2>
              <p className="mt-2 max-w-md text-sm text-gray-600">
                Try: &ldquo;What is Duterte charged with?&rdquo; or &ldquo;What does in absentia
                mean?&rdquo; You can also paste text from an ICC document.
              </p>
              <PromptChips
                onSend={handleSend}
                onOpenPaste={() => setShowPaste(true)}
                disabled={loading}
                onChipClick={(text) => logUiEvent("chip_clicked", { chip_text: text })}
              />
            </div>
          ) : (
            <div className="space-y-4 p-6">
              {messages.map((m, i) => (
                <ChatMessage
                  key={m.message_id}
                  role={m.role}
                  content={m.content}
                  citations={m.citations}
                  warning={m.warning}
                  knowledge_base_last_updated={m.knowledge_base_last_updated}
                  factCheck={m.factCheck}
                  previousUserQuery={
                    m.role === "assistant" && i > 0 && messages[i - 1].role === "user"
                      ? (messages[i - 1].content.startsWith("[Pasted text]")
                          ? messages[i - 1].content.replace(/^\[Pasted text\][\s\S]*?\n\n/, "").trim()
                          : messages[i - 1].content
                        ).slice(0, 50)
                      : undefined
                  }
                  onDeclineShown={(qp) => logUiEvent("decline_shown", { query_preview: qp })}
                />
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.3s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.15s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-blue-500" />
                    </div>
                    <span className="text-sm text-gray-600">Generating response…</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-gray-100">
          <WhatCanIAsk onOpen={() => logUiEvent("what_can_i_ask_opened", {})} />
        </div>
        {dailyLimitNudge && (
          <div className="border-t border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-800">
            You&apos;ve reached your suggested daily limit. You can still ask questions, but please
            be mindful of shared resources.
          </div>
        )}
        <ChatInput
          onSend={handleSend}
          disabled={loading}
          capExceeded={capExceeded}
          resetDate={resetDate}
          showPaste={showPaste}
          onShowPasteChange={setShowPaste}
        />
      </div>
    </div>
  );
}
