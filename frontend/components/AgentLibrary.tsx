"use client";

import { useState } from "react";
import {
  Bot, Plus, Trash2, ChevronRight, Lock, Globe,
  MessageSquare, FileText, Calendar, User, Tag,
  Cpu, Search, X, CheckCircle2, Clock, Archive, CheckCheck,
} from "lucide-react";
import type { AgentInfo, AgentCreate, UploadResult } from "@/lib/api";
import { createAgent, deleteAgent } from "@/lib/api";
import FileUploader from "./FileUploader";

/* ── helpers ───────────────────────────────────────────────────── */

function fmtDate(dt: string | null | undefined): string {
  if (!dt) return "";
  return new Date(dt + (dt.endsWith("Z") ? "" : "Z")).toLocaleDateString(
    undefined, { year: "numeric", month: "short", day: "numeric" }
  );
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof CheckCircle2 }> = {
  Approved:    { color: "#10b981", bg: "rgba(16,185,129,0.12)",  icon: CheckCircle2 },
  Development: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  icon: Clock },
  Archived:    { color: "#6b7280", bg: "rgba(107,114,128,0.12)", icon: Archive },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.Development;
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}33` }}
    >
      <Icon size={9} />
      {status}
    </span>
  );
}

/* ── Create Agent Modal ─────────────────────────────────────────── */

const STATUSES = ["Development", "Approved", "Archived"];
const MODELS = ["Qwen 3.5 Cloud", "GPT-4o Mini", "Grok-3 Mini", "Gemini 2.0 Flash", "Llama 3.3 70B", "Custom"];

function CreateAgentModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (agent: AgentInfo) => void;
}) {
  const [form, setForm] = useState<AgentCreate>({
    name: "",
    description: "",
    status: "Development",
    tags: [],
    created_by: "",
    is_private: false,
    model: "Qwen 3.5 Cloud",
    file_ids: [],
  });
  const [tagInput, setTagInput] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !(form.tags ?? []).includes(t)) {
      setForm((f) => ({ ...f, tags: [...(f.tags ?? []), t] }));
    }
    setTagInput("");
  };

  const handleFileUploaded = (result: UploadResult) => {
    setUploadedFiles((prev) => {
      if (prev.some((f) => f.file_id === result.file_id)) return prev;
      return [...prev, result];
    });
    setForm((f) => ({
      ...f,
      file_ids: [...(f.file_ids ?? []), result.file_id],
    }));
  };

  const removeUploadedFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.file_id !== fileId));
    setForm((f) => ({ ...f, file_ids: (f.file_ids ?? []).filter((id) => id !== fileId) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Agent name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const agent = await createAgent(form);
      onCreate(agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent.");
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full bg-transparent text-[13px] px-3 py-2 rounded-lg outline-none focus:ring-1";
  const fieldStyle = {
    background: "var(--color-elevated)",
    border: "1px solid var(--color-border-mid)",
    color: "var(--color-text)",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade-in"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-2xl anim-fade-up overflow-hidden"
        style={{
          background: "var(--color-raised)",
          border: "1px solid var(--color-border-mid)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b"
             style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ background: "var(--color-accent-dim)", border: "1px solid rgba(99,102,241,0.3)" }}>
              <Bot size={15} style={{ color: "var(--color-accent)" }} />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold" style={{ color: "var(--color-text)" }}>New Agent</h2>
              <p className="text-[11px]" style={{ color: "var(--color-text-3)" }}>Configure your AI agent</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:brightness-110"
                  style={{ color: "var(--color-text-3)", background: "var(--color-elevated)" }}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[72vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--color-text-2)" }}>
              Agent Name *
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Flexcube User Manual"
              className={field}
              style={fieldStyle}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--color-text-2)" }}>
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What does this agent do?"
              rows={2}
              className={field + " resize-none"}
              style={fieldStyle}
            />
          </div>

          {/* Status + Model row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--color-text-2)" }}>
                Status
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className={field}
                style={{ ...fieldStyle, cursor: "pointer" }}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--color-text-2)" }}>
                Model
              </label>
              <select
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className={field}
                style={{ ...fieldStyle, cursor: "pointer" }}
              >
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Created by + Privacy row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--color-text-2)" }}>
                Created By
              </label>
              <input
                value={form.created_by}
                onChange={(e) => setForm((f) => ({ ...f, created_by: e.target.value }))}
                placeholder="Your name"
                className={field}
                style={fieldStyle}
              />
            </div>
            <div className="flex flex-col justify-end pb-0.5">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <div
                  className="w-9 h-5 rounded-full relative transition-colors"
                  style={{
                    background: form.is_private ? "var(--color-accent)" : "var(--color-elevated)",
                    border: "1px solid var(--color-border-mid)",
                  }}
                  onClick={() => setForm((f) => ({ ...f, is_private: !f.is_private }))}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
                    style={{
                      left: form.is_private ? "calc(100% - 18px)" : "2px",
                      background: "white",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                    }}
                  />
                </div>
                <span className="text-[11px]" style={{ color: "var(--color-text-2)" }}>Private agent</span>
              </label>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--color-text-2)" }}>
              Tags
            </label>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                placeholder="Add a tag…"
                className={field + " flex-1"}
                style={fieldStyle}
              />
              <button type="button" onClick={addTag}
                      className="px-3 py-2 rounded-lg text-[12px] font-medium transition-all hover:brightness-110"
                      style={{ background: "var(--color-accent-dim)", color: "var(--color-accent-text)", border: "1px solid rgba(99,102,241,0.3)" }}>
                Add
              </button>
            </div>
            {(form.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(form.tags ?? []).map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full"
                        style={{ background: "var(--color-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-2)" }}>
                    {t}
                    <button type="button" onClick={() => setForm((f) => ({ ...f, tags: (f.tags ?? []).filter((x) => x !== t) }))}>
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Files — upload directly into the agent */}
          <div>
            <label className="text-[11px] font-medium mb-1.5 block" style={{ color: "var(--color-text-2)" }}>
              Upload Files <span style={{ color: "var(--color-text-3)" }}>(optional — add more later)</span>
            </label>

            {/* Already-uploaded files for this agent */}
            {uploadedFiles.length > 0 && (
              <div className="mb-2 space-y-1">
                {uploadedFiles.map((f) => (
                  <div key={f.file_id}
                       className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                       style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                    <CheckCheck size={12} style={{ color: "#10b981", flexShrink: 0 }} />
                    <span className="text-[11.5px] flex-1 truncate" style={{ color: "var(--color-text)" }}>{f.file_name}</span>
                    <span className="text-[10px]" style={{ color: "var(--color-text-3)" }}>{f.total_chunks} chunks</span>
                    <button type="button" onClick={() => removeUploadedFile(f.file_id)}
                            style={{ color: "var(--color-text-3)" }} className="hover:text-red-400">
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <FileUploader onUploadComplete={handleFileUploaded} />
          </div>

          {error && (
            <p className="text-[12px] px-3 py-2 rounded-lg"
               style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--color-danger)" }}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
                    className="px-4 py-2 rounded-lg text-[12px] font-medium transition-all"
                    style={{ background: "var(--color-elevated)", color: "var(--color-text-2)", border: "1px solid var(--color-border)" }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
                    className="px-5 py-2 rounded-lg text-[12px] font-medium text-white transition-all hover:brightness-110 disabled:opacity-50"
                    style={{ background: "var(--color-accent)" }}>
              {saving ? "Creating…" : "Create Agent"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Agent Card ─────────────────────────────────────────────────── */

function AgentCard({
  agent,
  onOpen,
  onDelete,
}: {
  agent: AgentInfo;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [delConfirm, setDelConfirm] = useState(false);

  const initials = agent.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div
      className="group relative flex flex-col rounded-2xl overflow-hidden transition-all duration-200 cursor-pointer"
      style={{
        background: "var(--color-raised)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.border = "1px solid var(--color-border-mid)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 32px rgba(0,0,0,0.25)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.border = "1px solid var(--color-border)";
        (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
        (e.currentTarget as HTMLElement).style.transform = "none";
      }}
      onClick={onOpen}
    >
      {/* Card top band */}
      <div className="h-1.5 w-full" style={{
        background: STATUS_CONFIG[agent.status]
          ? `linear-gradient(90deg, ${STATUS_CONFIG[agent.status].color}cc, ${STATUS_CONFIG[agent.status].color}44)`
          : "var(--color-accent)",
      }} />

      <div className="p-5 flex flex-col gap-3 flex-1">
        {/* Avatar + name row */}
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-[15px] font-bold text-white"
               style={{ background: `linear-gradient(135deg, var(--color-accent), #818cf8)` }}>
            {agent.image ? (
              <img src={agent.image} alt={agent.name} className="w-full h-full object-cover rounded-xl" />
            ) : initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold leading-snug truncate" style={{ color: "var(--color-text)" }}>
              {agent.name}
            </p>
            <p className="text-[11.5px] mt-0.5 line-clamp-1" style={{ color: "var(--color-text-3)" }}>
              {agent.description || "No description"}
            </p>
          </div>
          {agent.is_private
            ? <Lock size={12} className="shrink-0 mt-0.5" style={{ color: "var(--color-warning)" }} />
            : <Globe size={12} className="shrink-0 mt-0.5" style={{ color: "var(--color-text-3)" }} />}
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={agent.status} />
          {agent.model && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "var(--color-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-3)" }}>
              <Cpu size={9} />{agent.model}
            </span>
          )}
        </div>

        {/* Tags */}
        {agent.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {agent.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: "var(--color-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-2)" }}>
                <Tag size={8} />{tag}
              </span>
            ))}
            {agent.tags.length > 3 && (
              <span className="text-[10px]" style={{ color: "var(--color-text-3)" }}>+{agent.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Stats row */}
        <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
          <span className="flex items-center gap-1 text-[11px]" style={{ color: "var(--color-text-3)" }}>
            <FileText size={11} />{agent.file_count} file{agent.file_count !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1 text-[11px]" style={{ color: "var(--color-text-3)" }}>
            <MessageSquare size={11} />{agent.conversation_count} chat{agent.conversation_count !== 1 ? "s" : ""}
          </span>
          <div className="flex-1" />
          {agent.created_by && (
            <span className="flex items-center gap-1 text-[10px] truncate max-w-[80px]" style={{ color: "var(--color-text-3)" }}>
              <User size={9} />{agent.created_by}
            </span>
          )}
          {agent.created_at && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--color-text-3)" }}>
              <Calendar size={9} />{fmtDate(agent.created_at)}
            </span>
          )}
        </div>
      </div>

      {/* Hover overlay actions */}
      <div
        className="absolute inset-0 flex items-end justify-between px-4 pb-4 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 55%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white transition-all hover:brightness-110 active:scale-95"
          style={{ background: "var(--color-accent)" }}
        >
          Open <ChevronRight size={13} />
        </button>
        {delConfirm ? (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <span className="text-[11px] text-white">Delete?</span>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white"
                    style={{ background: "var(--color-danger)" }}>Yes</button>
            <button onClick={(e) => { e.stopPropagation(); setDelConfirm(false); }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium"
                    style={{ background: "rgba(255,255,255,0.15)", color: "white" }}>No</button>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setDelConfirm(true); }}
            className="p-2 rounded-lg transition-all hover:brightness-110"
            style={{ background: "rgba(239,68,68,0.8)" }}
          >
            <Trash2 size={13} className="text-white" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Agent Library ──────────────────────────────────────────────── */

interface AgentLibraryProps {
  agents: AgentInfo[];
  onSelectAgent: (agent: AgentInfo) => void;
  onAgentsChange: (agents: AgentInfo[]) => void;
}

export default function AgentLibrary({
  agents,
  onSelectAgent,
  onAgentsChange,
}: AgentLibraryProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("All");

  const statuses = ["All", "Approved", "Development", "Archived"];

  const filtered = agents.filter((a) => {
    const matchSearch =
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()) ||
      a.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = filterStatus === "All" || a.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const handleDelete = async (agent: AgentInfo) => {
    try {
      await deleteAgent(agent.agent_id);
      onAgentsChange(agents.filter((a) => a.agent_id !== agent.agent_id));
    } catch { /* ignore */ }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--color-bg)" }}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <div
        className="shrink-0 px-8 py-6 border-b"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="max-w-[1100px] mx-auto">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-[20px] font-bold" style={{ color: "var(--color-text)" }}>
                Agent Library
              </h1>
              <p className="text-[13px] mt-0.5" style={{ color: "var(--color-text-2)" }}>
                {agents.length} agent{agents.length !== 1 ? "s" : ""} · each agent can query multiple documents
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ background: "var(--color-accent)" }}
            >
              <Plus size={14} /> New Agent
            </button>
          </div>

          {/* Search + filter bar */}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-[340px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
                      style={{ color: "var(--color-text-3)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agents…"
                className="w-full pl-8 pr-3 py-2 rounded-lg text-[12.5px] outline-none"
                style={{
                  background: "var(--color-elevated)",
                  border: "1px solid var(--color-border-mid)",
                  color: "var(--color-text)",
                }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {statuses.map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className="px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-all"
                  style={
                    filterStatus === s
                      ? { background: "var(--color-accent-dim)", color: "var(--color-accent-text)", border: "1px solid rgba(99,102,241,0.3)" }
                      : { background: "transparent", color: "var(--color-text-3)", border: "1px solid var(--color-border)" }
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Grid ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-[1100px] mx-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center anim-fade-in">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                   style={{ background: "var(--color-accent-dim)", border: "1px solid rgba(99,102,241,0.25)" }}>
                <Bot size={28} style={{ color: "var(--color-accent)" }} />
              </div>
              <div>
                <p className="text-[15px] font-semibold" style={{ color: "var(--color-text)" }}>
                  {agents.length === 0 ? "No agents yet" : "No agents match your search"}
                </p>
                <p className="text-[13px] mt-1" style={{ color: "var(--color-text-2)" }}>
                  {agents.length === 0
                    ? "Create your first agent to start chatting with your documents."
                    : "Try a different search or filter."}
                </p>
              </div>
              {agents.length === 0 && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-medium text-white hover:brightness-110"
                  style={{ background: "var(--color-accent)" }}
                >
                  <Plus size={14} /> Create Agent
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-4"
                 style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {filtered.map((agent) => (
                <AgentCard
                  key={agent.agent_id}
                  agent={agent}
                  onOpen={() => onSelectAgent(agent)}
                  onDelete={() => handleDelete(agent)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreate={(agent) => {
            onAgentsChange([agent, ...agents]);
            setShowCreate(false);
            onSelectAgent(agent);
          }}
        />
      )}
    </div>
  );
}
