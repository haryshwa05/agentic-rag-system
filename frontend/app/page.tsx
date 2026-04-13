"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart3, WifiOff, Loader2, MessageSquare, Layers, Sun, Moon, LogOut } from "lucide-react";
import AgentLibrary from "@/components/AgentLibrary";
import AgentWorkspaceSidebar from "@/components/AgentWorkspace";
import ChatBox from "@/components/ChatBox";
import ChunkInspector from "@/components/ChunkInspector";
import LoginPage from "@/components/LoginPage";
import {
  getFiles, listAgents, listAgentConversations, createAgentConversation,
  getStoredToken, getStoredUser, clearAuthSession, getMe,
  FileInfo, AgentInfo, ConversationInfo, AuthUser,
} from "@/lib/api";

type BackendStatus = "checking" | "online" | "offline";
type MainView = "chat" | "debug";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000/api";

function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>("checking");
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) });
        if (!cancelled) setStatus(res.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    check();
    const id = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return status;
}

export default function Home() {
  /* ── Auth state ─────────────────────────────────────────────── */
  const [authUser,    setAuthUser]    = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  /* ── App state ──────────────────────────────────────────────── */
  const [files,               setFiles]               = useState<FileInfo[]>([]);
  const [agents,              setAgents]              = useState<AgentInfo[]>([]);
  const [activeAgent,         setActiveAgent]         = useState<AgentInfo | null>(null);
  const [conversations,       setConversations]       = useState<ConversationInfo[]>([]);
  const [activeConversation,  setActiveConversation]  = useState<ConversationInfo | null>(null);
  const [isLoading,           setIsLoading]           = useState(false);
  const [mainView,            setMainView]            = useState<MainView>("chat");
  const [theme,               setTheme]               = useState<"dark" | "light">("dark");
  const backendStatus = useBackendStatus();

  /* ── Theme ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const saved = (localStorage.getItem("theme") as "dark" | "light" | null) ?? "dark";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  /* ── Auth bootstrap ─────────────────────────────────────────── */
  useEffect(() => {
    const stored = getStoredUser();
    const token  = getStoredToken();
    if (stored && token) {
      // Validate token against the server; if offline, trust the stored session
      getMe().then((me) => {
        if (me) {
          setAuthUser(me);
        } else {
          // Server returned 401 — clear and force login
          clearAuthSession();
          setAuthUser(null);
        }
        setAuthLoading(false);
      }).catch(() => {
        // Can't reach server — trust stored session optimistically
        setAuthUser(stored);
        setAuthLoading(false);
      });
    } else {
      setAuthLoading(false);
    }
  }, []);

  /* ── Listen for forced logouts (e.g. token expired mid-session) ── */
  useEffect(() => {
    const handleForceLogout = () => {
      setAuthUser(null);
      setActiveAgent(null);
      setConversations([]);
      setActiveConversation(null);
      setFiles([]);
      setAgents([]);
    };
    window.addEventListener("auth:logout", handleForceLogout);
    return () => window.removeEventListener("auth:logout", handleForceLogout);
  }, []);

  /* ── Load data whenever the logged-in user changes ───────────── */
  useEffect(() => {
    if (!authUser) {
      setFiles([]);
      setAgents([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    let cancelled = false;
    Promise.all([getFiles(), listAgents()]).then(([fileList, agentList]) => {
      if (cancelled) return;
      setFiles(fileList);
      setAgents(agentList);
      setIsLoading(false);
    }).catch(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [authUser?.user_id]);

  /* ── Load conversations when active agent changes ───────────── */
  useEffect(() => {
    if (!activeAgent) {
      setConversations([]);
      setActiveConversation(null);
      return;
    }
    listAgentConversations(activeAgent.agent_id).then((list) => {
      setConversations(list);
      setActiveConversation(list[0] ?? null);
    });
  }, [activeAgent?.agent_id]);

  /* ── Auth callbacks ─────────────────────────────────────────── */
  const handleLogin = useCallback((user: AuthUser) => {
    setAuthUser(user);
  }, []);

  const handleLogout = useCallback(() => {
    clearAuthSession();
    setAuthUser(null);
    setActiveAgent(null);
    setConversations([]);
    setActiveConversation(null);
    setFiles([]);
    setAgents([]);
  }, []);

  /* ── Agent actions ──────────────────────────────────────────── */
  const handleSelectAgent = useCallback((agent: AgentInfo) => {
    setActiveAgent(agent);
    setMainView("chat");
  }, []);

  const handleBackToLibrary = useCallback(() => {
    setActiveAgent(null);
    setConversations([]);
    setActiveConversation(null);
  }, []);

  const handleAgentUpdate = useCallback((updated: AgentInfo) => {
    setActiveAgent(updated);
    setAgents((prev) => prev.map((a) => a.agent_id === updated.agent_id ? updated : a));
    getFiles().then(setFiles);
  }, []);

  /* ── Conversation actions ────────────────────────────────────── */
  const handleNewConversation = useCallback(async () => {
    if (!activeAgent) return;
    try {
      const conv = await createAgentConversation(activeAgent.agent_id, "New conversation");
      setConversations((prev) => [conv, ...prev]);
      setActiveConversation(conv);
      setMainView("chat");
    } catch { /* ignore */ }
  }, [activeAgent]);

  const handleSelectConversation = useCallback((conv: ConversationInfo) => {
    setActiveConversation(conv);
    setMainView("chat");
  }, []);

  const handleDeleteConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.conversation_id !== id));
    setActiveConversation((cur) => (cur?.conversation_id === id ? null : cur));
  }, []);

  const handleRenameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) => prev.map((c) => c.conversation_id === id ? { ...c, title } : c));
    setActiveConversation((cur) => cur?.conversation_id === id ? { ...cur, title } : cur);
  }, []);

  /* ── Auth loading screen ────────────────────────────────────── */
  if (authLoading) {
    return (
      <div
        className="h-screen flex items-center justify-center"
        style={{ background: "var(--color-bg)" }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "var(--color-accent)" }}
          >
            <BarChart3 size={20} className="text-white" />
          </div>
          <Loader2 size={18} className="anim-spin" style={{ color: "var(--color-accent)" }} />
        </div>
      </div>
    );
  }

  /* ── Login screen ───────────────────────────────────────────── */
  if (!authUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  /* ── Authenticated app ──────────────────────────────────────── */
  const isWorkspace = activeAgent !== null;

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: "var(--color-bg)" }}>

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside
        className="w-[240px] shrink-0 hidden md:flex flex-col border-r"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        {/* Logo + controls */}
        <div className="h-14 flex items-center gap-2.5 px-3 border-b shrink-0"
             style={{ borderColor: "var(--color-border)" }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
               style={{ background: "var(--color-accent)" }}>
            <BarChart3 size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold leading-tight" style={{ color: "var(--color-text)" }}>DataRAG</p>
            <p className="text-[9.5px] leading-tight truncate" style={{ color: "var(--color-text-3)" }}>
              Document Intelligence
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {/* Backend status */}
            {backendStatus === "checking" && (
              <Loader2 size={11} className="anim-spin" style={{ color: "var(--color-text-3)" }} />
            )}
            {backendStatus === "online" && (
              <span className="block w-1.5 h-1.5 rounded-full anim-pulse" style={{ background: "var(--color-success)" }} />
            )}
            {backendStatus === "offline" && (
              <span className="block w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-danger)" }} />
            )}
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light" : "Switch to dark"}
              className="w-5 h-5 flex items-center justify-center rounded-md transition-all hover:brightness-110"
              style={{ background: "var(--color-elevated)", border: "1px solid var(--color-border-mid)", color: "var(--color-text-2)" }}
            >
              {theme === "dark" ? <Sun size={10} /> : <Moon size={10} />}
            </button>
          </div>
        </div>

        {/* User badge + logout */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
            style={{
              background: authUser.role === "admin" ? "#f59e0b" : "var(--color-accent)",
            }}
          >
            {authUser.username[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-medium truncate leading-tight" style={{ color: "var(--color-text)" }}>
              {authUser.username}
            </p>
            <p className="text-[9.5px] leading-tight capitalize" style={{ color: "var(--color-text-3)" }}>
              {authUser.role}
            </p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="w-5 h-5 flex items-center justify-center rounded-md transition-all hover:brightness-110 shrink-0"
            style={{ color: "var(--color-text-3)", background: "var(--color-elevated)", border: "1px solid var(--color-border-mid)" }}
          >
            <LogOut size={10} />
          </button>
        </div>

        {isWorkspace ? (
          <AgentWorkspaceSidebar
            agent={activeAgent}
            agentFiles={files.filter((f) => activeAgent.file_ids.includes(f.file_id))}
            conversations={conversations}
            activeConversation={activeConversation}
            onBack={handleBackToLibrary}
            onAgentUpdate={handleAgentUpdate}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
            onRenameConversation={handleRenameConversation}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center px-4 text-center gap-3 pb-4">
            <p className="text-[11px]" style={{ color: "var(--color-text-3)" }}>
              Select an agent to start chatting
            </p>
          </div>
        )}
      </aside>

      {/* ── Main ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Offline banner */}
        {backendStatus === "offline" && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 text-xs shrink-0 anim-fade-in"
               style={{ background: "var(--color-danger-dim)", borderBottom: "1px solid rgba(239,68,68,0.2)", color: "var(--color-danger)" }}>
            <WifiOff size={12} className="shrink-0" />
            <span>Backend offline — run <code className="px-1 py-0.5 rounded text-[11px]"
                  style={{ background: "rgba(239,68,68,0.15)", fontFamily: "var(--font-mono)" }}>uvicorn main:app --reload</code> in <code style={{ fontFamily: "var(--font-mono)" }}>backend/</code></span>
          </div>
        )}

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 anim-fade-in">
              <Loader2 size={24} className="anim-spin" style={{ color: "var(--color-accent)" }} />
              <p className="text-[13px]" style={{ color: "var(--color-text-2)" }}>Loading…</p>
            </div>
          </div>
        ) : !isWorkspace ? (
          /* ── Agent Library ─────────────────────────────────────── */
          <AgentLibrary
            agents={agents}
            onSelectAgent={handleSelectAgent}
            onAgentsChange={setAgents}
          />
        ) : (
          /* ── Agent Workspace ───────────────────────────────────── */
          <div className="flex-1 flex flex-col min-h-0">
            {/* View switcher */}
            <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b"
                 style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
              {(["chat", "debug"] as MainView[]).map((v) => {
                const Icon = v === "chat" ? MessageSquare : Layers;
                const label = v === "chat" ? "Chat" : "Inspect";
                return (
                  <button key={v} type="button" onClick={() => setMainView(v)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-all"
                          style={mainView === v
                            ? { background: "var(--color-accent-dim)", color: "var(--color-accent-text)", border: "1px solid rgba(99,102,241,0.25)" }
                            : { background: "transparent", color: "var(--color-text-3)", border: "1px solid transparent" }}>
                    <Icon size={12} />{label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0">
              {mainView === "chat" ? (
                <ChatBox
                  agentId={activeAgent.agent_id}
                  agentName={activeAgent.name}
                  activeConversation={activeConversation}
                />
              ) : files.find((f) => activeAgent.file_ids.includes(f.file_id)) ? (
                <ChunkInspector file={files.find((f) => activeAgent.file_ids.includes(f.file_id))!} />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-[13px]" style={{ color: "var(--color-text-3)" }}>No files attached to inspect.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
