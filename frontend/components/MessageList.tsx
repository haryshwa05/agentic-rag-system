"use client";

import { Bot, User, FileSpreadsheet, Rows3, Sparkles } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: {
    file_name: string;
    sheet_name: string;
    row_start: number;
    row_end: number;
    score: number;
  }[];
  isStreaming?: boolean;
}

interface MessageListProps {
  messages: Message[];
}

export default function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-full p-10 text-center">
        <div className="max-w-xs space-y-6 animate-fade-up">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
            style={{
              background: "var(--color-accent-soft)",
              border: "1px solid var(--color-border-strong)",
              boxShadow: "0 0 30px var(--color-accent-glow)",
            }}
          >
            <Sparkles size={22} style={{ color: "var(--color-accent)" }} />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--color-ink)" }}>
              Ask anything about your data
            </h3>
            <p className="text-[13px] mt-2 leading-relaxed" style={{ color: "var(--color-ink-muted)" }}>
              Select a file from the sidebar and ask questions in plain English.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {["Total sales this quarter?", "Top 5 by revenue", "Show Q4 trends"].map((q) => (
              <span
                key={q}
                className="text-[11px] px-3 py-1.5 rounded-full font-medium"
                style={{
                  background: "var(--color-surface-2)",
                  color: "var(--color-ink-muted)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {q}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 space-y-4 max-w-3xl mx-auto w-full">
      {messages.map((msg, idx) => (
        <div
          key={msg.id}
          className="animate-fade-up"
          style={{ animationDelay: `${Math.min(idx * 0.03, 0.15)}s` }}
        >
          {msg.role === "user" ? (
            <UserMessage content={msg.content} />
          ) : (
            <AssistantMessage content={msg.content} sources={msg.sources} isStreaming={msg.isStreaming} />
          )}
        </div>
      ))}
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end gap-3 items-end">
      <div className="max-w-[75%]">
        <div
          className="rounded-2xl rounded-br-sm px-4 py-3"
          style={{
            background: "linear-gradient(135deg, var(--color-accent) 0%, #6366f1 100%)",
            boxShadow: "0 4px 20px rgba(129,140,248,0.25)",
          }}
        >
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-white">{content}</p>
        </div>
      </div>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: "var(--color-surface-3)",
          border: "1px solid var(--color-border-strong)",
        }}
      >
        <User size={12} style={{ color: "var(--color-ink-muted)" }} />
      </div>
    </div>
  );
}

function AssistantMessage({
  content,
  sources,
  isStreaming,
}: {
  content: string;
  sources?: Message["sources"];
  isStreaming?: boolean;
}) {
  return (
    <div className="flex justify-start gap-3 items-end">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: "var(--color-accent-soft)",
          border: "1px solid var(--color-border-strong)",
          boxShadow: isStreaming ? "0 0 12px var(--color-accent-glow)" : "none",
        }}
      >
        <Bot size={12} style={{ color: "var(--color-accent)" }} />
      </div>

      <div className="max-w-[80%] space-y-2">
        <div
          className="rounded-2xl rounded-tl-sm px-4 py-3"
          style={{
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
          }}
        >
          {content ? (
            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--color-ink)" }}>
              {content}
              {isStreaming && (
                <span
                  className="inline-block w-0.5 h-3.5 ml-0.5 rounded-sm cursor-blink align-text-bottom"
                  style={{ background: "var(--color-accent)" }}
                />
              )}
            </p>
          ) : isStreaming ? (
            <span className="dot-loader" style={{ color: "var(--color-ink-faint)" }}>
              <span /><span /><span />
            </span>
          ) : null}
        </div>

        {/* Sources */}
        {sources && sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-1 items-center">
            <span
              className="text-[10px] flex items-center gap-1"
              style={{ color: "var(--color-ink-faint)" }}
            >
              <Rows3 size={9} /> Sources
            </span>
            {sources.slice(0, 4).map((src, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md font-medium"
                style={{
                  background: "var(--color-surface-3)",
                  color: "var(--color-ink-muted)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <FileSpreadsheet size={9} style={{ color: "var(--color-accent)" }} />
                {src.sheet_name !== "default" ? src.sheet_name : src.file_name}
                <span style={{ color: "var(--color-ink-faint)" }}>
                  {src.row_start}–{src.row_end}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
