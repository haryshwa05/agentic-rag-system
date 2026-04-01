"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload, FileSpreadsheet, CheckCircle, AlertCircle,
  X, ScanLine, Cpu, Database, Sparkles,
} from "lucide-react";
import { uploadFile, UploadProgress, UploadResult } from "@/lib/api";

interface FileUploaderProps {
  onUploadComplete: (result: UploadResult) => void;
}

const STAGES: { key: string; label: string; icon: React.ReactNode; detail: string }[] = [
  {
    key: "parsing",
    label: "Reading",
    icon: <ScanLine size={14} />,
    detail: "Extracting rows and sheets from your spreadsheet",
  },
  {
    key: "embedding",
    label: "Embedding",
    icon: <Cpu size={14} />,
    detail: "Converting data into searchable vectors",
  },
  {
    key: "storing",
    label: "Storing",
    icon: <Database size={14} />,
    detail: "Saving vectors to the database",
  },
  {
    key: "complete",
    label: "Ready",
    icon: <Sparkles size={14} />,
    detail: "Your file is ready to query",
  },
];

function stageIndex(stage: string) {
  return STAGES.findIndex((s) => s.key === stage);
}

export default function FileUploader({ onUploadComplete }: FileUploaderProps) {
  const [isDragging, setIsDragging]   = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress]       = useState<UploadProgress | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!ext || !["csv", "xlsx", "xls"].includes(ext)) {
        setError("Please upload a .csv, .xlsx, or .xls file");
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        setError("File too large. Maximum size is 100 MB.");
        return;
      }

      setError(null);
      setIsUploading(true);
      setProgress(null);

      try {
        const result = await uploadFile(file, (p) => setProgress(p));
        setIsUploading(false);
        if (result) onUploadComplete(result);
      } catch (err: any) {
        setError(err.message || "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [onUploadComplete],
  );

  const handleDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true);  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const currentStageIdx = progress ? stageIndex(progress.stage) : -1;

  return (
    <div className="w-full space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleInputChange}
        className="hidden"
      />

      {/* Drop zone */}
      <div
        onClick={!isUploading ? () => fileInputRef.current?.click() : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          "relative rounded-2xl border-2 border-dashed transition-all duration-200 overflow-hidden",
          isUploading ? "cursor-default" : "cursor-pointer",
          isDragging
            ? "border-accent bg-accent-soft scale-[1.01] shadow-lg"
            : isUploading
              ? "border-accent/40 bg-accent-soft/30"
              : "border-border hover:border-accent/60 hover:bg-surface-1",
        ].join(" ")}
      >
        {isUploading ? (
          <div className="px-6 py-7 space-y-5">
            {/* File name + spinner */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-soft flex items-center justify-center shrink-0">
                <FileSpreadsheet size={18} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">
                  {progress?.message || "Processing…"}
                </p>
                <p className="text-xs text-ink-faint mt-0.5">
                  {progress?.percent != null ? `${Math.round(progress.percent)}%` : "Starting…"}
                </p>
              </div>
              <div className="w-6 h-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin-slow shrink-0" />
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full bg-surface-3 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-700 ease-out"
                style={{ width: `${progress?.percent ?? 0}%` }}
              />
            </div>

            {/* Stage steps */}
            <div className="grid grid-cols-4 gap-1">
              {STAGES.map((stage, i) => {
                const done    = i < currentStageIdx;
                const current = i === currentStageIdx;
                const future  = i > currentStageIdx;
                return (
                  <div key={stage.key} className="flex flex-col items-center gap-1.5 text-center">
                    <div className={[
                      "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                      done    ? "bg-success text-white"      : "",
                      current ? "bg-accent text-white animate-pulse-ring" : "",
                      future  ? "bg-surface-3 text-ink-faint" : "",
                    ].join(" ")}>
                      {done ? <CheckCircle size={14} /> : stage.icon}
                    </div>
                    <span className={[
                      "text-[10px] font-medium leading-tight",
                      done ? "text-success" : current ? "text-accent" : "text-ink-faint",
                    ].join(" ")}>
                      {stage.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {currentStageIdx >= 0 && (
              <p className="text-[11px] text-ink-faint text-center animate-fade-in">
                {STAGES[currentStageIdx]?.detail}
              </p>
            )}
          </div>
        ) : (
          <div className="px-8 py-12 flex flex-col items-center gap-4 text-center">
            <div className={[
              "w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200",
              isDragging ? "bg-accent text-white scale-110" : "bg-surface-2 text-ink-faint",
            ].join(" ")}>
              <Upload size={26} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">
                {isDragging ? "Drop it here!" : (
                  <>Drop your spreadsheet or{" "}
                    <span className="text-accent underline underline-offset-2">browse</span>
                  </>
                )}
              </p>
              <p className="text-xs text-ink-faint mt-1.5">CSV · XLSX · XLS — up to 100 MB</p>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 text-sm text-danger bg-danger-soft rounded-xl px-4 py-3 animate-fade-in">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1 leading-snug">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 hover:opacity-70 transition-opacity">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
