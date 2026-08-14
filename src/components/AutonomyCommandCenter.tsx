import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { authFetch } from '../lib/firebase';
import {
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Clock,
  Layers,
  Database,
  Beaker,
  FileText,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  Calendar,
  RefreshCw,
  Leaf,
  Factory,
  Sprout,
  SproutIcon,
  Radio,
} from 'lucide-react';

interface SkillInfo {
  id: string;
  phase: string;
  description: string;
}

interface SkillStat {
  lastRunAt: string;
  lastStatus: string;
  totalRuns: number;
  avgDurationMs: number;
  lastSummary: string;
}

interface CycleReport {
  cycleId: string;
  tenantId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: string;
  totals: {
    papersIngested: number;
    compoundsTagged: number;
    simulationsRun: number;
    reportsGenerated: number;
    risksScored: number;
    experimentsQueued: number;
    experimentsBenchmarked: number;
    flyersPublished: number;
    knowledgePromoted: number;
  };
  stepCount?: number;
}

interface StatusResponse {
  tenantId: string;
  lastCycle: CycleReport | null;
  totalCycles: number;
  skills: SkillInfo[];
  skillStats: Record<string, SkillStat>;
  frontiers: {
    benchmarked: Record<string, number>;
    queued: Record<string, number>;
    coveredFrontiers: string[];
  };
  pipeline: Record<string, string>;
  mode: string;
}

interface StepResult {
  skillId: string;
  phase: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: string;
  written: Record<string, number>;
}

interface CycleResponse {
  cycleId: string;
  tenantId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: string;
  stepCount?: number;
  totals: CycleReport['totals'];
}

const PHASE_COLORS: Record<string, string> = {
  ingest: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40',
  analyze: 'bg-violet-900/40 text-violet-300 border-violet-700/40',
  simulate: 'bg-amber-900/40 text-amber-300 border-amber-700/40',
  score: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  report: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40',
  verify: 'bg-blue-900/40 text-blue-300 border-blue-700/40',
  experiment: 'bg-pink-900/40 text-pink-300 border-pink-700/40',
  benchmark: 'bg-rose-900/40 text-rose-300 border-rose-700/40',
  publish: 'bg-amber-900/40 text-amber-300 border-amber-700/40',
  promote: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/40',
};

const SKILL_ICONS: Record<string, any> = {
  'ingest-literature': Database,
  'analyze-papers': Activity,
  'run-simulations': Beaker,
  'score-risk': ShieldCheck,
  'generate-reports': FileText,
  'verify-audit-chain': ShieldCheck,
  'queue-experiments': Sparkles,
  'benchmark-experiments': Beaker,
  'publish-artifacts': FileText,
  'promote-knowledge-base': Sparkles,
};

