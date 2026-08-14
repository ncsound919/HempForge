import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, Cpu,
  Loader2, MessageSquare, RefreshCw, Send, Trash2, User, X,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export default function ResearchChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const wsUrl = process.env.RESEARCHCLAW_URL
      ? process.env.RESEARCHCLAW_URL.replace(/^http/, 'ws') + '/ws/chat'
      : 'ws://localhost:8080/ws/chat';

    let reconnectTimer: number | null = null;

    function connect() {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          setError(null);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'chat_response' || data.type === 'message') {
              const msg = data.data?.message || data.message || event.data;
              setMessages((prev) => [...prev, {
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                role: 'assistant',
                content: typeof msg === 'string' ? msg : JSON.stringify(msg),
                timestamp: new Date().toISOString(),
              }]);
            } else if (data.type === 'error') {
              setError(data.data?.error || 'Unknown error');
            }
          } catch {
            setMessages((prev) => [...prev, {
              id: `msg-${Date.now()}`,
              role: 'assistant',
              content: event.data,
              timestamp: new Date().toISOString(),
            }]);
          }
        };

        ws.onerror = () => {
          setConnected(false);
          setError('WebSocket connection error');
        };

        ws.onclose = () => {
          setConnected(false);
          reconnectTimer = window.setTimeout(connect, 5000);
        };
      } catch (err: any) {
        setError(err.message || 'Failed to connect');
        reconnectTimer = window.setTimeout(connect, 5000);
      }
    }

    connect();

    return () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    setMessages((prev) => [...prev, {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }]);
    setInput('');
    setSending(true);

    wsRef.current.send(text);

    setTimeout(() => setSending(false), 300);
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <header className="border-b border-white/10 pb-6 flex flex-col xl:flex-row xl:items-end justify-between gap-5">
        <div className="space-y-2">
          <h2 className="text-3xl font-display font-bold text-white tracking-tight italic">
            Research Chat
          </h2>
          <p className="text-white/45 font-mono text-xs uppercase tracking-widest max-w-3xl">
            Conversational research with the ResearchClaw dialog agent
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`text-[10px] font-mono px-3 py-1.5 border flex items-center gap-1.5 ${connected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-300 border-red-500/20'}`}>
            <Cpu size={12} className={connected ? '' : 'animate-pulse'} />
            {connected ? 'CONNECTED' : 'DISCONNECTED'}
          </div>
          {pipelineId && (
            <div className="text-[10px] font-mono text-slate-500">Run: {pipelineId}</div>
          )}
        </div>
      </header>

      {error && (
        <div className="border border-red-500/20 bg-red-500/10 text-red-300 p-3 text-xs font-mono flex items-center gap-2">
          <AlertTriangle size={12} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto hover:text-white"><X size={12} /></button>
        </div>
      )}

      <div className="border border-white/5 bg-[#111815] flex flex-col" style={{ height: '600px' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-emerald-400" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/70">
              Chat Session
            </span>
            <span className="text-[10px] font-mono text-slate-600">({messages.length} messages)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              className="px-2 py-1 text-[9px] font-mono text-slate-500 hover:text-white border border-white/10 hover:bg-white/5 flex items-center gap-1"
            >
              <Trash2 size={10} />
              Clear
            </button>
            <button onClick={() => setExpanded(!expanded)} className="text-slate-500 hover:text-white">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Bot size={32} className="text-slate-600 mx-auto mb-3" />
                <div className="text-sm text-slate-500">Ask a research question</div>
                <div className="mt-1 text-xs text-slate-600">Examples: "Summarize latest findings on CBD bioavailability" or "What are the key papers on cannabinoid extraction?"</div>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="shrink-0 w-8 h-8 bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Bot size={14} className="text-emerald-400" />
                </div>
              )}
              <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-1' : ''}`}>
                <div className={`px-4 py-2.5 text-xs leading-relaxed ${msg.role === 'user' ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20' : 'bg-black/40 text-slate-300 border border-white/5'}`}>
                  <pre className="font-sans whitespace-pre-wrap">{msg.content}</pre>
                </div>
                <div className="mt-1 text-[9px] font-mono text-slate-600 px-1">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
              {msg.role === 'user' && (
                <div className="shrink-0 w-8 h-8 bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                  <User size={14} className="text-sky-400" />
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Bot size={14} className="text-emerald-400" />
              </div>
              <div className="bg-black/40 border border-white/5 px-4 py-2.5">
                <Loader2 size={12} className="animate-spin text-emerald-400" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-white/5 p-4 shrink-0">
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your research question..."
              disabled={!connected}
              className="flex-1 px-4 py-2.5 bg-black/40 border border-white/10 text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40 disabled:opacity-40"
            />
            <button
              onClick={sendMessage}
              disabled={!connected || !input.trim() || sending}
              className="px-4 py-2.5 bg-emerald-500 text-black text-xs font-mono uppercase tracking-widest font-bold hover:bg-emerald-400 disabled:bg-emerald-800 disabled:text-white/40 flex items-center gap-2"
            >
              <Send size={12} />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
