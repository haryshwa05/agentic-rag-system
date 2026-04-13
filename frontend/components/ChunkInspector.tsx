"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Layers, ChevronLeft, ChevronRight, RefreshCw,
  FileText, ArrowRight, Database, Search,
  Cpu, Hash, AlertCircle, Filter,
} from "lucide-react";
import { FileInfo, ChunkInfo, getChunks } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   Pipeline steps — explains exactly what happens to every file
══════════════════════════════════════════════════════════════════ */

const PIPELINE_STEPS = [
  {
    icon: FileText,
    color: "#f97316",
    label: "1 · Parse",
    short: "Extract text",
    detail:
      "The raw file (CSV, Excel, PDF) is read row-by-row. For Excel each tab is parsed separately. " +
      "For PDFs, text is extracted using pdfplumber; if Vision is enabled, screenshots are also described by a vision LLM. " +
      "The result is a flat list of text + metadata pairs — one per row group.",
  },
  {
    icon: Layers,
    color: "#6366f1",
    label: "2 · Chunk",
    short: "Split into windows",
    detail:
      "Rows are grouped into overlapping windows (default: 20 rows per chunk, 3-row overlap). " +
      "Overlap ensures a question spanning a chunk boundary still finds its answer. " +
      "A special 'summary' chunk is added that lists every column name + sample values — " +
      "this is what the LLM uses when you ask structural questions like 'what are the columns?'.",
  },
  {
    icon: Cpu,
    color: "#a78bfa",
    label: "3 · Embed",
    short: "Convert to vectors",
    detail:
      "Each chunk's text is passed through an embedding model (HuggingFace all-MiniLM-L6-v2 by default). " +
      "The model outputs a 384-dimensional float vector that captures the *meaning* of the text — " +
      "similar meaning → nearby vectors in space. Chunks are processed in batches of 100 for throughput.",
  },
  {
    icon: Database,
    color: "#22c55e",
    label: "4 · Store (Qdrant)",
    short: "Vector database",
    detail:
      "Vectors + payloads (chunk text, sheet name, row range) are upserted into Qdrant in a per-file collection. " +
      "At query time, your question is embedded, and Qdrant returns the closest vectors using cosine similarity. " +
      "This is semantic search — it finds meaning, not just keywords.",
  },
  {
    icon: Search,
    color: "#0F6E56",
    label: "5 · Index (BM25)",
    short: "Keyword index",
    detail:
      "In parallel, a BM25 keyword index is built from the same chunks and saved to disk. " +
      "BM25 excels at exact-match queries (e.g. proper names, IDs). " +
      "At query time, results from both Qdrant (semantic) and BM25 (keyword) are merged and " +
      "optionally reranked by a cross-encoder model before being sent to the LLM.",
  },
];

/* ══════════════════════════════════════════════════════════════════
   Chunk browser
══════════════════════════════════════════════════════════════════ */

const PAGE_SIZE = 20;

