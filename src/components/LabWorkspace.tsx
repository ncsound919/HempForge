import React, { useState, useEffect } from 'react';
import { Bot, Database, BarChart2, FileText, Activity, Zap, Server } from 'lucide-react';
import { authFetch } from '../lib/firebase';
import { AuditLog, CsaValidationRun } from '../types';

export default function LabWorkspace() {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [csaRuns, setCsaRuns] = useState<CsaValidationRun[]>([]);
  const [literatureCount, setLiteratureCount] = useState<number>(0);
  const [loading, setLoading] = useState({ logs: true, runs: true, lit: true });

  useEffect(() => {
    async function fetchData() {
      try {
        const [logsRes, runsRes, litRes] = await Promise.all([
          authFetch('/api/audit/logs'),
          authFetch('/api/csa/runs'),
          authFetch('/api/literature/cache')
        ]);
        
        if (logsRes.ok) {
          const data = await logsRes.json();
          setAuditLogs(data.slice(0, 5));
        }
        
        if (runsRes.ok) {
          const data = await runsRes.json();
          setCsaRuns(data.slice(0, 3));
        }
        
        if (litRes.ok) {
          const data = await litRes.json();
          setLiteratureCount(data.papers?.length || 0);
        }
      } catch (err) {
        console.error("Failed to fetch workspace data", err);
      } finally {
        setLoading({ logs: false, runs: false, lit: false });
      }
    }
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0A0F0D] text-white p-6">
      <header className="mb-6 flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h2 className="text-2xl font-display font-bold italic tracking-tight">Scientific Agentic Workspace</h2>
          <p className="text-white/40 font-mono text-xs uppercase tracking-widest mt-1">Multi-Agent Swarm for Hemp Regulatory Compliance</p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="bg-[#1A221E] px-3 py-1.5 border border-white/10 flex items-center gap-2 text-xs font-mono">
            <span className="w-2 h-2 rounded-none bg-emerald-500 animate-pulse"></span>
            SWARM ONLINE
          </div>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Knowledge Agent */}
        <div className="bg-[#0D1411] border border-white/10 flex flex-col">
          <div className="p-4 border-b border-white/10 bg-[#121A16] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-blue-400" />
              <h3 className="font-mono text-sm uppercase tracking-widest font-bold text-blue-400">Knowledge Agent</h3>
            </div>
            <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 border border-blue-500/20">INDEXING</span>
          </div>
          <div className="p-4 flex-1 flex flex-col gap-4 font-mono text-xs text-slate-300">
            <div className="bg-[#1A221E] p-3 border border-white/5">
              <p className="text-blue-400 mb-1">&gt; Current Status:</p>
              <p>Monitoring local literature cache for new insights</p>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {loading.lit ? (
                 <div className="text-white/50">Checking indices...</div>
              ) : (
                <>
                  <div className="text-emerald-400">Cache synced with {literatureCount} papers.</div>
                  <div className="text-white/50">Ready for advanced query extraction.</div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Analysis Agent */}
        <div className="bg-[#0D1411] border border-white/10 flex flex-col border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.05)]">
          <div className="p-4 border-b border-white/10 bg-[#121A16] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart2 size={16} className="text-emerald-400" />
              <h3 className="font-mono text-sm uppercase tracking-widest font-bold text-emerald-400">Analysis Agent</h3>
            </div>
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 border border-emerald-500/20 flex items-center gap-1">
              <Activity size={10} className="animate-pulse" /> ACTIVE
            </span>
          </div>
          <div className="p-4 flex-1 flex flex-col gap-4 font-mono text-xs text-slate-300">
            <div className="bg-[#1A221E] p-3 border border-emerald-500/20 text-emerald-50">
              <p className="text-emerald-400 mb-1">&gt; Recent Validation Runs:</p>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {loading.runs ? (
                <div className="text-white/50">Fetching recent runs...</div>
              ) : csaRuns.length > 0 ? (
                csaRuns.map(run => (
                  <div key={run.runId} className="border-b border-white/5 pb-2">
                    <div className="flex justify-between">
                      <span className="text-white">Run ID:</span> <span className="text-white/70">{run.runId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white">Status:</span> <span className={run.status === "VALIDATED" ? "text-emerald-400" : "text-amber-400"}>{run.status}</span>
                    </div>
                    <div className="text-white/50 text-[10px] mt-1">{new Date(run.validatedAt).toLocaleString()}</div>
                  </div>
                ))
              ) : (
                <div className="text-white/50">No recent validation runs.</div>
              )}
            </div>
          </div>
        </div>

        {/* Reporting Agent */}
        <div className="bg-[#0D1411] border border-white/10 flex flex-col">
          <div className="p-4 border-b border-white/10 bg-[#121A16] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-amber-400" />
              <h3 className="font-mono text-sm uppercase tracking-widest font-bold text-amber-400">Reporting Agent</h3>
            </div>
            <span className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 border border-amber-500/20">DRAFTING</span>
          </div>
          <div className="p-4 flex-1 flex flex-col gap-4 font-mono text-xs text-slate-300">
            <div className="bg-[#1A221E] p-3 border border-white/5">
              <p className="text-amber-400 mb-1">&gt; Current Task:</p>
              <p>Drafting GxP Compliance Report & ALCOA++ Logs</p>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {loading.logs ? (
                <div className="text-white/50">Fetching recent reporting activity...</div>
              ) : auditLogs.length > 0 ? (
                auditLogs.map(log => (
                  <div key={log.id} className="text-white/70 border-b border-white/5 pb-1">
                    <span className="text-white/40">[{new Date(log.timestamp).toLocaleTimeString()}]</span> {log.action} - {log.details}
                  </div>
                ))
              ) : (
                <div className="text-white/50">No recent reporting activity found.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
