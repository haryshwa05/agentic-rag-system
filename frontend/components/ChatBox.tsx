"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, StopCircle, Search, Sparkles, FileSpreadsheet } from "lucide-react";
import { queryStream } from "@/lib/api";
import MessageList, { Message } from "./MessageList";

interface ChatBoxProps {
  fileId: string | null;
  fileName: string | null;
}

type Phase = "idle" | "searching" | "generating";

const PHASE_LABELS: Record<Phase, string> = {
  idle:       "",
  searching:  "Searching your data…",
  generating: "Generating answer…",
};

export default function ChatBox({ fileId, fileName }: ChatBoxProps) {
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [input,       setInput]       = useState("");
  const [isStreaming, setIsStreaming]  = useState(false);
  const [phase,       setPhase]       = useState<Phase>("idle");
  const scrollRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const abortRef   = useRef(false);
  // Track whether any token arrived yet (to distinguish searching vs generating)
  const gotTokenRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, phase]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || isStreaming) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: question };
    const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: "assistant", content: "", isStreaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsStreaming(true);
    setPhase("searching");
    abortRef.current   = false;
    gotTokenRef.current = false;

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      await queryStream(question, fileId, null, history, (token: string) => {
        if (abortRef.current) return;

        // First token arriving means search is done — switch to generating phase
        if (!gotTokenRef.current) {
          gotTokenRef.current = true;
          setPhase("generating");
        }

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last.role === "assistant") {
            return [...prev.slice(0, -1), { ...last, content: last.content + token }];
          }
          return prev;
        });
      });
    } catch (err: unknown) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last.role === "assistant" && !last.content) {
          const msg = err instanceof Error ? err.message : "Something went wrong";
          return [...prev.slice(0, -1), { ...last, content: `Error: ${msg}` }];
        }
        return prev;
      });
    } finally {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last.role === "assistant") {
          return [...prev.slice(0, -1), { ...last, isStreaming: false }];
        }
        return prev;
      });
      setIsStreaming(false);
      setPhase("idle");
    }
  }, [input, isStreaming, fileId, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleStop = () => {
    abortRef.current = true;
    setIsStreaming(false);
    setPhase("idle");
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last.role === "assistant") {
        return [...prev.slice(0, -1), { ...last, isStreaming: false }];
      }
      return prev;
    });
  };

  const disabled = !fileId;

  return (
    <div className="flex flex-col h-full bg-surface-0">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <MessageList messages={messages} />

        {/* Live phase indicator — shown below messages while streaming */}
        {isStreaming && (
          <div className="px-4 pb-4 animate-fade-in">
            <div className="flex items-center gap-2.5 max-w-xl">
              <div className={[
                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                phase === "searching"  ? "bg-warning-soft text-warning"  : "",
                phase === "generating" ? "bg-accent-soft text-accent"    : "",
              ].join(" ")}>
                {phase === "searching"  && <Search   size={15} />}
                {phase === "generating" && <Sparkles size={15} />}
              </div>
              <div className="flex items-center gap-2 bg-surface-1 border border-border rounded-xl px-3 py-2">
                <span className="text-xs font-medium text-ink-muted">
                  {PHASE_LABELS[phase]}
                </span>
                <span className="dot-loader text-ink-faint">
                  <span /><span /><span />
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-surface-1 px-4 py-3 space-y-2">
        {/* Context pill */}
        {fileId && fileName && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent-soft rounded-full">
              <FileSpreadsheet size={11} className="text-accent" />
              <span className="text-[11px] font-medium text-accent-text truncate max-w-50">
                {fileName}
              </span>
            </div>
          </div>
        )}

        {disabled && (
          <p className="text-xs text-ink-faint text-center pb-1">
            Upload a file first to start asking questions
          </p>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? "Upload a file to get started…" : "Ask a question about your data…"}
            disabled={disabled}
            rows={1}
            className="
              flex-1 resize-none rounded-xl border border-border bg-surface-0
              px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint
              focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10
              transition-all disabled:opacity-40 disabled:cursor-not-allowed
            "
          />

          {isStreaming ? (
            <button
              onClick={handleStop}
              title="Stop generating"
              className="shrink-0 w-10 h-10 rounded-xl bg-danger-soft text-danger
                         flex items-center justify-center hover:bg-danger hover:text-white transition-all"
            >
              <StopCircle size={18} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={disabled || !input.trim()}
              title="Send"
              className={[
                "shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150",
                disabled || !input.trim()
                  ? "bg-surface-2 text-ink-faint cursor-not-allowed"
                  : "bg-accent text-white hover:bg-accent-hover active:scale-95 shadow-sm",
              ].join(" ")}
            >
              <Send size={16} />
            </button>
          )}
        </div>

        <p className="text-[10px] text-ink-faint text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
