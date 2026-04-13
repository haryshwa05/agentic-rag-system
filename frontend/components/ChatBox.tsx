"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, Database, Globe, BarChart2 } from "lucide-react";
import {
  queryDocument,
  searchDocument,
  chartDocument,
  getConversationMessages,
  FileInfo,
  ConversationInfo,
  QueryMode,
  Source,
} from "@/lib/api";
import MessageList, { Message } from "./MessageList";

interface ChatBoxProps {
  activeFile?: FileInfo;
  agentId?: string;
  agentName?: string;
  activeConversation: ConversationInfo | null;
}

const WEB_COLOR = "#0F6E56";
const CHART_COLOR = "#BA7517";

let _msgId = 0;
const nextId = () => `msg-${++_msgId}`;

export default function ChatBox({ activeFile, agentId, agentName, activeConversation }: ChatBoxProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState<QueryMode>("rag");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const prevConvId = useRef<string | null>(null);

  // Load message history when conversation changes
  useEffect(() => {
    const convId = activeConversation?.conversation_id ?? null;
    if (prevConvId.current === convId) return;
    prevConvId.current = convId;

    if (!convId) {
      setMessages([]);
      return;
    }

    setLoadingHistory(true);
    getConversationMessages(convId)
      .then((msgs) => {
        setMessages(
          msgs.map((m) => ({
            id: m.message_id,
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingHistory(false));
  }, [activeConversation?.conversation_id]);

  // Reset messages when file changes and no conversation is set (file mode only)
  useEffect(() => {
    if (activeFile && !activeConversation) setMessages([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.file_id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
    setStatusMessage(null);
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    );
  }, []);

  const modeColor =
    mode === "rag" ? "var(--color-accent)" : mode === "search" ? WEB_COLOR : CHART_COLOR;

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    setStatusMessage(null);

    const userMsg: Message = { id: nextId(), role: "user", content: q };
    const assistantId = nextId();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      isStreaming: true,
      mode: mode === "rag" ? undefined : mode,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    let aborted = false;
    const controller = new AbortController();

    const patchAssistant = (patch: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m))
      );
    };

    abortRef.current = () => {
      aborted = true;
      controller.abort();
    };

    // When a conversation is active the backend loads history from DB;
    // otherwise we pass the local message list for stateless mode.
    const chatHistory = activeConversation
      ? undefined
      : messages
          .filter((m) => !m.isStreaming && m.content)
          .map((m) => ({ role: m.role, content: m.content }));

    try {
      if (mode === "rag") {
        const data = await queryDocument(
          {
            question: q,
            file_id: agentId ? undefined : activeFile?.file_id,
            agent_id: agentId,
            chat_history: chatHistory,
            conversation_id: activeConversation?.conversation_id,
          },
          controller.signal
        );
        if (aborted) return;
        patchAssistant({
          content: data.answer,
          sources: data.sources as Source[] | undefined,
          isStreaming: false,
        });
      } else if (mode === "search") {
        const data = await searchDocument(q, controller.signal);
        if (aborted) return;
        patchAssistant({
          content: data.answer,
          searchSources: data.sources,
          isStreaming: false,
        });
      } else {
        const data = await chartDocument(q, controller.signal);
        if (aborted) return;
        patchAssistant({
          content: data.answer,
          chart: (data.chart ?? undefined) as unknown,
          isStreaming: false,
        });
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        patchAssistant({ isStreaming: false });
        return;
      }
      const err = e instanceof Error ? e.message : "Request failed.";
      patchAssistant({ content: `Error: ${err}`, isStreaming: false });
    } finally {
      setIsStreaming(false);
      setStatusMessage(null);
      abortRef.current = null;
    }
  }, [input, isStreaming, activeFile?.file_id, agentId, mode, messages, activeConversation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const extColors: Record<string, string> = {
    csv: "var(--color-csv)",
    xlsx: "var(--color-excel)",
    xls: "var(--color-excel)",
    pdf: "var(--color-pdf)",
  };
  const ext = activeFile?.file_name.split(".").pop()?.toLowerCase() ?? "";
  const extColor = extColors[ext] ?? "var(--color-text-2)";

  const placeholder =
    mode === "rag"
      ? "Ask about your file…"
      : mode === "search"
        ? "Search the web…"
        : "e.g. INR vs USD trend, Bitcoin price, India GDP growth…";

  const modeBtn = (m: QueryMode, icon: React.ReactNode, label: string) => {
    const active = mode === m;
    const c = m === "rag" ? "var(--color-accent)" : m === "search" ? WEB_COLOR : CHART_COLOR;
    return (
      <button
        type="button"
        onClick={() => !isStreaming && setMode(m)}
        disabled={isStreaming}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all shrink-0"
        style={
          active
            ? {
                background: `color-mix(in srgb, ${c} 20%, transparent)`,
                border: `1px solid color-mix(in srgb, ${c} 60%, transparent)`,
                color: c,
              }
            : {
                background: "transparent",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-2)",
              }
        }
      >
        {icon}
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div
        className="shrink-0 flex items-center justify-between px-5 py-2.5 border-b"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {agentId ? (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
                 style={{ background: "linear-gradient(135deg, var(--color-accent), #818cf8)" }}>
              {(agentName ?? "A").slice(0, 2).toUpperCase()}
            </div>
          ) : (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 uppercase"
              style={{
                color: extColor,
                background: `${extColor}20`,
                border: `1px solid ${extColor}40`,
                letterSpacing: "0.04em",
              }}
            >
              {ext}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-medium truncate" style={{ color: "var(--color-text)" }}>
              {agentId ? (agentName ?? "Agent") : (activeFile?.file_name ?? "")}
            </p>
            <p className="text-[11px]" style={{ color: "var(--color-text-3)" }}>
              {activeConversation
                ? activeConversation.title
                : agentId
                  ? "Select or create a conversation"
                  : activeFile?.chunks != null
                    ? `${activeFile?.chunks.toLocaleString()} chunks indexed`
                    : "No conversation selected"}
            </p>
          </div>
        </div>
        {isStreaming && (
          <div
            className="flex items-center gap-1.5 text-[11px] anim-fade-in min-w-0 max-w-[55%] justify-end"
            style={{ color: "var(--color-accent-text)" }}
          >
            <span className="dot-loader shrink-0">
              <span />
              <span />
              <span />
            </span>
            <span className="truncate" title={statusMessage ?? undefined}>
              {statusMessage ?? "Generating…"}
            </span>
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ background: "var(--color-bg)" }}
      >
        {loadingHistory ? (
          <div className="flex items-center justify-center h-full gap-2" style={{ color: "var(--color-text-3)" }}>
            <span className="dot-loader"><span /><span /><span /></span>
            <span className="text-[12px]">Loading conversation…</span>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
      </div>

      {/* Input — disabled with hint when no conversation is selected */}
      <div
        className="shrink-0 px-4 pb-5 pt-3"
        style={{ background: "var(--color-bg)", borderTop: "1px solid var(--color-border)" }}
      >
        {!activeConversation ? (
          <div className="max-w-[720px] mx-auto text-center py-4">
            <p className="text-[12px]" style={{ color: "var(--color-text-3)" }}>
              Select a conversation from the sidebar or create a new one to start chatting.
            </p>
          </div>
        ) : (
          <>
            <div
              className="max-w-[720px] mx-auto flex flex-col gap-2 rounded-xl p-3"
              style={{
                background: "var(--color-raised)",
                border: "1px solid var(--color-border-mid)",
                boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
              }}
            >
              <div className="flex flex-wrap gap-1.5">
                {modeBtn("rag", <Database size={12} />, "RAG")}
                {modeBtn("search", <Globe size={12} />, "Web")}
                {modeBtn("chart", <BarChart2 size={12} />, "Chart")}
              </div>
              <div className="flex items-end gap-2.5">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  rows={1}
                  className="flex-1 bg-transparent resize-none outline-none text-[13.5px] leading-relaxed min-h-[22px] max-h-[140px] overflow-y-auto"
                  style={{ color: "var(--color-text)", fontFamily: "var(--font-sans)" }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
                  }}
                  disabled={isStreaming}
                />
                {isStreaming ? (
                  <button
                    onClick={stopStreaming}
                    title="Stop"
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 hover:brightness-110 transition-all"
                    style={{
                      background: "var(--color-danger-dim)",
                      border: "1px solid rgba(239,68,68,0.25)",
                    }}
                  >
                    <Square size={13} style={{ color: "var(--color-danger)" }} />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    title="Send (Enter)"
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 active:scale-95"
                    style={{ background: modeColor }}
                  >
                    <Send size={13} className="text-white" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-center text-[10px] mt-2" style={{ color: "var(--color-text-3)" }}>
              Enter to send · Shift+Enter for new line
            </p>
          </>
        )}
      </div>
    </div>
  );
}
