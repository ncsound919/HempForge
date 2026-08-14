import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Trash2, Clock, Brain, Loader2, MessageSquare, AlertCircle } from "lucide-react";

interface MemoryItem {
  id: string;
  memory: string;
  metadata?: Record<string, unknown>;
  score?: number;
  created_at?: string;
  updated_at?: string;
}

export default function MemoryExplorer() {
  const [query, setQuery] = useState("");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMemories = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const url = searchMode && query.trim()
        ? "/api/mem0/search"
        : "/api/mem0/memories";
      const body = searchMode && query.trim()
        ? { query: query.trim(), limit: 20 }
        : undefined;
      const res = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!controller.signal.aborted) setMemories(data.results || []);
    } catch (err: any) {
      if (err.name !== "AbortError" && !controller.signal.aborted) {
        setError(err.message || "Failed to fetch memories");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [query, searchMode]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { fetchMemories(); }, searchMode ? 300 : 0);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [fetchMemories, searchMode]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/mem0/memories/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err: any) {
      setError(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-emerald-400" />
          <h2 className="text-xl font-bold text-white">Agent Memory</h2>
        </div>
        <button
          onClick={() => { setSearchMode(!searchMode); setQuery(""); }}
          className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-none transition-colors ${
            searchMode
              ? "bg-emerald-600 text-white"
              : "bg-white/5 text-slate-400 hover:bg-white/10"
          }`}
        >
          {searchMode ? "Semantic Search" : "Browse All"}
        </button>
      </div>

      {searchMode && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchMemories()}
              placeholder="Search memories by meaning..."
              className="w-full bg-white/5 border border-white/10 rounded-none pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <button
            onClick={fetchMemories}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-none transition-colors"
          >
            Search
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-500/30 rounded-none text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">No memories stored yet.</p>
          <p className="text-xs text-slate-600 mt-1">Agent interactions will appear here automatically.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map((mem) => (
            <div
              key={mem.id}
              className="bg-white/5 border border-white/10 rounded-none p-4 hover:bg-white/10 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-slate-200 leading-relaxed flex-1">{mem.memory}</p>
                <button
                  onClick={() => handleDelete(mem.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-900/50 rounded-none transition-all"
                  title="Delete memory"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
              <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-500 font-mono">
                {mem.score !== undefined && (
                  <span>Relevance: {Math.round(mem.score * 100)}%</span>
                )}
                {mem.created_at && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(mem.created_at).toLocaleDateString()}
                  </span>
                )}
                <span className="text-[10px] text-slate-600">ID: {mem.id.slice(0, 8)}...</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