function ChunkCard({ chunk, index }: { chunk: ChunkInfo; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isSummary = chunk.chunk_type === "summary" || chunk.sheet_name === "summary";

  return (
    <div
      className="rounded-lg transition-all"
      style={{
        background: isSummary ? "rgba(99,102,241,0.07)" : "var(--color-elevated)",
        border: `1px solid ${isSummary ? "rgba(99,102,241,0.2)" : "var(--color-border)"}`,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2.5 flex items-start gap-2.5"
      >
        <span
          className="text-[10px] font-mono font-bold shrink-0 mt-0.5 px-1.5 py-0.5 rounded"
          style={{
            background: isSummary ? "rgba(99,102,241,0.2)" : "var(--color-raised)",
            color: isSummary ? "var(--color-accent-text)" : "var(--color-text-3)",
          }}
        >
          {isSummary ? "SUM" : `#${index}`}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {chunk.sheet_name && chunk.sheet_name !== "default" && (
              <span
                className="text-[10px] px-1.5 py-0 rounded font-medium shrink-0"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  color: "var(--color-text-3)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {chunk.sheet_name}
              </span>
            )}
            {!isSummary && chunk.row_start != null && (
              <span className="text-[10px] shrink-0" style={{ color: "var(--color-text-3)" }}>
                rows {chunk.row_start}–{chunk.row_end}
              </span>
            )}
          </div>
          <p
            className="text-[11.5px] mt-1 leading-snug"
            style={{
              color: "var(--color-text-2)",
              display: "-webkit-box",
              WebkitLineClamp: expanded ? "none" : 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            } as React.CSSProperties}
          >
            {chunk.text}
          </p>
        </div>
      </button>

      {expanded && (
        <div
          className="px-3 pb-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <p
            className="text-[11px] mt-2 font-mono leading-relaxed whitespace-pre-wrap break-all"
            style={{ color: "var(--color-text-2)" }}
          >
            {chunk.text}
          </p>
          <div className="flex flex-wrap gap-3 mt-2.5">
            {[
              ["chunk_id", chunk.chunk_id],
              ["sheet", chunk.sheet_name],
              ["rows", `${chunk.row_start}–${chunk.row_end}`],
              ["type", chunk.chunk_type],
            ].map(([k, v]) => (
              <div key={k} className="text-[10px]" style={{ color: "var(--color-text-3)" }}>
                <span className="font-semibold" style={{ color: "var(--color-text-2)" }}>{k}:</span>{" "}
                {v}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Main inspector
══════════════════════════════════════════════════════════════════ */

interface Props {
  file: FileInfo;
}

type Tab = "pipeline" | "chunks";

export default function ChunkInspector({ file }: Props) {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetFilter, setSheetFilter] = useState("");
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const sheets: string[] = Array.from(
    new Set(["", ...(file.sheets ?? [])])
  );

  const load = useCallback(async (p: number, sheet: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getChunks(file.file_id, {
        limit: PAGE_SIZE,
        offset: p * PAGE_SIZE,
        sheet_name: sheet || undefined,
      });
      setChunks(res.chunks);
      setTotal(res.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load chunks.");
    } finally {
      setLoading(false);
    }
  }, [file.file_id]);

  useEffect(() => {
    if (tab === "chunks") load(page, sheetFilter);
  }, [tab, page, sheetFilter, load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const tabBtn = (t: Tab, label: string, Icon: React.ElementType) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg transition-all"
      style={
        tab === t
          ? { background: "var(--color-accent-dim)", color: "var(--color-accent-text)", border: "1px solid rgba(99,102,241,0.25)" }
          : { background: "transparent", color: "var(--color-text-3)", border: "1px solid transparent" }
      }
    >
      <Icon size={12} />
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <div
        className="shrink-0 px-5 py-3 flex items-center gap-3 border-b"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <Hash size={14} style={{ color: "var(--color-accent)" }} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold truncate" style={{ color: "var(--color-text)" }}>
            {file.file_name}
          </p>
          <p className="text-[10.5px]" style={{ color: "var(--color-text-3)" }}>
            {file.total_chunks ?? 0} chunks · {(file.total_rows ?? 0).toLocaleString()} rows
            {file.sheets && file.sheets.length > 0 && ` · ${file.sheets.length} sheet${file.sheets.length > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex gap-1">
          {tabBtn("pipeline", "Pipeline", Layers)}
          {tabBtn("chunks", "Chunks", Database)}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Pipeline tab ─────────────────────────────────────────── */}
        {tab === "pipeline" && (
          <div className="max-w-[680px] mx-auto px-5 py-6 space-y-3">
            <div className="mb-4">
              <h2 className="text-[14px] font-semibold" style={{ color: "var(--color-text)" }}>
                How your file gets indexed
              </h2>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--color-text-2)" }}>
                Click any step to see exactly what happens and why.
              </p>
            </div>

            {PIPELINE_STEPS.map((step, i) => {
              const Icon = step.icon;
              const open = activeStep === i;
              return (
                <div key={i}>
                  <button
                    type="button"
                    onClick={() => setActiveStep(open ? null : i)}
                    className="w-full text-left rounded-xl px-4 py-3 flex items-center gap-3 transition-all"
                    style={{
                      background: open ? `color-mix(in srgb, ${step.color} 10%, var(--color-raised))` : "var(--color-raised)",
                      border: `1px solid ${open ? `color-mix(in srgb, ${step.color} 40%, transparent)` : "var(--color-border)"}`,
                    }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `color-mix(in srgb, ${step.color} 18%, transparent)` }}
                    >
                      <Icon size={14} style={{ color: step.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-semibold" style={{ color: "var(--color-text)" }}>
                        {step.label}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--color-text-3)" }}>
                        {step.short}
                      </p>
                    </div>
                    <ArrowRight
                      size={13}
                      className="shrink-0 transition-transform"
                      style={{
                        color: "var(--color-text-3)",
                        transform: open ? "rotate(90deg)" : "none",
                      }}
                    />
                  </button>
                  {open && (
                    <div
                      className="mx-2 px-4 py-3 rounded-b-xl text-[12.5px] leading-relaxed anim-fade-in"
                      style={{
                        background: `color-mix(in srgb, ${step.color} 5%, var(--color-surface))`,
                        border: `1px solid color-mix(in srgb, ${step.color} 25%, transparent)`,
                        borderTop: "none",
                        color: "var(--color-text-2)",
                      }}
                    >
                      {step.detail}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Stats card */}
            <div
              className="mt-5 rounded-xl p-4 grid grid-cols-2 gap-3"
              style={{ background: "var(--color-raised)", border: "1px solid var(--color-border)" }}
            >
              {[
                ["File",    file.file_name],
                ["Chunks",  (file.total_chunks ?? 0).toLocaleString()],
                ["Rows",    (file.total_rows   ?? 0).toLocaleString()],
                ["Sheets",  (file.sheets?.join(", ")) || "—"],
                ["Size",    file.byte_size ? `${(file.byte_size / 1024 / 1024).toFixed(2)} MB` : "—"],
                ["Access",  file.is_private ? `Private · ${file.public_users?.join(", ") || "no users"}` : "Public"],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--color-text-3)" }}>{k}</p>
                  <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--color-text)" }}>{v}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Chunks tab ───────────────────────────────────────────── */}
        {tab === "chunks" && (
          <div className="max-w-[680px] mx-auto px-5 py-4 space-y-3">
            {/* Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {sheets.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <Filter size={11} style={{ color: "var(--color-text-3)" }} />
                  <select
                    value={sheetFilter}
                    onChange={(e) => { setSheetFilter(e.target.value); setPage(0); }}
                    className="text-[11px] px-2 py-1 rounded-md outline-none"
                    style={{
                      background: "var(--color-elevated)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text-2)",
                    }}
                  >
                    <option value="">All sheets</option>
                    {file.sheets?.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
              <span className="text-[11px] ml-auto" style={{ color: "var(--color-text-3)" }}>
                {total} chunk{total !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => load(page, sheetFilter)}
                className="p-1.5 rounded-md hover:brightness-110 transition-all"
                style={{ color: "var(--color-text-3)" }}
                title="Refresh"
              >
                <RefreshCw size={11} className={loading ? "anim-spin" : ""} />
              </button>
            </div>

            {/* Error */}
            {error && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]"
                style={{ background: "var(--color-danger-dim)", color: "var(--color-danger)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <AlertCircle size={12} />
                {error}
              </div>
            )}

            {/* Chunk list */}
            {loading && chunks.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw size={18} className="anim-spin" style={{ color: "var(--color-accent)" }} />
              </div>
            ) : chunks.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-[13px]" style={{ color: "var(--color-text-3)" }}>
                  No chunks found.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {chunks.map((c, i) => (
                  <ChunkCard key={c.chunk_id} chunk={c} index={page * PAGE_SIZE + i} />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg disabled:opacity-30 transition-all hover:brightness-110"
                  style={{ background: "var(--color-elevated)", color: "var(--color-text-2)", border: "1px solid var(--color-border)" }}
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="text-[11px]" style={{ color: "var(--color-text-3)" }}>
                  page {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-lg disabled:opacity-30 transition-all hover:brightness-110"
                  style={{ background: "var(--color-elevated)", color: "var(--color-text-2)", border: "1px solid var(--color-border)" }}
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
