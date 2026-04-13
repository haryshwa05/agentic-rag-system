"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload, FileSpreadsheet, FileText, CheckCircle,
  AlertCircle, Loader2, X, Lock, Globe, Plus, User,
} from "lucide-react";
import { uploadFile, UploadProgressEvent, UploadResult } from "@/lib/api";

interface Props {
  onUploadComplete: (result: UploadResult) => void;
}

type Stage = "idle" | "uploading" | "parsing" | "embedding" | "indexing" | "done" | "error";

interface Progress {
  stage: Stage;
  percent: number;
  message: string;
}

const STAGE_LABELS: Record<Stage, string> = {
  idle:      "Ready",
  uploading: "Uploading…",
  parsing:   "Parsing file…",
  embedding: "Generating embeddings…",
  indexing:  "Building search index…",
  done:      "Complete",
  error:     "Error",
};

const ALLOWED = [".csv", ".xlsx", ".xls", ".pdf"];
const MAX_MB  = 100;

export default function FileUploader({ onUploadComplete }: Props) {
  const [dragging,    setDragging]    = useState(false);
  const [file,        setFile]        = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [isPrivate,   setIsPrivate]   = useState(false);
  const [userInput,   setUserInput]   = useState("");
  const [users,       setUsers]       = useState<string[]>([]);
  const [progress,    setProgress]    = useState<Progress | null>(null);
  const [result,      setResult]      = useState<UploadResult | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null); setDisplayName(""); setIsPrivate(false);
    setUsers([]); setUserInput(""); setProgress(null);
    setResult(null); setError(null);
  };

  const validateFile = (f: File): string | null => {
    const ext = "." + (f.name.split(".").pop()?.toLowerCase() ?? "");
    if (!ALLOWED.includes(ext)) return `Unsupported type "${ext}". Allowed: ${ALLOWED.join(", ")}`;
    if (f.size > MAX_MB * 1024 * 1024) return `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_MB} MB.`;
    return null;
  };

  const addUser = () => {
    const name = userInput.trim();
    if (!name || users.includes(name)) { setUserInput(""); return; }
    setUsers((prev) => [...prev, name]);
    setUserInput("");
  };

  const removeUser = (u: string) => setUsers((prev) => prev.filter((x) => x !== u));

  const handleFile = useCallback(async (f: File) => {
    const err = validateFile(f);
    if (err) { setError(err); return; }
    setFile(f);
    setError(null);
    setResult(null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setProgress({ stage: "uploading", percent: 2, message: "Uploading…" });
    try {
      const res = await uploadFile(
        file,
        (evt: UploadProgressEvent) => {
          if (evt.stage === "error") {
            setProgress({ stage: "error", percent: 0, message: evt.message ?? "Unknown error" });
            setError(evt.message ?? "Unknown error");
            return;
          }
          const stageMap: Record<string, Stage> = {
            parsing: "parsing", embedding: "embedding",
            storing: "embedding", indexing: "indexing", complete: "done",
          };
          const mapped = stageMap[evt.stage] ?? "uploading";
          setProgress({ stage: mapped, percent: evt.percent ?? 0, message: evt.message ?? "" });
        },
        { displayName: displayName.trim() || undefined, isPrivate, publicUsers: users },
      );
      setProgress({ stage: "done", percent: 100, message: "Indexed and ready." });
      setResult(res);
      onUploadComplete(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      setProgress({ stage: "error", percent: 0, message: msg });
      setError(msg);
    }
  }, [file, displayName, isPrivate, users, onUploadComplete]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const ext = file?.name.split(".").pop()?.toLowerCase();
  const FileIcon = ext === "pdf" ? FileText : FileSpreadsheet;
  const iconColor =
    ext === "pdf" ? "var(--color-pdf)" :
    ext === "csv" ? "var(--color-csv)" : "var(--color-excel)";

  /* ── Done ─────────────────────────────────────────────────────── */
  if (result && progress?.stage === "done") {
    return (
      <div
        className="rounded-xl p-5 flex items-start gap-3 anim-fade-up"
        style={{ background: "var(--color-success-dim)", border: "1px solid rgba(16,185,129,0.25)" }}
      >
        <CheckCircle size={18} style={{ color: "var(--color-success)", flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: "var(--color-text)" }}>
            {result.file_name}
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--color-text-2)" }}>
            {result.total_chunks} chunks indexed · Ready to query
          </p>
        </div>
        <button onClick={reset} className="p-1 rounded hover:bg-white/5">
          <X size={13} style={{ color: "var(--color-text-3)" }} />
        </button>
      </div>
    );
  }

  /* ── Processing ───────────────────────────────────────────────── */
  if (file && progress) {
    const pct     = Math.round(progress.percent);
    const isError = progress.stage === "error";
    return (
      <div
        className="rounded-xl p-5 space-y-4 anim-fade-up"
        style={{
          background: isError ? "var(--color-danger-dim)" : "var(--color-raised)",
          border: `1px solid ${isError ? "rgba(239,68,68,0.25)" : "var(--color-border-mid)"}`,
        }}
      >
        <div className="flex items-center gap-3">
          <FileIcon size={18} style={{ color: isError ? "var(--color-danger)" : iconColor, flexShrink: 0 }} />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium truncate" style={{ color: "var(--color-text)" }}>{file.name}</p>
            <p className="text-[11px]" style={{ color: "var(--color-text-2)" }}>
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </div>
          {isError ? (
            <button onClick={reset} className="p-1 rounded hover:bg-white/5">
              <X size={13} style={{ color: "var(--color-text-3)" }} />
            </button>
          ) : (
            <Loader2 size={14} className="anim-spin" style={{ color: "var(--color-accent)" }} />
          )}
        </div>
        {!isError && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: "var(--color-text-2)" }}>
                {STAGE_LABELS[progress.stage]}
              </span>
              <span className="text-[11px] font-medium" style={{ color: "var(--color-accent-text)" }}>
                {pct}%
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-elevated)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: "linear-gradient(90deg, #6366f1, #a5b4fc)" }}
              />
            </div>
            <p className="text-[10.5px]" style={{ color: "var(--color-text-3)" }}>{progress.message}</p>
          </div>
        )}
        {isError && (
          <div className="flex items-center gap-2">
            <AlertCircle size={13} style={{ color: "var(--color-danger)" }} />
            <p className="text-[12px]" style={{ color: "var(--color-danger)" }}>{progress.message}</p>
          </div>
        )}
      </div>
    );
  }

  /* ── File selected — show config form ────────────────────────── */
  if (file) {
    return (
      <div className="space-y-4 anim-fade-up">
        {/* File row */}
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
          style={{ background: "var(--color-elevated)", border: "1px solid var(--color-border)" }}
        >
          <FileIcon size={16} style={{ color: iconColor, flexShrink: 0 }} />
          <span className="flex-1 text-[12.5px] truncate" style={{ color: "var(--color-text)" }}>
            {file.name}
          </span>
          <span className="text-[11px] shrink-0" style={{ color: "var(--color-text-3)" }}>
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </span>
          <button onClick={reset} className="p-1 rounded hover:bg-white/5 shrink-0">
            <X size={12} style={{ color: "var(--color-text-3)" }} />
          </button>
        </div>

        {/* Display name */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium" style={{ color: "var(--color-text-2)" }}>
            Display name <span style={{ color: "var(--color-text-3)" }}>(optional)</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={file.name}
            className="w-full px-3 py-2 rounded-lg text-[12.5px] outline-none"
            style={{
              background: "var(--color-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
            }}
          />
        </div>

        {/* Privacy toggle */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium" style={{ color: "var(--color-text-2)" }}>Access</p>
          <div className="flex gap-2">
            {[
              { val: false, label: "Public", Icon: Globe,  color: "var(--color-success)" },
              { val: true,  label: "Private", Icon: Lock, color: "var(--color-warning)" },
            ].map(({ val, label, Icon, color }) => (
              <button
                key={label}
                type="button"
                onClick={() => setIsPrivate(val)}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-medium transition-all"
                style={
                  isPrivate === val
                    ? { background: `color-mix(in srgb, ${color} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 50%, transparent)`, color }
                    : { background: "var(--color-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-3)" }
                }
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10.5px]" style={{ color: "var(--color-text-3)" }}>
            {isPrivate
              ? "Only users in the list below can access this file."
              : "Everyone can see this file. Optionally tag specific users."}
          </p>
        </div>

        {/* Users list */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium" style={{ color: "var(--color-text-2)" }}>
            {isPrivate ? "Allowed users" : "Tagged users"}{" "}
            <span style={{ color: "var(--color-text-3)" }}>(optional)</span>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUser(); } }}
              placeholder="Username…"
              className="flex-1 px-3 py-1.5 rounded-lg text-[12px] outline-none"
              style={{
                background: "var(--color-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              }}
            />
            <button
              onClick={addUser}
              className="px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-[11px] font-medium transition-all"
              style={{
                background: "var(--color-accent-dim)",
                border: "1px solid var(--color-border-strong)",
                color: "var(--color-accent-text)",
              }}
            >
              <Plus size={12} />
              Add
            </button>
          </div>
          {users.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {users.map((u) => (
                <span
                  key={u}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                  style={{
                    background: "var(--color-elevated)",
                    border: "1px solid var(--color-border-mid)",
                    color: "var(--color-text-2)",
                  }}
                >
                  <User size={9} />
                  {u}
                  <button onClick={() => removeUser(u)} className="ml-0.5 hover:text-red-400">
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md"
            style={{ color: "var(--color-danger)", background: "var(--color-danger-dim)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <AlertCircle size={12} />
            {error}
          </div>
        )}

        <button
          onClick={handleUpload}
          className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
          style={{ background: "var(--color-accent)" }}
        >
          Upload &amp; Index
        </button>
      </div>
    );
  }

  /* ── Drop zone ─────────────────────────────────────────────────── */
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className="relative cursor-pointer rounded-xl p-6 flex flex-col items-center gap-3 transition-all select-none"
      style={{
        background: dragging ? "var(--color-accent-dim)" : "var(--color-raised)",
        border: `1.5px dashed ${dragging ? "var(--color-accent)" : "var(--color-border-mid)"}`,
      }}
    >
      <input ref={inputRef} type="file" accept={ALLOWED.join(",")} onChange={onInputChange} className="sr-only" />
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center"
        style={{
          background: dragging ? "var(--color-accent-mid)" : "var(--color-elevated)",
          border: `1px solid ${dragging ? "rgba(99,102,241,0.3)" : "var(--color-border)"}`,
        }}
      >
        <Upload size={18} style={{ color: dragging ? "var(--color-accent)" : "var(--color-text-2)" }} />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-medium" style={{ color: "var(--color-text)" }}>
          {dragging ? "Drop to upload" : "Drop file or click to browse"}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--color-text-3)" }}>
          CSV · XLSX · XLS · PDF — up to {MAX_MB} MB
        </p>
      </div>
      {error && (
        <div
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md"
          style={{ color: "var(--color-danger)", background: "var(--color-danger-dim)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <AlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}
