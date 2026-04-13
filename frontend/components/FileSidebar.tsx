"use client";

import { useState } from "react";
import {
  FileSpreadsheet, Trash2, Plus, FolderOpen,
  Hash, Lock, Globe, User, MessageSquare,
  PenLine, ChevronRight,
} from "lucide-react";
import {
  FileInfo, ConversationInfo,
  deleteFile as apiDeleteFile,
  deleteConversation as apiDeleteConversation,
  renameConversation,
} from "@/lib/api";

/* ── helpers ───────────────────────────────────────────────────── */

function relTime(dt: string | null | undefined): string {
  if (!dt) return "";
  const diff = Date.now() - new Date(dt + (dt.endsWith("Z") ? "" : "Z")).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/* ── props ─────────────────────────────────────────────────────── */

interface FileSidebarProps {
  files: FileInfo[];
  activeFile: FileInfo | null;
  onSelectFile: (f: FileInfo) => void;
  onDeleteFile: (fileId: string) => void;
  onUploadClick: () => void;
  conversations: ConversationInfo[];
  activeConversation: ConversationInfo | null;
  onSelectConversation: (c: ConversationInfo) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
}

/* ── component ──────────────────────────────────────────────────── */

export default function FileSidebar({
  files, activeFile, onSelectFile, onDeleteFile, onUploadClick,
  conversations, activeConversation,
  onSelectConversation, onNewConversation, onDeleteConversation, onRenameConversation,
}: FileSidebarProps) {
  const [editingConv, setEditingConv] = useState<string | null>(null);
  const [editTitle,   setEditTitle]   = useState("");

  const handleDeleteFile = async (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    try { await apiDeleteFile(fileId); onDeleteFile(fileId); } catch { /* ignore */ }
  };

  const handleDeleteConv = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await apiDeleteConversation(id); onDeleteConversation(id); } catch { /* ignore */ }
  };

  const startRename = (e: React.MouseEvent, conv: ConversationInfo) => {
    e.stopPropagation();
    setEditingConv(conv.conversation_id);
    setEditTitle(conv.title);
  };

  const commitRename = async (id: string) => {
    const t = editTitle.trim() || "New conversation";
    setEditingConv(null);
    try {
      await renameConversation(id, t);
      onRenameConversation(id, t);
    } catch { /* ignore */ }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--color-surface)" }}>

      {/* ── Files ─────────────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-1.5 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em]"
           style={{ color: "var(--color-text-3)" }}>Files</p>
      </div>

      <div className="overflow-y-auto px-2 pb-1 space-y-0.5" style={{ maxHeight: "40%" }}>
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
            <FolderOpen size={14} style={{ color: "var(--color-text-3)" }} />
            <p className="text-[11px]" style={{ color: "var(--color-text-3)" }}>No files yet</p>
          </div>
        ) : (
          files.map((file) => {
            const active = activeFile?.file_id === file.file_id;
            return (
              <div
                key={file.file_id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectFile(file)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectFile(file); } }}
                className="w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2.5 cursor-pointer group relative transition-all duration-150 outline-none focus-visible:ring-1"
                style={{
                  background: active ? "var(--color-accent-dim)" : "transparent",
                  boxShadow: active ? "inset 0 0 0 1px var(--color-border-strong)" : "none",
                }}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                        style={{ background: "var(--color-accent)" }} />
                )}
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                     style={{ background: active ? "var(--color-accent-dim)" : "var(--color-elevated)" }}>
                  <FileSpreadsheet size={11} style={{ color: active ? "var(--color-accent)" : "var(--color-text-2)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <p className="text-[12px] font-medium truncate flex-1"
                       style={{ color: active ? "var(--color-text)" : "var(--color-text-2)" }}>
                      {file.file_name}
                    </p>
                    {file.is_private
                      ? <Lock size={8} style={{ color: "var(--color-warning)", flexShrink: 0 }} />
                      : <Globe size={8} style={{ color: "var(--color-text-3)", flexShrink: 0 }} />}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {file.chunks != null && (
                      <span className="flex items-center gap-0.5 text-[9.5px]" style={{ color: "var(--color-text-3)" }}>
                        <Hash size={7} />{file.chunks.toLocaleString()}
                      </span>
                    )}
                    {(file.public_users?.length ?? 0) > 0 && (
                      <span className="flex items-center gap-0.5 text-[9.5px]" style={{ color: "var(--color-text-3)" }}
                            title={file.public_users!.join(", ")}>
                        <User size={7} />{file.public_users!.length}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteFile(e, file.file_id)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md transition-all shrink-0"
                  style={{ color: "var(--color-text-3)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-danger)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text-3)"; }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* ── Conversations ─────────────────────────────────────────── */}
      {activeFile && (
        <>
          <div className="px-4 pt-4 pb-1.5 shrink-0 flex items-center justify-between border-t"
               style={{ borderColor: "var(--color-border)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em]"
               style={{ color: "var(--color-text-3)" }}>Conversations</p>
            <button
              onClick={onNewConversation}
              title="New chat"
              className="p-1 rounded-md transition-all hover:brightness-110"
              style={{ color: "var(--color-accent-text)", background: "var(--color-accent-dim)" }}
            >
              <Plus size={10} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 gap-1.5">
                <MessageSquare size={13} style={{ color: "var(--color-text-3)" }} />
                <p className="text-[10.5px]" style={{ color: "var(--color-text-3)" }}>No conversations yet</p>
                <button
                  onClick={onNewConversation}
                  className="text-[10.5px] mt-1 px-2.5 py-1 rounded-md font-medium transition-all"
                  style={{ background: "var(--color-accent-dim)", color: "var(--color-accent-text)", border: "1px solid rgba(99,102,241,0.2)" }}
                >
                  Start chatting
                </button>
              </div>
            ) : (
              conversations.map((conv) => {
                const active = activeConversation?.conversation_id === conv.conversation_id;
                const editing = editingConv === conv.conversation_id;
                return (
                  <div
                    key={conv.conversation_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => !editing && onSelectConversation(conv)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !editing) onSelectConversation(conv); }}
                    className="w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2 cursor-pointer group relative transition-all duration-150 outline-none"
                    style={{
                      background: active ? "var(--color-accent-dim)" : "transparent",
                      boxShadow: active ? "inset 0 0 0 1px var(--color-border-strong)" : "none",
                    }}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
                            style={{ background: "var(--color-accent)" }} />
                    )}
                    <MessageSquare
                      size={11}
                      className="shrink-0 mt-0.5"
                      style={{ color: active ? "var(--color-accent)" : "var(--color-text-3)" }}
                    />
                    <div className="flex-1 min-w-0">
                      {editing ? (
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => commitRename(conv.conversation_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(conv.conversation_id);
                            if (e.key === "Escape") setEditingConv(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-transparent outline-none text-[11.5px]"
                          style={{ color: "var(--color-text)", borderBottom: "1px solid var(--color-accent)" }}
                        />
                      ) : (
                        <p className="text-[11.5px] font-medium truncate leading-snug"
                           style={{ color: active ? "var(--color-text)" : "var(--color-text-2)" }}>
                          {conv.title}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9.5px]" style={{ color: "var(--color-text-3)" }}>
                          {relTime(conv.updated_at)}
                        </span>
                        {conv.message_count > 0 && (
                          <span className="text-[9.5px]" style={{ color: "var(--color-text-3)" }}>
                            · {conv.message_count} msg
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                      <button
                        onClick={(e) => startRename(e, conv)}
                        className="p-1 rounded"
                        style={{ color: "var(--color-text-3)" }}
                        title="Rename"
                      >
                        <PenLine size={9} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteConv(e, conv.conversation_id)}
                        className="p-1 rounded"
                        style={{ color: "var(--color-text-3)" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-danger)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text-3)"; }}
                        title="Delete"
                      >
                        <Trash2 size={9} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* If no active file, take remaining space */}
      {!activeFile && <div className="flex-1" />}

      {/* ── Upload button ──────────────────────────────────────────── */}
      <div className="p-3 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
        <button
          onClick={onUploadClick}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium transition-all duration-150 active:scale-[0.98]"
          style={{
            background: "var(--color-accent-dim)",
            color: "var(--color-accent-text)",
            border: "1px solid var(--color-border-strong)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-accent)";
            (e.currentTarget as HTMLElement).style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-accent-dim)";
            (e.currentTarget as HTMLElement).style.color = "var(--color-accent-text)";
          }}
        >
          <Plus size={13} />
          New file
        </button>
      </div>
    </div>
  );
}
