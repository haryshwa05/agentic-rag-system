/**
 * HTTP client for the FastAPI backend (`/api`). See OpenAPI at `{origin}/docs`.
 * Upload still uses SSE for progress; RAG / search / chart return JSON (UI can animate text client-side).
 *
 * `NEXT_PUBLIC_API_BASE` overrides the default `http://127.0.0.1:8000/api`.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000/api";

/* ── Types ─────────────────────────────────────────────────────── */

export type QueryMode = "rag" | "search" | "chart";

/** Full file record from GET /files and GET /files/{file_id} */
export interface FileMetadata {
  file_id: string;
  file_name: string;
  original_filename?: string | null;
  extension?: string;
  byte_size?: number;
  mime_type?: string;
  total_chunks?: number;
  total_rows?: number;
  sheets?: string[];
  status?: string;
  is_private?: boolean;
  public_users?: string[];
  created_at?: string;
  updated_at?: string;
}

/** Sidebar / list item — `chunks` mirrors total_chunks for convenience */
export interface FileInfo extends FileMetadata {
  chunks?: number;
}

export interface UploadResult {
  file_id: string;
  file_name: string;
  total_chunks: number;
  status: string;
}

export interface UploadProgressEvent {
  stage: string;
  percent?: number;
  message?: string;
  file_id?: string;
  error?: string;
}

export interface QueryRequest {
  question: string;
  file_id?: string;
  agent_id?: string;
  sheet_name?: string;
  chat_history?: Array<{ role: string; content: string }>;
  conversation_id?: string;
}

/* ── Agent types ────────────────────────────────────────────────── */

export interface AgentInfo {
  agent_id: string;
  name: string;
  description: string;
  image: string;
  status: string;
  tags: string[];
  created_by: string;
  is_private: boolean;
  model: string;
  file_ids: string[];
  file_count: number;
  conversation_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface AgentCreate {
  name: string;
  description?: string;
  image?: string;
  status?: string;
  tags?: string[];
  created_by?: string;
  is_private?: boolean;
  model?: string;
  file_ids?: string[];
}

export interface ConversationInfo {
  conversation_id: string;
  file_id: string | null;
  agent_id: string | null;
  title: string;
  message_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface MessageInfo {
  message_id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string | null;
}

export interface Source {
  file_name: string;
  sheet_name: string;
  row_start: number;
  row_end: number;
  score: number;
}

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface PlotlyConfig {
  data: unknown[];
  layout: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface QueryResponse {
  answer: string;
  sources?: Source[];
  chunks_searched?: number;
}

export interface WebSearchResponse {
  answer: string;
  sources: SearchSource[];
}

export interface ChartResponse {
  answer: string;
  chart: PlotlyConfig | null;
}

/* ── Auth types ─────────────────────────────────────────────────── */

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  username: string;
  role: string;
}

export interface AuthUser {
  user_id: string;
  username: string;
  role: string;
}

/* ── Auth session helpers ───────────────────────────────────────── */

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const s = localStorage.getItem("current_user");
    return s ? (JSON.parse(s) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function saveAuthSession(data: LoginResponse): void {
  localStorage.setItem("access_token", data.access_token);
  localStorage.setItem(
    "current_user",
    JSON.stringify({ user_id: data.user_id, username: data.username, role: data.role })
  );
}

export function clearAuthSession(): void {
  localStorage.removeItem("access_token");
  localStorage.removeItem("current_user");
}

/* ── Authenticated fetch wrapper ────────────────────────────────── */

/**
 * Wraps `fetch` to automatically inject `Authorization: Bearer <token>` header.
 * On a 401 response it clears the local session and fires an `auth:logout` event
 * so the app can redirect to the login screen.
 */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    clearAuthSession();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("auth:logout"));
  }
  return res;
}

/* ── Auth endpoints ─────────────────────────────────────────────── */

export async function login(username: string, password: string): Promise<LoginResponse> {
  const form = new URLSearchParams({ username, password });
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? "Login failed.");
  return data as LoginResponse;
}

export async function getMe(): Promise<AuthUser | null> {
  try {
    const res = await apiFetch(`${BASE}/auth/me`);
    if (!res.ok) return null;
    return (await res.json()) as AuthUser;
  } catch {
    return null;
  }
}

