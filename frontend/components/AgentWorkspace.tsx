"use client";

import { useState } from "react";
import {
  ArrowLeft, Plus, Trash2, FileText, MessageSquare,
  PenLine, Lock, Globe, ChevronDown, ChevronUp, X,
  Cpu,
} from "lucide-react";
import {
  AgentInfo, FileInfo, ConversationInfo, UploadResult,
  detachFileFromAgent, attachFilesToAgent,
  deleteConversation as apiDeleteConversation,
  renameConversation,
} from "@/lib/api";
import FileUploader from "./FileUploader";

/* ── helpers ───────────────────────────────────────────────────── */

function relTime(dt: string | null | undefined): string {
  if (!dt) return "";
  const diff = Date.now() - new Date(dt + (dt.endsWith("Z") ? "" : "Z")).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const STATUS_COLORS: Record<string, string> = {
  Approved:    "#10b981",
  Development: "#f59e0b",
  Archived:    "#6b7280",
};

/* ── Add Files picker ───────────────────────────────────────────── */

function AddFilesModal({
  agent,
  onClose,
  onAttached,
}: {
  agent: AgentInfo;
  onClose: () => void;
  onAttached: (agent: AgentInfo) => void;
}) {
  const [attaching, setAttaching] = useState(false);

  const handleUploaded = async (result: UploadResult) => {
    setAttaching(true);
    try {
      const updated = await attachFilesToAgent(agent.agent_id, [result.file_id]);
      onAttached(updated);
    } catch { /* ignore */ } finally { setAttaching(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade-in"
         style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
         onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-2xl anim-fade-up"
           style={{ background: "var(--color-raised)", border: "1px solid var(--color-border-mid)", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "var(--color-text)" }}>Add File to Agent</p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--color-text-3)" }}>
              Upload a file — it will be indexed and attached to <span style={{ color: "var(--color-accent-text)" }}>{agent.name}</span> automatically.
            </p>
          </div>
          <button onClick={onClose} style={{ color: "var(--color-text-3)" }}><X size={14} /></button>
        </div>
        <div className="p-5">
          {attaching ? (
            <div className="flex items-center justify-center py-8 gap-2" style={{ color: "var(--color-text-3)" }}>
              <span className="dot-loader"><span /><span /><span /></span>
              <span className="text-[12px]">Attaching to agent…</span>
            </div>
          ) : (
            <FileUploader onUploadComplete={handleUploaded} />
          )}
          <button onClick={onClose} className="w-full mt-3 py-2 rounded-lg text-[12px] transition-all"
                  style={{ background: "var(--color-elevated)", color: "var(--color-text-3)", border: "1px solid var(--color-border)" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Workspace Sidebar ──────────────────────────────────────────── */

interface AgentWorkspaceSidebarProps {
  agent: AgentInfo;
  agentFiles: FileInfo[];
  conversations: ConversationInfo[];
  activeConversation: ConversationInfo | null;
  onBack: () => void;
  onAgentUpdate: (agent: AgentInfo) => void;
  onSelectConversation: (c: ConversationInfo) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
}

export default function AgentWorkspaceSidebar({
  agent,
  agentFiles,
  conversations,
  activeConversation,
  onBack,
  onAgentUpdate,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
}: AgentWorkspaceSidebarProps) {
  const [filesOpen, setFilesOpen] = useState(true);
  const [showAddFiles, setShowAddFiles] = useState(false);
  const [editingConv, setEditingConv] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const statusColor = STATUS_COLORS[agent.status] ?? "#6b7280";

  const handleDetach = async (fileId: string) => {
    try {
      await detachFileFromAgent(agent.agent_id, fileId);
      onAgentUpdate({
        ...agent,
        file_ids: agent.file_ids.filter((f) => f !== fileId),
        file_count: agent.file_count - 1,
      });
    } catch { /* ignore */ }
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
    try { await renameConversation(id, t); onRenameConversation(id, t); } catch { /* ignore */ }
  };

  // agentFiles is passed in directly — already filtered to this agent

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--color-surface)" }}>

      {/* ── Back + Agent header ─────────────────────────────────── */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md mb-3 transition-all hover:brightness-110 w-full"
          style={{ color: "var(--color-text-3)", background: "var(--color-elevated)", border: "1px solid var(--color-border)" }}
        >
          <ArrowLeft size={11} />
          Agent Library
        </button>

        <div className="px-1 pb-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[13px] font-bold text-white"
                 style={{ background: "linear-gradient(135deg, var(--color-accent), #818cf8)" }}>
              {agent.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold leading-snug truncate" style={{ color: "var(--color-text)" }}>
                {agent.name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}33` }}>
                  {agent.status}
                </span>
                {agent.is_private
                  ? <Lock size={9} style={{ color: "var(--color-warning)" }} />
                  : <Globe size={9} style={{ color: "var(--color-text-3)" }} />}
              </div>
            </div>
          </div>
          {agent.model && (
            <div className="flex items-center gap-1 mt-2 text-[10.5px]" style={{ color: "var(--color-text-3)" }}>
              <Cpu size={10} />{agent.model}
            </div>
          )}
        </div>
      </div>

      {/* ── Files section ───────────────────────────────────────── */}
      <div className="shrink-0">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setFilesOpen((v) => !v)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setFilesOpen((v) => !v); }}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left cursor-pointer select-none"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: "var(--color-text-3)" }}>
            Files ({agentFiles.length})
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowAddFiles(true); }}
              className="p-1 rounded-md transition-all hover:brightness-110"
              style={{ color: "var(--color-accent-text)", background: "var(--color-accent-dim)" }}
              title="Add files"
            >
              <Plus size={10} />
            </button>
            {filesOpen ? <ChevronUp size={11} style={{ color: "var(--color-text-3)" }} /> : <ChevronDown size={11} style={{ color: "var(--color-text-3)" }} />}
          </div>
        </div>

        {filesOpen && (
          <div className="px-2 pb-1 space-y-0.5 max-h-[180px] overflow-y-auto">
            {agentFiles.length === 0 ? (
              <div className="flex flex-col items-center py-4 gap-2">
                <FileText size={13} style={{ color: "var(--color-text-3)" }} />
                <p className="text-[10.5px]" style={{ color: "var(--color-text-3)" }}>No files attached</p>
                <button onClick={() => setShowAddFiles(true)}
                        className="text-[10.5px] px-2.5 py-1 rounded-md font-medium"
                        style={{ background: "var(--color-accent-dim)", color: "var(--color-accent-text)", border: "1px solid rgba(99,102,241,0.2)" }}>
                  Add files
                </button>
              </div>
            ) : (
              agentFiles.map((f) => (
                <div key={f.file_id}
                     className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                     style={{ background: "transparent" }}>
                  <FileText size={11} style={{ color: "var(--color-text-3)", flexShrink: 0 }} />
                  <p className="text-[11.5px] flex-1 truncate" style={{ color: "var(--color-text-2)" }}>{f.file_name}</p>
                  <button
                    onClick={() => handleDetach(f.file_id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all"
                    style={{ color: "var(--color-text-3)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-danger)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-3)")}
                    title="Detach file"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="shrink-0 mx-3 border-t" style={{ borderColor: "var(--color-border)" }} />

      {/* ── Conversations section ────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: "var(--color-text-3)" }}>
          Conversations
        </span>
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
            <button onClick={onNewConversation}
                    className="text-[10.5px] mt-1 px-2.5 py-1 rounded-md font-medium"
                    style={{ background: "var(--color-accent-dim)", color: "var(--color-accent-text)", border: "1px solid rgba(99,102,241,0.2)" }}>
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
                <MessageSquare size={11} className="shrink-0 mt-0.5"
                               style={{ color: active ? "var(--color-accent)" : "var(--color-text-3)" }} />
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
                    <span className="text-[9.5px]" style={{ color: "var(--color-text-3)" }}>{relTime(conv.updated_at)}</span>
                    {conv.message_count > 0 && (
                      <span className="text-[9.5px]" style={{ color: "var(--color-text-3)" }}>· {conv.message_count} msg</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                  <button onClick={(e) => startRename(e, conv)} className="p-1 rounded" style={{ color: "var(--color-text-3)" }} title="Rename">
                    <PenLine size={9} />
                  </button>
                  <button onClick={(e) => handleDeleteConv(e, conv.conversation_id)} className="p-1 rounded" style={{ color: "var(--color-text-3)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-danger)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-3)")} title="Delete">
                    <Trash2 size={9} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showAddFiles && (
        <AddFilesModal
          agent={agent}
          onClose={() => setShowAddFiles(false)}
          onAttached={(updated) => { onAgentUpdate(updated); setShowAddFiles(false); }}
        />
      )}
    </div>
  );
}
