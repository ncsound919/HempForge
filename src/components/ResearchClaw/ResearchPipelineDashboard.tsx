import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Cpu, Download, Loader2, Play, RefreshCw, Square, StopCircle, XCircle,
} from 'lucide-react';
import type { ResearchClawPipelineStartResponse, ResearchClawPipelineStatus, ResearchClawStage } from '../../types/researchclaw';

type DashboardNotification = { message: string; tone: 'info' | 'success' | 'error' };

function StageNode({ stage, active, completed, failed }: {
  stage: ResearchClawStage;
  active: boolean;
  completed: boolean;
  failed: boolean;
}) {
  const icon = failed ? XCircle : completed ? CheckCircle2 : active ? Loader2 : Cpu;
  const Icon = icon;
  const color = failed ? 'text-red-400' : completed ? 'text-emerald-400' : active ? 'text-sky-400' : 'text-slate-500';
  return (
    <div className={`flex items-center gap-3 px-3 py-2 border-l-2 ${active ? 'border-sky-500 bg-sky-500/5' : failed ? 'border-red-500/40 bg-red-500/5' : completed ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/5 bg-black/20'}`}>
      <Icon size={14} className={`shrink-0 ${color} ${active ? 'animate-spin' : ''}`} />
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-mono ${active ? 'text-white' : completed ? 'text-emerald-300' : failed ? 'text-red-300' : 'text-slate-500'}`}>
          {stage.label}
        </div>
        <div className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">{stage.phase}</div>
      </div>
      <div className="text-[9px] font-mono text-slate-600">S{stage.number}</div>
    </div>
  );
}

function NotificationBanner({ notification }: { notification: DashboardNotification | null }) {
  if (!notification) return null;
  const styles = notification.tone === 'success'
    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
    : notification.tone === 'error'
    ? 'bg-red-500/10 text-red-300 border-red-500/20'
    : 'bg-sky-500/10 text-sky-300 border-sky-500/20';
  const Icon = notification.tone === 'success' ? CheckCircle2 : notification.tone === 'error' ? AlertTriangle : Activity;
  return (
    <div className={`border p-3 text-xs font-mono flex items-center gap-2 ${styles}`}>
      <Icon size={14} className="shrink-0" />
      <span>{notification.message}</span>
    </div>
  );
}

export default function ResearchPipelineDashboard() {
  const [stages, setStages] = useState<ResearchClawStage[]>([]);
  const [activeRun, setActiveRun] = useState<ResearchClawPipelineStatus | null>(null);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [booting, setBooting] = useState(true);
  const [starting, setStarting] = useState(false);
  const [notification, setNotification] = useState<DashboardNotification | null>(null);
  const [expanded, setExpanded] = useState(true);
  const notifTimer = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const show = useCallback((message: string, tone: 'info' | 'success' | 'error') => {
    setNotification({ message, tone });
    if (notifTimer.current) window.clearTimeout(notifTimer.current);
    notifTimer.current = window.setTimeout(() => setNotification(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (notifTimer.current) window.clearTimeout(notifTimer.current);
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const fetchStages = useCallback(async () => {
    try {
      const res = await fetch('/api/researchclaw/stages');
      if (res.ok) {
        const data = await res.json();
        setStages(data.stages || []);
      }
    } catch { /* ignore */ }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/researchclaw/pipelines/_active/status');
      if (res.ok) {
        const data: ResearchClawPipelineStatus = await res.json();
        setActiveRun(data);
        if (data.run_id) setPipelineId(data.run_id);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    Promise.all([fetchStages(), pollStatus()]).finally(() => setBooting(false));
  }, [fetchStages, pollStatus]);

  useEffect(() => {
    if (activeRun?.status === 'running') {
      pollRef.current = window.setInterval(pollStatus, 3000);
    } else {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [activeRun?.status, pollStatus]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch('/api/researchclaw/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic || undefined, autoApprove: true }),
      });
      if (!res.ok) throw new Error(`Start failed: ${res.status}`);
      const data: ResearchClawPipelineStartResponse = await res.json();
      setPipelineId(data.run_id);
      setActiveRun({ run_id: data.run_id, status: 'running', output_dir: data.output_dir });
      show(`Pipeline started: ${data.run_id}`, 'success');
    } catch (err: any) {
      show(err.message || 'Failed to start pipeline', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      const res = await fetch('/api/researchclaw/pipelines/_active/stop', { method: 'POST' });
      if (!res.ok) throw new Error(`Stop failed: ${res.status}`);
      show('Pipeline stopped', 'info');
      await pollStatus();
    } catch (err: any) {
      show(err.message || 'Failed to stop pipeline', 'error');
    }
  };

  const highestCompleted = stages.reduce((max, s) => {
    if (activeRun?.stages_done && s.number <= activeRun.stages_done && s.number > max) return s.number;
    return max;
  }, 0);

  if (booting) {
    return (
      <div className="border border-white/5 bg-[#111815] p-8 text-center space-y-3">
        <div className="w-8 h-8 mx-auto border-2 border-emerald-400 border-t-transparent animate-spin" />
        <div className="text-sm text-white">Loading Research Pipeline Dashboard...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      <header className="border-b border-white/10 pb-6 flex flex-col xl:flex-row xl:items-end justify-between gap-5">
        <div className="space-y-2">
          <h2 className="text-3xl font-display font-bold text-white tracking-tight italic">
            ResearchClaw Pipeline
          </h2>
          <p className="text-white/45 font-mono text-xs uppercase tracking-widest max-w-3xl">
            Autonomous 23-stage research pipeline for hemp and cannabinoid science
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`text-[10px] font-mono px-3 py-1.5 border flex items-center gap-1.5 ${activeRun?.status === 'running' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'text-slate-500 border-white/10'}`}>
            <Activity size={12} className={activeRun?.status === 'running' ? 'animate-pulse' : ''} />
            {activeRun?.status === 'running' ? 'PIPELINE ACTIVE' : activeRun?.status === 'completed' ? 'COMPLETED' : activeRun?.status === 'failed' ? 'FAILED' : 'IDLE'}
          </div>
          <button onClick={() => { fetchStages(); pollStatus(); }} className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/70 hover:text-white hover:bg-white/5">
            <RefreshCw size={12} className="inline mr-1" />
            Refresh
          </button>
        </div>
      </header>

      <NotificationBanner notification={notification} />

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 space-y-6">
          <div className="border border-white/5 bg-[#111815] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                Pipeline Controls
              </div>
              <div className="text-xs text-slate-500 font-mono">
                {pipelineId ? `Run: ${pipelineId}` : 'No active run'}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Research topic (optional, defaults to config)"
                className="flex-1 min-w-[200px] px-3 py-2 bg-black/40 border border-white/10 text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40"
              />
              <button
                onClick={handleStart}
                disabled={starting || activeRun?.status === 'running'}
                className="px-4 py-2 bg-emerald-500 text-black text-xs font-mono uppercase tracking-widest font-bold hover:bg-emerald-400 disabled:bg-emerald-800 disabled:text-white/40 flex items-center gap-2"
              >
                {starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                {starting ? 'Starting...' : 'Start Pipeline'}
              </button>
              <button
                onClick={handleStop}
                disabled={activeRun?.status !== 'running'}
                className="px-4 py-2 bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-mono uppercase tracking-widest hover:bg-red-500/30 disabled:opacity-30 flex items-center gap-2"
              >
                <Square size={12} />
                Stop
              </button>
            </div>
          </div>

          <div className="border border-white/5 bg-[#111815] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                Stage Progress
              </div>
              <button onClick={() => setExpanded(!expanded)} className="text-slate-500 hover:text-white">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>
            {activeRun && (
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="border border-white/5 bg-black/20 p-3">
                  <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Stages Done</div>
                  <div className="text-lg font-bold text-white">{activeRun.stages_done || 0}</div>
                </div>
                <div className="border border-white/5 bg-black/20 p-3">
                  <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Stages Failed</div>
                  <div className="text-lg font-bold text-red-400">{activeRun.stages_failed || 0}</div>
                </div>
                <div className="border border-white/5 bg-black/20 p-3">
                  <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Total</div>
                  <div className="text-lg font-bold text-white">{stages.length}</div>
                </div>
              </div>
            )}
            {expanded && (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {stages.map((stage) => (
                  <StageNode
                    key={stage.number}
                    stage={stage}
                    active={activeRun?.status === 'running' && stage.number === (activeRun.stages_done || 0) + 1}
                    completed={stage.number <= highestCompleted}
                    failed={activeRun?.stages_failed ? stage.number > highestCompleted && stage.number <= (activeRun.stages_done || 0) + (activeRun.stages_failed || 0) : false}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="border border-white/5 bg-[#111815] p-5">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400 mb-3">
              Quick Actions
            </div>
            <div className="space-y-2">
              <button
                onClick={() => window.open('/api/researchclaw/pipelines/_active/status', '_blank')}
                disabled={!activeRun?.run_id}
                className="w-full px-3 py-2 text-left border border-white/10 bg-black/20 hover:bg-white/5 text-xs font-mono text-slate-400 hover:text-white disabled:opacity-30 flex items-center gap-2"
              >
                <Cpu size={12} />
                Pipeline Status
              </button>
              <button
                onClick={() => window.open('/api/researchclaw/runs', '_blank')}
                className="w-full px-3 py-2 text-left border border-white/10 bg-black/20 hover:bg-white/5 text-xs font-mono text-slate-400 hover:text-white flex items-center gap-2"
              >
                <Download size={12} />
                All Runs
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