export default function AutonomyCommandCenter() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastCycle, setLastCycle] = useState<CycleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/autonomy/status');
      if (!res.ok) throw new Error(`Status failed: ${res.status}`);
      const data = await res.json();
      setStatus(data);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    if (!autoRefresh) return;
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, [load, autoRefresh]);

  const runFullCycle = async () => {
    setRunning('cycle');
    setLastCycle(null);
    try {
      const res = await authFetch('/api/autonomy/run', { method: 'POST' });
      if (!res.ok) throw new Error(`Cycle failed: ${res.status}`);
      const data = await res.json();
      setLastCycle(data);
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRunning(null);
    }
  };

  const runSingleSkill = async (skillId: string) => {
    setRunning(skillId);
    try {
      const res = await authFetch('/api/autonomy/run-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId }),
      });
      if (!res.ok) throw new Error(`Skill failed: ${res.status}`);
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRunning(null);
    }
  };

  const totals = lastCycle?.totals ?? status?.lastCycle?.totals;
  const totalActions =
    (totals?.papersIngested ?? 0) +
    (totals?.simulationsRun ?? 0) +
    (totals?.risksScored ?? 0) +
    (totals?.experimentsQueued ?? 0) +
    (totals?.experimentsBenchmarked ?? 0) +
    (totals?.reportsGenerated ?? 0) +
    (totals?.flyersPublished ?? 0) +
    (totals?.knowledgePromoted ?? 0);

  const pipeline = useMemo(() => status?.pipeline ?? {}, [status]);

  return (
    <>
      {error && !status && (
        <div className="p-8 text-slate-300 flex items-center gap-3 flex-col">
          <AlertTriangle className="text-red-400" size={18} />
          <span>Failed to load autonomy state</span>
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-medium rounded text-sm"
          >
            Retry
          </button>
        </div>
      )}

      {status ? null : (
        <div className="p-8 text-slate-300 flex items-center gap-3">
          <Loader2 className="animate-spin text-emerald-400" size={18} />
          Loading autonomy state…
        </div>
      )}

      {status && (
    <div className="p-8 space-y-6 text-slate-300">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="text-emerald-400" size={22} />
            Autonomy Command Center
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            Deterministic research factory. Six skills wired to ten scheduled cron jobs.
            No LLM. Every action is reproducible from inputs.
            <span className="block text-xs text-slate-500 mt-1">
              Mode: <span className="text-emerald-400">{status.mode}</span> · Tenant: {status.tenantId}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`px-3 py-2 rounded text-xs uppercase tracking-wider border transition-colors ${
              autoRefresh
                ? 'border-emerald-500/50 text-emerald-300 bg-emerald-900/20'
                : 'border-white/10 text-slate-400 hover:border-white/20'
            }`}
          >
            <RefreshCw size={12} className={`inline mr-1 ${autoRefresh ? 'animate-spin' : ''}`} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={() => void load()}
            className="px-3 py-2 rounded text-xs uppercase tracking-wider border border-white/10 text-slate-300 hover:border-white/20"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* ─── Run Platform Autonomy (primary action) ─────────────────────────── */}
      <section className="bg-gradient-to-br from-emerald-900/30 via-[#0d1411] to-cyan-900/20 border border-emerald-500/30 rounded-lg p-6">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-widest text-emerald-400 font-bold flex items-center gap-2">
              <Sparkles size={14} /> Research Factory
            </div>
            <div className="text-3xl font-bold text-white mt-2">Run Platform Autonomy</div>
            <p className="text-sm text-slate-400 mt-1 max-w-xl">
              Triggers every registered skill in order: ingest literature, analyze compounds,
              run kinetics simulations, score risk, generate reports, verify audit chain,
              queue & benchmark experiments, publish signed paper + flyer.
            </p>
          </div>

          <button
            onClick={runFullCycle}
            disabled={running !== null}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-[#0A0F0D] font-bold px-8 py-4 rounded text-lg flex items-center gap-2 shadow-lg shadow-emerald-500/20"
          >
            {running === 'cycle' ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} fill="currentColor" />}
            {running === 'cycle' ? 'Running cycle…' : 'Run Now'}
          </button>
        </div>

        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <TotalCard label="Papers ingested" value={totals.papersIngested} icon={Database} />
            <TotalCard label="Simulations run" value={totals.simulationsRun} icon={Beaker} />
            <TotalCard label="Risks scored" value={totals.risksScored} icon={ShieldCheck} />
            <TotalCard label="Experiments queued" value={totals.experimentsQueued} icon={Sparkles} />
            <TotalCard label="Benchmarks" value={totals.experimentsBenchmarked} icon={Beaker} />
            <TotalCard label="Reports generated" value={totals.reportsGenerated} icon={FileText} />
            <TotalCard label="Flyers published" value={totals.flyersPublished} icon={FileText} />
            <TotalCard label="Knowledge promoted" value={totals.knowledgePromoted} icon={Sparkles} />
          </div>
        )}
      </section>

      {/* ─── Skills (per-skill run + last-run stats) ──────────────────────────── */}
      <section className="bg-white/5 border border-white/10 rounded p-4">
        <h3 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-3 flex items-center gap-2">
          <Activity size={14} /> Skills ({status.skills.length})
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {status.skills.map((skill) => {
            const Icon = SKILL_ICONS[skill.id] ?? Sparkles;
            const stat = status.skillStats[skill.id];
            const phaseClass = PHASE_COLORS[skill.phase] ?? 'bg-white/5 border-white/10 text-slate-300';
            const isRunning = running === skill.id;
            return (
              <div key={skill.id} className="bg-black/30 border border-white/10 rounded p-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <div className={`p-1.5 rounded border ${phaseClass}`}>
                    <Icon size={12} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{skill.id}</div>
                    <div className="text-[11px] text-slate-400 leading-relaxed">{skill.description}</div>
                  </div>
                  <button
                    onClick={() => runSingleSkill(skill.id)}
                    disabled={isRunning || running !== null}
                    className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-[11px] font-bold px-2 py-1 rounded flex items-center gap-1"
                  >
                    {isRunning ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} fill="currentColor" />}
                    Run
                  </button>
                </div>
                {stat && (
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 border-t border-white/5 pt-2">
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      Last: {new Date(stat.lastRunAt).toLocaleTimeString()}
                    </span>
                    <span>{stat.totalRuns} runs</span>
                    <span>~{Math.round(stat.avgDurationMs)}ms avg</span>
                    <span className="ml-auto">
                      {stat.lastStatus === 'ok' ? (
                        <CheckCircle2 size={10} className="inline text-emerald-400" />
                      ) : (
                        <AlertTriangle size={10} className="inline text-amber-400" />
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Cron schedule ─────────────────────────────────────────────────── */}
      <section className="bg-white/5 border border-white/10 rounded p-4">
        <h3 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-3 flex items-center gap-2">
          <Calendar size={14} /> Cron Schedule
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {Object.entries(pipeline).map(([k, v]) => (
            <div key={k} className="bg-black/30 border border-white/10 rounded px-3 py-2 flex items-center gap-2">
              <span className="text-slate-500 font-mono">{k.replace(/([A-Z])/g, ' $1').trim()}</span>
              <span className="ml-auto text-emerald-300 font-mono">{v as string}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Frontier coverage ─────────────────────────────────────────────── */}
      <section className="bg-white/5 border border-white/10 rounded p-4">
        <h3 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-3 flex items-center gap-2">
          <Sprout size={14} /> Research Frontiers
        </h3>
        <p className="text-[11px] text-slate-400 mb-3">
          HempForge organizes experiments around five concrete research frontiers where the science and market demand are active but evidence is fragmented.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          {[
            { id: "minorCannabinoids", label: "Minor Cannabinoids", icon: Beaker, desc: "THCV · CBG · CBN · CBC · CBDV" },
            { id: "fiberIndustrial", label: "Fiber & Industrial", icon: Factory, desc: "bast · hurd · composites" },
            { id: "regenerative", label: "Regenerative", icon: Sprout, desc: "soil C · rotation" },
            { id: "organicProduction", label: "Organic Production", icon: Leaf, desc: "OMRI · IPM" },
            { id: "precisionSensing", label: "Precision Sensing", icon: Radio, desc: "mold · pollen · spectral" },
          ].map((f) => {
            const Icon = f.icon;
            const q = status.frontiers?.queued?.[f.id] ?? 0;
            const b = status.frontiers?.benchmarked?.[f.id] ?? 0;
            return (
              <div key={f.id} className="bg-black/30 border border-white/10 rounded p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={14} className="text-emerald-400" />
                  <div className="text-sm text-white font-medium truncate">{f.label}</div>
                </div>
                <div className="text-[10px] text-slate-500 mb-2">{f.desc}</div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">queued</span>
                  <span className="text-amber-300 font-mono font-bold">{q}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">benchmarked</span>
                  <span className="text-emerald-300 font-mono font-bold">{b}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Last cycle details ─────────────────────────────────────────────── */}
      {lastCycle && (
        <section className="bg-white/5 border border-emerald-700/30 rounded p-4">
          <h3 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-3 flex items-center gap-2">
            <CheckCircle2 size={14} /> Last Cycle: {lastCycle.cycleId}
          </h3>
          <div className="text-[11px] text-slate-400 mb-3">
            {new Date(lastCycle.startedAt).toLocaleString()} → {new Date(lastCycle.finishedAt).toLocaleString()} · {lastCycle.durationMs}ms · {(lastCycle as any).steps?.length ?? lastCycle.stepCount ?? "?"} steps
          </div>
          {(lastCycle as any).steps && (
            <div className="space-y-1">
              {((lastCycle as any).steps as StepResult[]).map((s, i) => (
                <div key={i} className="bg-black/30 border border-white/10 rounded px-3 py-2 text-xs flex items-center gap-2">
                  {s.status === 'ok' ? (
                    <CheckCircle2 size={12} className="text-emerald-400" />
                  ) : s.status === 'warn' ? (
                    <AlertTriangle size={12} className="text-amber-400" />
                  ) : (
                    <AlertTriangle size={12} className="text-red-400" />
                  )}
                  <span className="text-white font-medium">{s.skillId}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-300 flex-1 truncate">{s.summary}</span>
                  <span className="text-slate-500 font-mono">{s.durationMs}ms</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ─── Last cycle summary (from status) ─────────────────────────────── */}
      {status.lastCycle && !lastCycle && (
        <section className="bg-white/5 border border-white/10 rounded p-4">
          <h3 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-3 flex items-center gap-2">
            <Clock size={14} /> Last Cycle (auto-refresh)
          </h3>
          <div className="text-xs text-slate-400">
            {status.lastCycle.cycleId} · {status.lastCycle.durationMs}ms · status <span className={status.lastCycle.status === 'ok' ? 'text-emerald-400' : 'text-amber-400'}>{status.lastCycle.status}</span>
            <span className="block text-[10px] text-slate-500 mt-1">
              {new Date(status.lastCycle.startedAt).toLocaleString()}
            </span>
          </div>
        </section>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700/40 rounded p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {totalActions === 0 && (
        <div className="text-center text-xs text-slate-500 italic py-4">
          No actions yet. Click "Run Now" to execute a full autonomous cycle.
        </div>
      )}
    </div>
    )}
    </>
  );
}

function TotalCard({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="bg-black/40 border border-white/10 rounded p-3">
      <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider">
        <Icon size={11} />
        {label}
      </div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}