/* ── File management ───────────────────────────────────────────── */

export async function getFiles(): Promise<FileInfo[]> {
  try {
    const res = await apiFetch(`${BASE}/files`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.files ?? []).map((f: FileMetadata) => ({
      ...f,
      chunks: f.total_chunks ?? 0,
    }));
  } catch {
    return [];
  }
}

/** GET /files/{file_id} — full metadata (any status, not only complete). */
export async function getFile(fileId: string): Promise<FileMetadata | null> {
  try {
    const res = await apiFetch(`${BASE}/files/${fileId}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as FileMetadata;
  } catch {
    return null;
  }
}

export interface RenameFileResponse {
  file_id: string;
  file_name: string;
  message: string;
}

/** PATCH /files/{file_id} — changes user-visible `file_name` only (display label). */
export async function renameFile(
  fileId: string,
  displayName: string
): Promise<RenameFileResponse> {
  const res = await apiFetch(`${BASE}/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: displayName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof (data as { detail?: string }).detail === "string"
        ? (data as { detail: string }).detail
        : "Rename failed."
    );
  }
  return data as RenameFileResponse;
}

export async function deleteFile(fileId: string): Promise<void> {
  const res = await apiFetch(`${BASE}/files/${fileId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(data) ?? "Delete failed.");
  }
}

/* ── Conversations ─────────────────────────────────────────────── */

export async function createConversation(
  fileId?: string,
  title = "New conversation"
): Promise<ConversationInfo> {
  const res = await apiFetch(`${BASE}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId ?? null, title }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return data as ConversationInfo;
}

export async function listConversations(fileId?: string): Promise<ConversationInfo[]> {
  const url = fileId
    ? `${BASE}/conversations?file_id=${encodeURIComponent(fileId)}`
    : `${BASE}/conversations`;
  const res = await apiFetch(url);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ conversations: [] }));
  return (data.conversations ?? []) as ConversationInfo[];
}

export async function getConversationMessages(conversationId: string): Promise<MessageInfo[]> {
  const res = await apiFetch(`${BASE}/conversations/${conversationId}/messages`);
  const data = await res.json().catch(() => ({ messages: [] }));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return (data.messages ?? []) as MessageInfo[];
}

export async function renameConversation(
  conversationId: string,
  title: string
): Promise<void> {
  await apiFetch(`${BASE}/conversations/${conversationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const res = await apiFetch(`${BASE}/conversations/${conversationId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(data));
  }
}

/* ── File upload with SSE progress ─────────────────────────────── */

export interface ChunkInfo {
  chunk_id: string;
  text: string;
  sheet_name: string;
  row_start: number;
  row_end: number;
  file_name: string;
  chunk_type: string;
}

export interface ChunkListResponse {
  file_id: string;
  total: number;
  limit: number;
  offset: number;
  chunks: ChunkInfo[];
}

export async function getChunks(
  fileId: string,
  opts?: { limit?: number; offset?: number; sheet_name?: string }
): Promise<ChunkListResponse> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  if (opts?.sheet_name) params.set("sheet_name", opts.sheet_name);
  const url = `${BASE}/files/${fileId}/chunks?${params}`;
  const res = await apiFetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return data as ChunkListResponse;
}

export async function uploadFile(
  file: File,
  onProgress: (e: UploadProgressEvent) => void,
  options?: { displayName?: string; isPrivate?: boolean; publicUsers?: string[] }
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  if (options?.displayName?.trim()) {
    form.append("display_name", options.displayName.trim());
  }
  form.append("is_private", options?.isPrivate ? "true" : "false");
  form.append("public_users", JSON.stringify(options?.publicUsers ?? []));

  // Do NOT set Content-Type for FormData — browser must set it with the boundary.
  // We manually add the auth header here instead of using apiFetch.
  const token = getStoredToken();
  const headers: HeadersInit = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form, headers });

  if (res.status === 401) {
    clearAuthSession();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("auth:logout"));
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { detail?: string }).detail ?? `Upload failed (${res.status})`);
  }

  return readSSEStream<UploadResult>(res, onProgress);
}

/* ── RAG / web / chart (JSON) ───────────────────────────────────── */

