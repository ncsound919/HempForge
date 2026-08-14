export interface Mem0Config {
  apiUrl: string;
}

export interface Mem0AddParams {
  messages: string | { role: string; content: string }[];
  userId?: string;
  agentId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  infer?: boolean;
}

export interface Mem0SearchParams {
  query: string;
  userId?: string;
  agentId?: string;
  runId?: string;
  limit?: number;
  threshold?: number;
}

export interface Mem0MemoryItem {
  id: string;
  memory: string;
  hash?: string;
  metadata?: Record<string, unknown>;
  score?: number;
  created_at?: string;
  updated_at?: string;
  event?: "ADD" | "UPDATE" | "DELETE";
}

export interface Mem0SearchResult {
  results: Mem0MemoryItem[];
  relations?: Record<string, unknown>[];
}

export interface Mem0AddResult {
  results: Mem0MemoryItem[];
  relations?: Record<string, unknown>[];
}

export interface Mem0DeleteResult {
  message: string;
}
