import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Bot,
  User,
  Zap,
  Cpu,
  Cloud,
  ChevronDown,
  ChevronRight,
  Wrench,
  Eye,
  Brain,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { authFetch } from '../lib/firebase';
import {
  getOllamaConfig,
  queryLocalOllama,
  detectLocalModels,
} from '../lib/ollamaService';

type HarnessRole =
  | 'system'
  | 'user'
  | 'assistant'
  | 'planner'
  | 'tool'
  | 'observation'
  | 'error';

type HarnessStatus = 'queued' | 'running' | 'success' | 'error' | 'final';

interface HarnessMessage {
  id: string;
  role: HarnessRole;
  content: string;
  timestamp: string;
  agentType?: string;
  step?: number;
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: any;
  status?: HarnessStatus;
  traceId?: string;
}

interface PlannerDecision {
  action: 'respond' | 'tool_call' | 'ask_clarifying_question';
  agentType: string;
  message: string;
  toolName?: string;
  args?: Record<string, any>;
  confidence: number;
}

interface ToolSpec {
  name: string;
  description: string;
  run: (args: any) => Promise<any>;
}

const HARNESS_SYSTEM_PROMPT = `
You are HempForge Orchestrator operating as a tool-using agent harness.

Behavior:
- Prefer deterministic tools over freeform reasoning when tools exist.
- Ask a clarifying question if the request is missing required parameters.
- Use at most one tool per step.
- Keep the plan short and practical.
- Return ONLY valid JSON.

Allowed tools:
1. calculate_total_thc
2. search_literature
3. get_cached_literature
4. get_coas

JSON shape:
{
  "action": "respond" | "tool_call" | "ask_clarifying_question",
  "agentType": "Compliance" | "Literature" | "Cultivation" | "Reporting" | "Orchestrator",
  "message": "short plain English rationale or answer",
  "toolName": "optional tool name",
  "args": {},
  "confidence": 0.0
}
`;

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = 'msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

function summarizeObservation(toolName: string, result: any): string {
  if (toolName === 'calculate_total_thc') {
    return `Calculated total THC: ${result?.calculatedTotal ?? 'unknown'}, status: ${result?.status ?? 'unknown'}, alerts: ${(result?.alerts || []).join('; ') || 'none'}`;
  }

  if (toolName === 'search_literature') {
    const count = result?.count ?? result?.papers?.length ?? 0;
    return `Literature search returned ${count} papers.`;
  }

  if (toolName === 'get_cached_literature') {
    const count = result?.papers?.length ?? 0;
    return `Cached literature contains ${count} papers.`;
  }

  if (toolName === 'get_coas') {
    const count = Array.isArray(result) ? result.length : 0;
    return `Retrieved ${count} COA records.`;
  }

  return typeof result === 'string'
    ? result
    : JSON.stringify(result).slice(0, 500);
}

function buildRecentContext(history: HarnessMessage[], limit = 8) {
  return history.slice(-limit).map((m) => {
    const label =
      m.role === 'assistant'
        ? 'assistant'
        : m.role === 'planner'
        ? 'planner'
        : m.role === 'tool'
        ? 'tool'
        : m.role === 'observation'
        ? 'observation'
        : m.role;

    return `${label}: ${m.content}`;
  }).join('\n');
}

function buildPlannerInput(
  userInput: string,
  history: HarnessMessage[],
  events: HarnessMessage[],
  tools: ToolSpec[],
) {
  return `
User objective:
${userInput}

Recent conversation:
${buildRecentContext(history, 8)}

Trace so far:
${events.map(e => `${e.role}: ${e.content}`).join('\n') || 'none'}

Available tools:
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Decide the next best action.
`.trim();
}

