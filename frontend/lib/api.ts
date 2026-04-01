/**
 * API Client — all communication with the FastAPI backend.
 *
 * WHAT THIS FILE DOES:
 * Provides typed functions for every backend endpoint.
 * Handles SSE stream reading for upload progress and chat streaming.
 *
 * WHY A SEPARATE FILE:
 * Components shouldn't know about HTTP details (URLs, headers, parsing).
 * They call api.uploadFile() or api.queryStream() and get clean data back.
 * If the backend URL changes, you update ONE file.
 *
 * SSE READING PATTERN:
 * fetch() returns a Response with a ReadableStream body.
 * We read chunks from the stream, decode them to text, parse SSE events,
 * and call the provided callback for each event.
 */

// ── Types ─────────────────────────────────────────────────────────

export interface UploadProgress {
  stage: string;
  percent: number;
  message: string;
  file_id?: string;
}

export interface UploadResult {
  file_id: string;
  file_name: string;
  total_chunks: number;
  total_rows_processed: number;
  sheets: string[];
  status: string;
}

export interface FileInfo {
  file_id: string;
  file_name: string;
  chunks: number;
}

export interface QuerySource {
  file_name: string;
  sheet_name: string;
  row_start: number;
  row_end: number;
  score: number;
}

export interface QueryFullResponse {
  answer: string;
  sources: QuerySource[];
  chunks_searched: number;
}

// ── Base URL ──────────────────────────────────────────────────────

// In development, Next.js rewrites /api/* to localhost:8000/api/*
// In production, the backend would be on the same domain or a configured URL
const API_BASE = "/api";

// ── File Upload with SSE Progress ─────────────────────────────────

export async function uploadFile(
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<UploadResult | null> {
  /**
   * Upload a file and receive progress updates via SSE.
   *
   * HOW IT WORKS:
   * 1. Send the file as multipart form data
   * 2. The backend keeps the connection open and streams SSE events
   * 3. We read each event and call onProgress()
   * 4. When the stream ends, we return the final result
   *
   * WHY FormData:
   * Files can't be sent as JSON. FormData is the browser's way of
   * sending files over HTTP — it encodes the file as multipart/form-data,
   * which FastAPI's UploadFile parameter knows how to receive.
   */
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
    // Note: do NOT set Content-Type header — the browser sets it
    // automatically with the correct multipart boundary string.
    // Setting it manually breaks the upload.
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(error.detail || "Upload failed");
  }

  // Read the SSE stream
  return await readSSEStream<UploadResult>(response, (event) => {
    if (event.stage && event.percent !== undefined) {
      onProgress(event as UploadProgress);
    }
    // The final event contains the result (has file_id + total_chunks)
    if (event.file_id && event.total_chunks !== undefined) {
      return event as UploadResult;
    }
    return null;
  });
}

// ── Streaming Query ───────────────────────────────────────────────

export async function queryStream(
  question: string,
  fileId: string | null,
  sheetName: string | null,
  chatHistory: { role: string; content: string }[],
  onToken: (token: string) => void,
): Promise<void> {
  /**
   * Send a question and receive the answer token by token via SSE.
   *
   * HOW THE FRONTEND USES THIS:
   * 1. User types a question and hits send
   * 2. This function streams tokens to the onToken callback
   * 3. The ChatBox component appends each token to the message bubble
   * 4. The user sees the answer "typing itself out"
   *
   * The chat history is sent so the LLM understands references like
   * "break that down by region" (what does "that" refer to?).
   */
  const response = await fetch(`${API_BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      file_id: fileId,
      sheet_name: sheetName,
      chat_history: chatHistory,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Query failed" }));
    throw new Error(error.detail || "Query failed");
  }

  // Read the SSE stream token by token
  await readSSEStream(response, (event) => {
    if (event.error) {
      throw new Error(event.error);
    }
    if (event.token != null && event.token !== "") {
      onToken(event.token);
    }
    return null;
  });
}

// ── File Management ───────────────────────────────────────────────

export async function getFiles(): Promise<FileInfo[]> {
  const response = await fetch(`${API_BASE}/files`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.files || [];
}

export async function deleteFile(fileId: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}/files/${fileId}`, {
    method: "DELETE",
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.deleted;
}

// ── SSE Stream Reader ─────────────────────────────────────────────

async function readSSEStream<T>(
  response: Response,
  onEvent: (data: any) => T | null,
): Promise<T | null> {
  /**
   * Generic SSE stream reader.
   *
   * HOW SSE PARSING WORKS:
   * The server sends text like:
   *     data: {"token": "The"}\n\n
   *     data: {"token": " top"}\n\n
   *     data: {"done": true}\n\n
   *
   * We read raw bytes from the stream, decode to text, split by
   * double newlines (event boundaries), extract the JSON after "data: ",
   * and call the onEvent callback with each parsed object.
   *
   * WHY MANUAL PARSING (not EventSource):
   * The browser's EventSource API only works with GET requests.
   * Our endpoints use POST (to send the question in the body).
   * So we use fetch() + ReadableStream and parse SSE manually.
   * This is the standard approach — ChatGPT's frontend does the same thing.
   *
   * THE BUFFER PATTERN:
   * Network chunks don't align with SSE events. One chunk might contain
   * half an event, or two complete events. We buffer incoming text and
   * process complete events (delimited by \n\n) as they arrive.
   */
  const reader = response.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode the raw bytes to text and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete events (each ends with \n\n)
      const events = buffer.split("\n\n");
      // The last element might be incomplete — keep it in the buffer
      buffer = events.pop() || "";

      for (const event of events) {
        const dataLine = event
          .split("\n")
          .find((line) => line.startsWith("data: "));

        if (!dataLine) continue;

        const jsonStr = dataLine.slice(6);
        let data: any;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          continue; // skip malformed JSON only
        }
        // Call onEvent outside the try/catch so its errors propagate
        const eventResult = onEvent(data);
        if (eventResult !== null) {
          result = eventResult;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return result;
}