"use client";

import { useState, useEffect } from "react";
import { BarChart3, Lock, User, Eye, EyeOff, AlertCircle, ShieldCheck } from "lucide-react";
import { login, saveAuthSession, AuthUser } from "@/lib/api";

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

const DEMO_ACCOUNTS = [
  { username: "admin",  password: "changeme123", role: "Admin",  color: "#f59e0b" },
  { username: "thiru",  password: "thiru123",    role: "User",   color: "#6366f1" },
  { username: "subanu", password: "subanu123",   role: "User",   color: "#10b981" },
];

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await login(username.trim(), password);
      saveAuthSession(data);
      onLogin({ user_id: data.user_id, username: data.username, role: data.role });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  const fillAccount = (acc: typeof DEMO_ACCOUNTS[0]) => {
    setUsername(acc.username);
    setPassword(acc.password);
    setError("");
  };

  if (!mounted) return null;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--color-bg)" }}
    >
      {/* Background decoration */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full opacity-[0.04]"
          style={{ background: "var(--color-accent)", filter: "blur(80px)" }}
        />
        <div
          className="absolute -bottom-60 -left-40 w-[500px] h-[500px] rounded-full opacity-[0.03]"
          style={{ background: "var(--color-accent)", filter: "blur(80px)" }}
        />
      </div>

      <div className="w-full max-w-[400px] relative">
        {/* Logo + brand */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
            style={{ background: "var(--color-accent)" }}
          >
            <BarChart3 size={28} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--color-text)" }}>
              DataRAG
            </h1>
            <p className="text-[12.5px] mt-0.5" style={{ color: "var(--color-text-3)" }}>
              Document Intelligence Platform
            </p>
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-7"
          style={{
            background: "var(--color-raised)",
            border: "1px solid var(--color-border-mid)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          }}
        >
          <h2 className="text-[15px] font-semibold mb-0.5" style={{ color: "var(--color-text)" }}>
            Sign in to your account
          </h2>
          <p className="text-[12px] mb-6" style={{ color: "var(--color-text-3)" }}>
            Enter your credentials below to continue
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label
                className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5"
                style={{ color: "var(--color-text-3)" }}
              >
                Username
              </label>
              <div className="relative">
                <User
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "var(--color-text-3)" }}
                />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(""); }}
                  placeholder="your username"
                  autoComplete="username"
                  autoFocus
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[13px] outline-none transition-all"
                  style={{
                    background: "var(--color-elevated)",
                    border: "1.5px solid var(--color-border-mid)",
                    color: "var(--color-text)",
                  }}
                  onFocus={(e) =>
                    (e.target.style.borderColor = "var(--color-accent)")
                  }
                  onBlur={(e) =>
                    (e.target.style.borderColor = "var(--color-border-mid)")
                  }
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5"
                style={{ color: "var(--color-text-3)" }}
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "var(--color-text-3)" }}
                />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl text-[13px] outline-none transition-all"
                  style={{
                    background: "var(--color-elevated)",
                    border: "1.5px solid var(--color-border-mid)",
                    color: "var(--color-text)",
                  }}
                  onFocus={(e) =>
                    (e.target.style.borderColor = "var(--color-accent)")
                  }
                  onBlur={(e) =>
                    (e.target.style.borderColor = "var(--color-border-mid)")
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-text-3)" }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[12px]"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "#ef4444",
                }}
              >
                <AlertCircle size={13} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password.trim()}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-1"
              style={{ background: "var(--color-accent)" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>

        {/* Demo accounts */}
        <div
          className="mt-4 rounded-2xl p-4"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="flex items-center gap-1.5 mb-3">
            <ShieldCheck size={12} style={{ color: "var(--color-text-3)" }} />
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-text-3)" }}
            >
              Development accounts — click to fill
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.username}
                type="button"
                onClick={() => fillAccount(acc)}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-[12px] transition-all hover:brightness-105 active:scale-[0.99] text-left"
                style={{
                  background: "var(--color-elevated)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-2)",
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                    style={{ background: acc.color }}
                  >
                    {acc.username[0].toUpperCase()}
                  </div>
                  <span className="font-medium">{acc.username}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{
                      background: acc.color + "20",
                      color: acc.color,
                    }}
                  >
                    {acc.role}
                  </span>
                </div>
                <span
                  className="font-mono text-[11px]"
                  style={{ color: "var(--color-text-3)" }}
                >
                  {acc.password}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