async function queryGeminiPlanner(
  plannerInput: string,
  history: HarnessMessage[],
): Promise<string> {
  const response = await authFetch('/api/gemini/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `${HARNESS_SYSTEM_PROMPT}\n\n${plannerInput}`,
      history: history.map((msg) => ({
        role:
          msg.role === 'assistant' || msg.role === 'planner'
            ? 'model'
            : 'user',
        content: msg.content,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Gemini harness response');
  }

  const data = await response.json();
  return data.text;
}

async function queryModelDecision(params: {
  provider: 'ollama' | 'gemini';
  endpoint?: string;
  model: string;
  plannerInput: string;
  history: HarnessMessage[];
}) {
  if (params.provider === 'ollama') {
    return queryLocalOllama(
      params.endpoint!,
      params.model,
      params.plannerInput,
      [],
      HARNESS_SYSTEM_PROMPT,
    );
  }

  return queryGeminiPlanner(params.plannerInput, params.history);
}

function DecisionBadge({ role }: { role: HarnessRole }) {
  const base = 'text-[9px] uppercase tracking-[0.2em] font-mono px-2 py-1 border';
  if (role === 'planner') {
    return <span className={`${base} text-sky-300 border-sky-500/30 bg-sky-500/10`}>Planner</span>;
  }
  if (role === 'tool') {
    return <span className={`${base} text-amber-300 border-amber-500/30 bg-amber-500/10`}>Tool</span>;
  }
  if (role === 'observation') {
    return <span className={`${base} text-emerald-300 border-emerald-500/30 bg-emerald-500/10`}>Observation</span>;
  }
  if (role === 'error') {
    return <span className={`${base} text-red-300 border-red-500/30 bg-red-500/10`}>Error</span>;
  }
  if (role === 'assistant') {
    return <span className={`${base} text-emerald-300 border-emerald-500/30 bg-emerald-500/10`}>Final</span>;
  }
  return <span className={`${base} text-white/50 border-white/10 bg-white/5`}>Event</span>;
}

export default function AgentChat() {
  const [messages, setMessages] = useState<HarnessMessage[]>([
    {
      id: 'msg-1',
      role: 'system',
      content: 'Harness core loaded. Planner, tools, observations, and synthesis loop are ready.',
      timestamp: nowIso(),
    },
    {
      id: 'msg-2',
      role: 'assistant',
      agentType: 'Orchestrator',
      content: 'Welcome to HempForge. I can route compliance math, literature retrieval, COA review, and cloud-or-local model reasoning through a structured agent harness.',
      timestamp: nowIso(),
      status: 'final',
    },
  ]);

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [engineProvider, setEngineProvider] = useState<'ollama' | 'gemini'>('gemini');
  const [activeModelName, setActiveModelName] = useState('gemini-2.5-flash');
  const [isOllamaConnected, setIsOllamaConnected] = useState(false);
  const [ollamaEndpoint, setOllamaEndpoint] = useState('http://127.0.0.1:11434');
  const [isSimulated, setIsSimulated] = useState(false);
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    const config = getOllamaConfig();
    setEngineProvider(config.preferredProvider);
    setOllamaEndpoint(config.endpoint);
    setIsSimulated(!!config.simulate);

    if (config.preferredProvider === 'ollama') {
      setActiveModelName(config.model);
      detectLocalModels(config.endpoint)
        .then((models) => {
          if (models.length > 0) {
            setIsOllamaConnected(true);
            if (!models.some((m) => m.name === config.model || m.name.startsWith(config.model))) {
              setActiveModelName(models[0].name);
            }
          } else {
            setIsOllamaConnected(false);
          }
        })
        .catch(() => {
          setIsOllamaConnected(false);
        });
    } else {
      setActiveModelName('gemini-2.5-flash');
      setIsOllamaConnected(false);
    }
  }, []);

  const tools = useMemo<ToolSpec[]>(() => [
    {
      name: 'calculate_total_thc',
      description: 'Compute dry-weight total THC and compliance classification.',
      run: async (args) => {
        const response = await authFetch('/api/compliance/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        if (!response.ok) throw new Error('Compliance calculation failed');
        return response.json();
      },
    },
    {
      name: 'search_literature',
      description: 'Search and ingest literature for a given query.',
      run: async (args) => {
        const response = await authFetch('/api/literature/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        if (!response.ok) throw new Error('Literature search failed');
        return response.json();
      },
    },
    {
      name: 'get_cached_literature',
      description: 'Retrieve cached literature entries.',
      run: async () => {
        const response = await authFetch('/api/literature/cache');
        if (!response.ok) throw new Error('Literature cache fetch failed');
        return response.json();
      },
    },
    {
      name: 'get_coas',
      description: 'Fetch tenant COA records for audit or review.',
      run: async () => {
        const response = await authFetch('/api/coas');
        if (!response.ok) throw new Error('COA retrieval failed');
        return response.json();
      },
    },
  ], []);

  const toggleTrace = (traceId?: string) => {
    if (!traceId) return;
    setExpandedTraces((prev) => ({ ...prev, [traceId]: !prev[traceId] }));
  };

  async function runHarnessLoop(params: {
    input: string;
    history: HarnessMessage[];
    provider: 'ollama' | 'gemini';
    model: string;
    endpoint?: string;
    maxSteps?: number;
  }) {
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const maxSteps = params.maxSteps ?? 4;
    const events: HarnessMessage[] = [];
    let step = 0;
    let latestObjective = params.input;

    const push = (msg: HarnessMessage) => {
      events.push(msg);
    };

    while (step < maxSteps) {
      step += 1;

      push({
        id: uid('planner'),
        role: 'planner',
        content: `Planning next action for step ${step}.`,
        timestamp: nowIso(),
        step,
        status: 'running',
        traceId,
      });

      const plannerInput = buildPlannerInput(latestObjective, params.history, events, tools);

      let rawDecision = '';
      try {
        rawDecision = await queryModelDecision({
          provider: params.provider,
          endpoint: params.endpoint,
          model: params.model,
          plannerInput,
          history: [...params.history, ...events],
        });
      } catch (err: any) {
        push({
          id: uid('err'),
          role: 'error',
          content: err?.message || 'Planner request failed.',
          timestamp: nowIso(),
          step,
          status: 'error',
          traceId,
        });
        break;
      }

      const decision = safeJsonParse<PlannerDecision>(rawDecision);

      if (!decision) {
        push({
          id: uid('err'),
          role: 'error',
          content: `Planner returned non-JSON output.`,
          timestamp: nowIso(),
          step,
          status: 'error',
          traceId,
        });
        break;
      }

      push({
        id: uid('plan'),
        role: 'planner',
        content: `${decision.action === 'tool_call' ? `Selected tool ${decision.toolName}` : decision.message} (confidence ${decision.confidence ?? 0})`,
        timestamp: nowIso(),
        step,
        status: 'success',
        traceId,
      });

      if (decision.action === 'ask_clarifying_question') {
        return {
          traceId,
          events,
          final: {
            id: uid('final'),
            role: 'assistant' as const,
            agentType: decision.agentType || 'Orchestrator',
            content: decision.message,
            timestamp: nowIso(),
            status: 'final' as const,
            traceId,
          },
        };
      }

      if (decision.action === 'respond') {
        return {
          traceId,
          events,
          final: {
            id: uid('final'),
            role: 'assistant' as const,
            agentType: decision.agentType || 'Orchestrator',
            content: decision.message,
            timestamp: nowIso(),
            status: 'final' as const,
            traceId,
          },
        };
      }

      if (decision.action === 'tool_call') {
        const tool = tools.find((t) => t.name === decision.toolName);

        if (!tool) {
          push({
            id: uid('err'),
            role: 'error',
            content: `Unknown tool requested: ${decision.toolName}`,
            timestamp: nowIso(),
            step,
            status: 'error',
            traceId,
          });
          continue;
        }

        push({
          id: uid('tool'),
          role: 'tool',
          content: `Running ${tool.name} with ${JSON.stringify(decision.args || {})}`,
          timestamp: nowIso(),
          step,
          status: 'running',
          toolName: tool.name,
          toolArgs: decision.args || {},
          traceId,
        });

        try {
          const result = await tool.run(decision.args || {});
          push({
            id: uid('obs'),
            role: 'observation',
            content: summarizeObservation(tool.name, result),
            timestamp: nowIso(),
            step,
            status: 'success',
            toolName: tool.name,
            toolResult: result,
            traceId,
          });

          latestObjective = `
Original request:
${params.input}

Latest observation from ${tool.name}:
${JSON.stringify(result).slice(0, 6000)}

Now decide the next best action or produce the final answer.
`.trim();

          continue;
        } catch (err: any) {
          push({
            id: uid('err'),
            role: 'error',
            content: err?.message || `Tool ${tool.name} failed.`,
            timestamp: nowIso(),
            step,
            status: 'error',
            toolName: tool.name,
            traceId,
          });
          continue;
        }
      }
    }

    return {
      traceId,
      events,
      final: {
        id: uid('final'),
        role: 'assistant' as const,
        agentType: 'Orchestrator',
        content: 'Step budget reached before a complete finalization. Narrow the request or continue from the current trace.',
        timestamp: nowIso(),
        status: 'final' as const,
        traceId,
      },
    };
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;

    const userMsg: HarnessMessage = {
      id: uid('user'),
      role: 'user',
      content: input,
      timestamp: nowIso(),
    };

    const currentMessages = [...messages, userMsg];
    setMessages(currentMessages);
    setInput('');
    setIsTyping(true);

    const config = getOllamaConfig();

    try {
      const provider: 'ollama' | 'gemini' =
        config.preferredProvider === 'ollama' && isOllamaConnected ? 'ollama' : 'gemini';

      const result = await runHarnessLoop({
        input: userMsg.content,
        history: currentMessages,
        provider,
        model: provider === 'ollama' ? config.model : 'gemini-2.5-flash',
        endpoint: config.endpoint,
        maxSteps: 4,
      });

      setExpandedTraces((prev) => ({ ...prev, [result.traceId]: false }));
      setMessages((prev) => [...prev, ...result.events, result.final]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: uid('err'),
          role: 'error',
          content: 'The harness failed during planning or execution.',
          timestamp: nowIso(),
          status: 'error',
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const suggestions = [
    'Calculate total THC for THCa 0.31 and d9THC 0.02',
    'Audit my latest COAs for high-risk batches',
    'Search literature for THCa stability during curing',
    'Summarize cached literature signals',
  ];

  const groupedMessages = useMemo(() => {
    const traceMap = new Map<string, HarnessMessage[]>();
    const standalone: HarnessMessage[] = [];

    for (const msg of messages) {
      if (msg.traceId) {
        if (!traceMap.has(msg.traceId)) traceMap.set(msg.traceId, []);
        traceMap.get(msg.traceId)!.push(msg);
      } else {
        standalone.push(msg);
      }
    }

    return { traceMap, standalone };
  }, [messages]);

  const renderedIds = new Set<string>();

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-8rem)] flex flex-col pt-8">
      <header className="mb-4 shrink-0 flex flex-col items-center">
        <h2 className="text-2xl font-display font-bold text-white italic tracking-tight">Swarm Orchestrator</h2>
        <p className="text-white/40 font-mono text-xs uppercase tracking-widest mt-1">
          Planner-driven harness for compliance, literature, and model-assisted synthesis.
        </p>

        <div className="mt-4 flex gap-3 items-center font-mono text-[10px] uppercase tracking-wider flex-wrap justify-center">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/40 border border-sky-500/30 text-sky-300">
            <Brain size={12} />
            <span>Harness Mode Active</span>
          </div>

          <div className={`flex items-center gap-1.5 px-3 py-1 bg-black/40 border ${
            engineProvider === 'ollama'
              ? isOllamaConnected
                ? 'border-emerald-500/30 text-emerald-400'
                : 'border-amber-500/30 text-amber-500'
              : 'border-emerald-500/30 text-emerald-400'
          }`}>
            {engineProvider === 'ollama' ? (
              <>
                <Cpu size={12} className={isOllamaConnected ? 'animate-pulse' : ''} />
                <span>Core CPU: {activeModelName} {isOllamaConnected ? isSimulated ? '(SIMULATED)' : '(LOCAL)' : '(OFFLINE)'}</span>
              </>
            ) : (
              <>
                <Cloud size={12} />
                <span>Core Cloud: Gemini</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/40 border border-white/10 text-white/70">
            <Wrench size={12} />
            <span>Tools: {tools.length}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/40 border border-white/10 text-white/70">
            <Eye size={12} />
            <span>Step Budget: 4</span>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 bg-[#0D1411] border border-white/10 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, index) => {
            if (renderedIds.has(msg.id)) return null;

            if (msg.role === 'assistant' && msg.traceId) {
              const traceItems = messages.filter((m) => m.traceId === msg.traceId && m.id !== msg.id);
              traceItems.forEach((t) => renderedIds.add(t.id));
              renderedIds.add(msg.id);

              const expanded = !!expandedTraces[msg.traceId];

              return (
                <div key={msg.id} className="space-y-3">
                  {traceItems.length > 0 && (
                    <button
                      onClick={() => toggleTrace(msg.traceId)}
                      className="w-full flex items-center justify-between border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/[0.07] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {expanded ? <ChevronDown size={16} className="text-white/50" /> : <ChevronRight size={16} className="text-white/50" />}
                        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50">
                          Execution Trace
                        </span>
                        <span className="text-[10px] font-mono text-sky-300">
                          {traceItems.length} events
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-white/40">
                        {msg.traceId}
                      </span>
                    </button>
                  )}

                  {expanded && traceItems.length > 0 && (
                    <div className="space-y-3 border border-white/10 bg-[#0B110F] p-4">
                      {traceItems.map((traceMsg) => (
                        <div key={traceMsg.id} className="flex gap-3 items-start">
                          <div className="mt-1">
                            {traceMsg.role === 'planner' && <Brain size={16} className="text-sky-300" />}
                            {traceMsg.role === 'tool' && <Wrench size={16} className="text-amber-300" />}
                            {traceMsg.role === 'observation' && <Eye size={16} className="text-emerald-300" />}
                            {traceMsg.role === 'error' && <AlertCircle size={16} className="text-red-300" />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <DecisionBadge role={traceMsg.role} />
                              {traceMsg.step !== undefined && (
                                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">
                                  Step {traceMsg.step}
                                </span>
                              )}
                              {traceMsg.toolName && (
                                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-amber-300">
                                  {traceMsg.toolName}
                                </span>
                              )}
                              {traceMsg.status === 'success' && <CheckCircle2 size={12} className="text-emerald-400" />}
                              {traceMsg.status === 'error' && <AlertCircle size={12} className="text-red-400" />}
                            </div>

                            <div className="bg-white/5 border border-white/10 text-sm text-slate-200 p-3 whitespace-pre-wrap break-words">
                              {traceMsg.content}
                            </div>

                            {traceMsg.toolArgs && (
                              <div className="mt-2 bg-[#121A16] border border-amber-500/20 text-[11px] font-mono text-amber-200 p-3 whitespace-pre-wrap break-words">
                                args: {JSON.stringify(traceMsg.toolArgs, null, 2)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-4">
                    <div className="shrink-0 mt-1">
                      <div className="bg-emerald-500/20 p-2 border border-emerald-500/30 rounded-none">
                        <Bot size={18} className="text-emerald-500" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 max-w-[90%]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/70">
                          {msg.agentType || 'Orchestrator'} Agent
                        </span>
                        <DecisionBadge role="assistant" />
                      </div>

                      <div className="p-4 text-sm leading-relaxed rounded-none bg-[#1A221E] border border-white/10 text-slate-200 whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            renderedIds.add(msg.id);

            return (
              <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className="shrink-0 mt-1">
                  {msg.role === 'user' && (
                    <div className="bg-white/10 p-2 rounded-none">
                      <User size={18} className="text-white/60" />
                    </div>
                  )}

                  {(msg.role === 'system' || msg.role === 'error') && (
                    <div className={`p-2 rounded-none border ${
                      msg.role === 'error'
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-white/5 border-white/5'
                    }`}>
                      <AlertCircle size={18} className={msg.role === 'error' ? 'text-red-400' : 'text-white/40'} />
                    </div>
                  )}

                  {msg.role === 'assistant' && (
                    <div className="bg-emerald-500/20 p-2 border border-emerald-500/30 rounded-none">
                      <Bot size={18} className="text-emerald-500" />
                    </div>
                  )}
                </div>

                <div className={`flex flex-col gap-1 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {(msg.role === 'assistant' || msg.role === 'system' || msg.role === 'error') && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/70">
                      {msg.role === 'assistant'
                        ? `${msg.agentType || 'Orchestrator'} Agent`
                        : msg.role === 'error'
                        ? 'Harness Error'
                        : 'System Log'}
                    </span>
                  )}

                  <div className={`p-4 text-sm leading-relaxed rounded-none whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-emerald-500 text-[#0A0F0D] shadow-sm'
                      : msg.role === 'error'
                      ? 'bg-red-500/10 border border-red-500/30 text-red-200'
                      : msg.role === 'system'
                      ? 'bg-white/5 text-white/50 font-mono text-xs border border-white/5 w-full'
                      : 'bg-[#1A221E] border border-white/10 text-slate-200'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })}

          {isTyping && (
            <div className="flex gap-4">
              <div className="bg-emerald-500/20 p-2 border border-emerald-500/30 rounded-none h-9 shrink-0">
                <Bot size={18} className="text-emerald-500" />
              </div>
              <div className="bg-[#1A221E] border border-white/10 p-4 rounded-none flex gap-1.5 items-center">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-none animate-bounce"></div>
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-none animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-none animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="shrink-0 bg-[#0D1411] border-x border-b border-white/10 p-4 sticky bottom-0">
        {messages.length < 5 && (
          <div className="flex gap-2 p-2 mb-2 overflow-x-auto">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => setInput(s)}
                className="shrink-0 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-3 py-1.5 rounded-none transition-colors flex items-center gap-1.5 uppercase"
              >
                <Zap size={12} /> {s}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} className="relative flex items-center border border-white/10 bg-[#1A221E] focus-within:border-emerald-500 transition-colors">
          <input
            type="text"
            placeholder={
              engineProvider === 'ollama'
                ? 'Instruct the harness... e.g. audit my COAs for high-risk compliance'
                : 'Instruct the harness... e.g. calculate total THC for THCa 0.31 and d9THC 0.02'
            }
            className="w-full bg-transparent text-white text-sm focus:outline-none block p-4 pr-12"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-emerald-500 text-[#0A0F0D] rounded-none hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={18} className="ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
