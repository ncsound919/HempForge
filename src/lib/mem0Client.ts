import type { Mem0AddParams, Mem0SearchParams, Mem0SearchResult, Mem0AddResult, Mem0MemoryItem, Mem0DeleteResult, Mem0Config } from "../types/mem0";

const DEFAULT_CONFIG: Mem0Config = {
  apiUrl: process.env.MEM0_API_URL || "http://localhost:8888",
};

let _config = { ...DEFAULT_CONFIG };

export function configureMem0(cfg: Partial<Mem0Config>): void {
  _config = { ..._config, ...cfg };
}

async function apiCall<T>(method: string, path: string, body?: unknown, timeoutMs = 10000): Promise<T> {
  const url = `${_config.apiUrl}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`mem0 API ${method} ${path}: ${res.status} — ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function addMemory(params: Mem0AddParams): Promise<Mem0AddResult> {
  const messages = typeof params.messages === "string"
    ? [{ role: "user", content: params.messages }]
    : params.messages;

  return apiCall<Mem0AddResult>("POST", "/memories", {
    messages,
    user_id: params.userId,
    agent_id: params.agentId,
    run_id: params.runId,
    metadata: params.metadata,
    infer: params.infer ?? true,
  });
}

export async function searchMemory(params: Mem0SearchParams): Promise<Mem0SearchResult> {
  return apiCall<Mem0SearchResult>("POST", "/search", {
    query: params.query,
    user_id: params.userId,
    agent_id: params.agentId,
    run_id: params.runId,
    limit: params.limit ?? 10,
    threshold: params.threshold,
  });
}

export async function getMemory(memoryId: string): Promise<Mem0MemoryItem | null> {
  try {
    return await apiCall<Mem0MemoryItem>("GET", `/memories/${memoryId}`);
  } catch {
    return null;
  }
}

export async function getAllMemories(params?: {
  userId?: string;
  agentId?: string;
  runId?: string;
  limit?: number;
}): Promise<Mem0SearchResult> {
  const query = new URLSearchParams();
  if (params?.userId) query.set("user_id", params.userId);
  if (params?.agentId) query.set("agent_id", params.agentId);
  if (params?.runId) query.set("run_id", params.runId);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return apiCall<Mem0SearchResult>("GET", `/memories${qs ? `?${qs}` : ""}`);
}

export async function updateMemory(memoryId: string, data: string): Promise<{ message: string }> {
  return apiCall<{ message: string }>("PUT", `/memories/${memoryId}`, { text: data });
}

export async function deleteMemory(memoryId: string): Promise<Mem0DeleteResult> {
  return apiCall<Mem0DeleteResult>("DELETE", `/memories/${memoryId}`);
}

export async function deleteAllMemories(params?: {
  userId?: string;
  agentId?: string;
  runId?: string;
}): Promise<Mem0DeleteResult> {
  return apiCall<Mem0DeleteResult>("DELETE", "/memories", {
    user_id: params?.userId,
    agent_id: params?.agentId,
    run_id: params?.runId,
  });
}

export async function getMemoryHistory(memoryId: string): Promise<Record<string, unknown>[]> {
  return apiCall<Record<string, unknown>[]>("GET", `/memories/${memoryId}/history`);
}

export async function healthCheck(): Promise<boolean> {
  try {
    // Bounded timeout — the every-minute probe must never pile up pending
    // fetches against an unreachable mem0 sidecar (SaaS hardening).
    const res = await fetch(`${_config.apiUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
