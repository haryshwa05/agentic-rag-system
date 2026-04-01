"use client";

import { useState, useEffect, useCallback } from "react";
import { Database, X, Wifi, WifiOff, Loader2 } from "lucide-react";
import FileUploader from "@/components/FileUploader";
import ChatBox from "@/components/ChatBox";
import FileSidebar from "@/components/FileSidebar";
import { getFiles, FileInfo, UploadResult } from "@/lib/api";

type BackendStatus = "checking" | "online" | "offline";

function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/files", { signal: AbortSignal.timeout(4000) });
        if (!cancelled) setStatus(res.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return status;
}

export default function Home() {
  const [files,          setFiles]          = useState<FileInfo[]>([]);
  const [activeFileId,   setActiveFileId]   = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [showUploadModal,setShowUploadModal]= useState(false);
  const [isLoading,      setIsLoading]      = useState(true); // true on mount
  const backendStatus = useBackendStatus();

  // Load files once on mount — all setState calls happen inside the async .then()
  // so no synchronous setState in the effect body.
  useEffect(() => {
    let cancelled = false;
    getFiles().then((fileList: FileInfo[]) => {
      if (cancelled) return;
      setFiles(fileList);
      setIsLoading(false);
      if (fileList.length > 0) {
        setActiveFileId((curr) => curr ?? fileList[0].file_id);
        setActiveFileName((curr) => curr ?? fileList[0].file_name);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const handleUploadComplete = useCallback((result: UploadResult) => {
    const newFile: FileInfo = {
      file_id: result.file_id,
      file_name: result.file_name,
      chunks: result.total_chunks,
    };
    setFiles((prev) => [...prev, newFile]);
    setActiveFileId(result.file_id);
    setActiveFileName(result.file_name);
    setShowUploadModal(false);
  }, []);

  const handleDeleteFile = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.file_id !== fileId));
    if (activeFileId === fileId) {
      setActiveFileId(null);
      setActiveFileName(null);
    }
  }, [activeFileId]);

  const handleSelectFile = useCallback((fileId: string, fileName: string) => {
    setActiveFileId(fileId);
    setActiveFileName(fileName);
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-surface-0">
      {/* ── Sidebar ── */}
      <aside className="w-60 border-r border-border flex-col hidden md:flex">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-border flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center shrink-0">
            <Database size={15} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-ink leading-tight">Excel RAG</p>
            <p className="text-[10px] text-ink-faint leading-tight">Ask your spreadsheets</p>
          </div>
          {/* Backend status dot */}
          <div className="ml-auto shrink-0" title={`Backend ${backendStatus}`}>
            {backendStatus === "checking" && (
              <Loader2 size={13} className="text-ink-faint animate-spin" />
            )}
            {backendStatus === "online" && (
              <span className="w-2 h-2 rounded-full bg-success block animate-pulse" />
            )}
            {backendStatus === "offline" && (
              <span className="w-2 h-2 rounded-full bg-danger block" />
            )}
          </div>
        </div>

        <FileSidebar
          files={files}
          activeFileId={activeFileId}
          onSelectFile={handleSelectFile}
          onDeleteFile={handleDeleteFile}
          onUploadClick={() => setShowUploadModal(true)}
        />
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="h-13 border-b border-border bg-surface-1 flex items-center px-4 gap-3 shrink-0 md:hidden">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <Database size={13} className="text-white" />
          </div>
          <span className="text-sm font-bold text-ink">Excel RAG</span>

          {/* Backend indicator */}
          <div className="flex items-center gap-1.5 ml-1">
            {backendStatus === "online"  && <Wifi    size={13} className="text-success" />}
            {backendStatus === "offline" && <WifiOff size={13} className="text-danger"  />}
          </div>

          <button
            onClick={() => setShowUploadModal(true)}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-medium"
          >
            Upload
          </button>

          {files.length > 0 && (
            <select
              value={activeFileId || ""}
              onChange={(e) => {
                const f = files.find((f) => f.file_id === e.target.value);
                if (f) handleSelectFile(f.file_id, f.file_name);
              }}
              className="text-xs border border-border rounded-lg px-2 py-1.5 bg-surface-0 text-ink max-w-32"
            >
              {files.map((f) => (
                <option key={f.file_id} value={f.file_id}>{f.file_name}</option>
              ))}
            </select>
          )}
        </header>

        {/* Offline banner */}
        {backendStatus === "offline" && (
          <div className="bg-danger-soft border-b border-danger/20 px-4 py-2 flex items-center gap-2 animate-fade-in shrink-0">
            <WifiOff size={13} className="text-danger shrink-0" />
            <p className="text-xs text-danger font-medium">
              Backend is offline — make sure{" "}
              <code className="font-mono bg-danger/10 px-1 rounded">uvicorn main:app --reload</code>{" "}
              is running on port 8000.
            </p>
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-ink-faint animate-fade-in">
              <Loader2 size={28} className="animate-spin text-accent" />
              <p className="text-sm">Loading files…</p>
            </div>
          </div>
        ) : files.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-md w-full space-y-6 animate-fade-up">
              <div className="text-center space-y-1.5">
                <h2 className="text-lg font-bold text-ink">Get started</h2>
                <p className="text-sm text-ink-muted">
                  Upload an Excel or CSV file to begin asking questions about your data.
                </p>
              </div>
              <FileUploader onUploadComplete={handleUploadComplete} />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <ChatBox fileId={activeFileId} fileName={activeFileName} />
          </div>
        )}
      </div>

      {/* ── Upload modal ── */}
      {showUploadModal && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowUploadModal(false)}
        >
          <div
            className="bg-surface-0 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-fade-up border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">Upload a file</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1.5 rounded-lg hover:bg-surface-2 text-ink-muted transition-colors"
              >
                <X size={15} />
              </button>
            </div>
            <FileUploader onUploadComplete={handleUploadComplete} />
          </div>
        </div>
      )}
    </div>
  );
}