function parseErrorDetail(data: unknown): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail?: unknown }).detail;
    if (typeof d === "string") return d;
  }
  return "Request failed.";
}

export async function queryDocument(
  body: QueryRequest,
  signal?: AbortSignal
): Promise<QueryResponse> {
  const res = await apiFetch(`${BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return data as QueryResponse;
}

export async function searchDocument(
  question: string,
  signal?: AbortSignal
): Promise<WebSearchResponse> {
  const res = await apiFetch(`${BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return data as WebSearchResponse;
}

export async function chartDocument(
  question: string,
  signal?: AbortSignal
): Promise<ChartResponse> {
  const res = await apiFetch(`${BASE}/chart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return data as ChartResponse;
}

/* ── Agents ─────────────────────────────────────────────────────── */

export async function listAgents(): Promise<AgentInfo[]> {
  try {
    const res = await apiFetch(`${BASE}/agents`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({ agents: [] }));
    return (data.agents ?? []) as AgentInfo[];
  } catch {
    return [];
  }
}

export async function getAgent(agentId: string): Promise<AgentInfo | null> {
  try {
    const res = await apiFetch(`${BASE}/agents/${agentId}`);
    if (!res.ok) return null;
    return (await res.json()) as AgentInfo;
  } catch {
    return null;
  }
}

export async function createAgent(body: AgentCreate): Promise<AgentInfo> {
  const res = await apiFetch(`${BASE}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return data as AgentInfo;
}

export async function updateAgent(
  agentId: string,
  body: Partial<AgentCreate>
): Promise<AgentInfo> {
  const res = await apiFetch(`${BASE}/agents/${agentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return data as AgentInfo;
}

export async function deleteAgent(agentId: string): Promise<void> {
  const res = await apiFetch(`${BASE}/agents/${agentId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(data));
  }
}

export async function attachFilesToAgent(
  agentId: string,
  fileIds: string[]
): Promise<AgentInfo> {
  const res = await apiFetch(`${BASE}/agents/${agentId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_ids: fileIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return data as AgentInfo;
}

export async function detachFileFromAgent(
  agentId: string,
  fileId: string
): Promise<void> {
  const res = await apiFetch(`${BASE}/agents/${agentId}/files/${fileId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(data));
  }
}

export async function listAgentConversations(
  agentId: string
): Promise<ConversationInfo[]> {
  const res = await apiFetch(`${BASE}/agents/${agentId}/conversations`);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ conversations: [] }));
  return (data.conversations ?? []) as ConversationInfo[];
}

export async function createAgentConversation(
  agentId: string,
  title = "New conversation"
): Promise<ConversationInfo> {
  const res = await apiFetch(`${BASE}/agents/${agentId}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseErrorDetail(data));
  return data as ConversationInfo;
}

/* ── SSE helpers (upload only) ─────────────────────────────────── */

/**
 * Reads an SSE stream that terminates with a final JSON payload.
 * Used by /upload — progress events are forwarded to `onProgress`, the
 * last event (no `stage`) is returned as the final result.
 */
async function readSSEStream<T>(
  res: Response,
  onProgress: (e: UploadProgressEvent) => void
): Promise<T> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastResult: T | null = null;

  const readWithTimeout = async () => {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
        setTimeout(() => reject(new Error("Upload stream timed out. Please retry.")), 120000)
      ),
    ]);
  };

  while (true) {
    const { value, done } = await readWithTimeout();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;

      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(raw);
      } catch {
        continue;
      }

      if (evt.stage) {
        const normalised: UploadProgressEvent = {
          ...(evt as unknown as UploadProgressEvent),
          message: String(
            (evt as Record<string, unknown>).message ??
            (evt as Record<string, unknown>).error ??
            ""
          ),
        };
        onProgress(normalised);
        if (evt.stage === "error") {
          const msg = String(
            (evt as Record<string, unknown>).error ??
            (evt as Record<string, unknown>).message ??
            "Upload failed"
          );
          throw new Error(msg);
        }
      } else if (evt.file_id) {
        lastResult = evt as unknown as T;
      } else if (evt.error) {
        onProgress({ stage: "error", message: String(evt.error) });
        throw new Error(String(evt.error));
      }
    }
  }

  if (!lastResult) throw new Error("No result returned from upload.");
  return lastResult;
}
