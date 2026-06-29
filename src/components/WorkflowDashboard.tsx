/**
 * WorkflowDashboard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Enterprise Workflow & ROI Analytics Dashboard for HempForge.
 *
 * Two tabs:
 *   1. Workflow Tracker   — visualises COA batches moving through the 5-stage
 *                           GxP lifecycle with role-gated transition controls.
 *   2. ROI Analytics      — Recharts-powered financial & compliance impact view
 *                           with report generation and download.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Workflow,
  TrendingUp,
  DollarSign,
  Clock,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Plus,
  FileDown,
  RefreshCw,
  Loader2,
  ArrowRight,
  BadgeCheck,
  FlaskConical,
  Truck,
  FileText,
  Microscope,
  Sparkles,
} from "lucide-react";
import { authFetch } from "../lib/firebase";
import { useCOAs } from "../contexts";
import { getCachedUserRole } from "../lib/firebase";
import DataSourceBadge from "./DataSourceBadge";
import { hasPermission, type Permission } from "../lib/permissionsEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StageHistoryEntry {
  stage: string;
  enteredAt: string;
  by?: string;
  byRole?: string;
  notes?: string;
}

interface WorkflowRecord {
  id: string;
  batchId: string;
  strain: string;
  currentStage: string;
  status: "active" | "completed";
  stageHistory: StageHistoryEntry[];
  createdAt: string;
  createdBy?: string;
  createdByRole?: string;
  coaId?: string;
  notes?: string;
}

interface ROIReport {
  metadata: { reportId: string; generatedAt: string; integrityHash: string };
  compliance: {
    totalBatches: number;
    compliant: number;
    atRisk: number;
    nonCompliant: number;
    complianceRate: number;
    averageTotalThc: number;
    highestRiskBatch: any;
  };
  roi: {
    totalCoas: number;
    timeSavedHours: number;
    labourSavingsUsd: number;
    finesAvoidedUsd: number;
    riskPremiumAvoidedUsd: number;
    totalFinancialValueUsd: number;
    roiMultiplier: number;
    nonCompliantCaught: number;
    atRiskCaught: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES = [
  { id: "Intake", label: "Intake", icon: FileText, desc: "COA data received and parsed" },
  { id: "LIMS Verification", label: "LIMS Verify", icon: Microscope, desc: "ISO 17025 lab handshake validated" },
  { id: "Compliance Review", label: "Compliance", icon: ShieldCheck, desc: "THC threshold and formula checked" },
  { id: "Auditor Sign-off", label: "Sign-off", icon: BadgeCheck, desc: "Quality Auditor GxP attestation" },
  { id: "Metrc Synced", label: "Metrc Sync", icon: Truck, desc: "Regulatory sync to state track & trace" },
] as const;

const STATUS_COLOR: Record<string, string> = {
  Compliant: "text-emerald-400",
  "At Risk": "text-amber-400",
  "Non-Compliant": "text-red-400",
};

const PIE_COLORS = ["#34D399", "#F59E0B", "#F87171"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stageIndex(stage: string) {
  return STAGES.findIndex((s) => s.id === stage);
}

function formatUsd(val: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color = "emerald",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: any;
  color?: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    indigo: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    teal: "text-teal-400 bg-teal-500/10 border-teal-500/20",
    red: "text-red-400 bg-red-500/10 border-red-500/20",
  };
  const cls = colorMap[color] || colorMap.emerald;

  return (
    <div className={`border p-5 flex items-start gap-4 ${cls} backdrop-blur-sm`}>
      <div className={`p-2.5 rounded-none border ${cls} shrink-0`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-[11px] font-mono uppercase tracking-widest text-slate-400 mb-1">{label}</p>
        <p className="text-2xl font-bold text-white tracking-tight leading-none">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function StageTrack({ workflow, userRole, onTransition }: {
  workflow: WorkflowRecord;
  userRole: string;
  onTransition: (wf: WorkflowRecord, toStage: string) => void;
}) {
  const current = stageIndex(workflow.currentStage);

  return (
    <div className="bg-[#0D1411] border border-white/10 p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white text-sm">{workflow.batchId}</h3>
          <p className="text-xs text-slate-400">{workflow.strain}</p>
        </div>
        <span
          className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 border ${
            workflow.status === "completed"
              ? "border-emerald-500/30 text-emerald-400 bg-emerald-950/40"
              : "border-amber-500/30 text-amber-400 bg-amber-950/40"
          }`}
        >
          {workflow.status}
        </span>
      </div>

      {/* Stage pipeline */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STAGES.map((stage, idx) => {
          const Icon = stage.icon;
          const done = idx < current;
          const active = idx === current;
          const future = idx > current;

          return (
            <React.Fragment key={stage.id}>
              <div
                className={`flex flex-col items-center gap-1 min-w-[60px] group relative ${future ? "opacity-40" : ""}`}
                title={stage.desc}
              >
                <div
                  className={`w-8 h-8 flex items-center justify-center border transition-all ${
                    done
                      ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                      : active
                      ? "bg-emerald-500 border-emerald-400 text-[#0A0F0D] shadow-[0_0_12px_rgba(52,211,153,0.3)]"
                      : "border-white/10 text-slate-600"
                  }`}
                >
                  {done ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                </div>
                <span className="text-[9px] font-mono text-center leading-tight text-slate-400 max-w-[60px]">
                  {stage.label}
                </span>
              </div>
              {idx < STAGES.length - 1 && (
                <ChevronRight
                  size={12}
                  className={`shrink-0 ${idx < current ? "text-emerald-600" : "text-slate-700"}`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Transition button */}
      {workflow.status === "active" && current < STAGES.length - 1 && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
          <span className="text-[10px] font-mono text-slate-500">
            Next: <span className="text-slate-300">{STAGES[current + 1]?.label}</span>
          </span>
          <button
            onClick={() => onTransition(workflow, STAGES[current + 1].id)}
            disabled={!hasPermission(userRole, "TRANSITION_WORKFLOW" as Permission)}
            className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono uppercase tracking-widest bg-emerald-500 text-[#0A0F0D] font-bold hover:bg-emerald-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={
              hasPermission(userRole, "TRANSITION_WORKFLOW" as Permission)
                ? "Advance to next stage"
                : "Your role does not have permission to transition workflows"
            }
          >
            Advance <ArrowRight size={10} />
          </button>
        </div>
      )}
      {workflow.status === "completed" && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <span className="text-[10px] font-mono text-emerald-500 flex items-center gap-1">
            <CheckCircle2 size={10} /> GxP lifecycle complete
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WorkflowDashboard() {
  const { coas } = useCOAs();
  const userRole = getCachedUserRole();

  const [activeTab, setActiveTab] = useState<"workflows" | "roi">("workflows");
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [wfLoading, setWfLoading] = useState(true);
  const [wfError, setWfError] = useState<string | null>(null);

  const [report, setReport] = useState<ROIReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [newBatchId, setNewBatchId] = useState("");
  const [newStrain, setNewStrain] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  // ─── Fetch Workflows ─────────────────────────────────────────────────────
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchWorkflows = useCallback(async () => {
    setWfLoading(true);
    setWfError(null);
    try {
      const res = await authFetch("/api/workflows");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (isMounted.current) setWorkflows(data.workflows || []);
    } catch (e: any) {
      if (isMounted.current) setWfError(e.message || "Failed to load workflows");
    } finally {
      if (isMounted.current) setWfLoading(false);
    }
  }, []);

  // ─── Fetch/Generate Report ────────────────────────────────────────────────
  const fetchReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const histRes = await authFetch("/api/reports");
      if (histRes.ok) {
        const histData = await histRes.json();
        if (histData.reports?.length > 0) {
          if (isMounted.current) {
            setReport(histData.reports[0] as any);
            setReportLoading(false);
          }
          return;
        }
      }
    } catch {
      /* ignore, fall through to generate */
    }
    try {
      const genRes = await authFetch("/api/reports/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "json" }) });
      if (!genRes.ok) throw new Error(`HTTP ${genRes.status}`);
      const genData = await genRes.json();
      if (isMounted.current) setReport(genData.report);
    } catch (e: any) {
      if (isMounted.current) setReportError(e.message || "Failed to generate report");
    } finally {
      if (isMounted.current) setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
    fetchReport();
  }, [fetchWorkflows, fetchReport]);

  // ─── Create Workflow ──────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newBatchId.trim()) return;
    setCreating(true);
    try {
      const res = await authFetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: newBatchId.trim(), strain: newStrain.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Create failed");
      }
      const data = await res.json();
      setWorkflows((prev) => [data.workflow, ...prev]);
      setNewBatchId("");
      setNewStrain("");
      setShowCreate(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  // ─── Transition Workflow ──────────────────────────────────────────────────
  const handleTransition = async (wf: WorkflowRecord, toStage: string) => {
    setTransitioning(wf.id);
    try {
      const res = await authFetch(`/api/workflows/${wf.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStage }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Transition failed");
      }
      // Optimistic update
      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === wf.id
            ? {
                ...w,
                currentStage: toStage,
                status: toStage === "Metrc Synced" ? "completed" : "active",
                stageHistory: [
                  ...w.stageHistory,
                  { stage: toStage, enteredAt: new Date().toISOString() },
                ],
              }
            : w
        )
      );
    } catch (e: any) {
      alert(e.message);
    } finally {
      setTransitioning(null);
    }
  };

  // ─── Download Report ──────────────────────────────────────────────────────
  const handleDownloadMd = async () => {
    setGenerating(true);
    try {
      const res = await authFetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "markdown" }),
      });
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hempforge-report-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setGenerating(false);
    }
  };

  // ─── ROI Chart data ───────────────────────────────────────────────────────
  const pieData = report
    ? [
        { name: "Compliant", value: report.compliance.compliant },
        { name: "At Risk", value: report.compliance.atRisk },
        { name: "Non-Compliant", value: report.compliance.nonCompliant },
      ].filter((d) => d.value > 0)
    : [];

  const roiBreakdownData = report
    ? [
        { label: "Labour Savings", usd: report.roi.labourSavingsUsd },
        { label: "Fines Avoided", usd: report.roi.finesAvoidedUsd },
        { label: "Risk Premium", usd: report.roi.riskPremiumAvoidedUsd },
      ]
    : [];

  // Cumulative ROI over coa upload dates (sparkline style)
  const cumulativeData = (() => {
    const sorted = [...coas].sort(
      (a, b) => new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime()
    );
    let acc = 0;
    return sorted.map((c) => {
      acc += 12.5; // $12.50 per COA processed
      if (c.status === "Non-Compliant") acc += 10000;
      if (c.status === "At Risk") acc += 2500;
      return {
        date: new Date(c.uploadDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        value: Math.round(acc),
      };
    });
  })();

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <section className="border-b border-white/10 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Workflows & ROI</h1>
            <p className="mt-2 text-sm text-white/50 max-w-2xl">
              Track GxP compliance lifecycle stages and measure the financial impact of automated
              batch intelligence across your operation.
            </p>
          </div>
          <DataSourceBadge classification="production-real" pulse size="md" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-6">
          {[
            { key: "workflows", label: "Workflow Tracker", icon: Workflow },
            { key: "roi", label: "ROI Analytics", icon: TrendingUp },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              id={`workflow-tab-${key}`}
              onClick={() => setActiveTab(key as any)}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-widest transition-colors border-b-2 ${
                activeTab === key
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* ── TAB: WORKFLOW TRACKER ── */}
      {activeTab === "workflows" && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-mono text-slate-500">
              {workflows.length} workflow{workflows.length !== 1 ? "s" : ""} tracked
            </p>
            <div className="flex gap-2">
              <button
                id="workflow-refresh-btn"
                onClick={fetchWorkflows}
                disabled={wfLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-slate-400 text-xs font-mono uppercase tracking-widest hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={12} className={wfLoading ? "animate-spin" : ""} />
                Refresh
              </button>
              {hasPermission(userRole, "CREATE_WORKFLOW" as Permission) && (
                <button
                  id="workflow-create-btn"
                  onClick={() => setShowCreate(!showCreate)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-[#0A0F0D] text-xs font-mono uppercase tracking-widest font-bold hover:bg-emerald-400 transition-colors"
                >
                  <Plus size={12} />
                  New Workflow
                </button>
              )}
            </div>
          </div>

          {/* Create Form */}
          {showCreate && (
            <div className="border border-emerald-500/20 bg-emerald-950/20 p-4 space-y-3">
              <p className="text-xs font-mono text-emerald-400 uppercase tracking-widest">Start New GxP Workflow</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1 block">
                    Batch ID *
                  </label>
                  <input
                    id="workflow-batch-id-input"
                    value={newBatchId}
                    onChange={(e) => setNewBatchId(e.target.value)}
                    placeholder="e.g. B-20240629-001"
                    className="w-full bg-[#0A0F0D] border border-white/10 text-white text-sm px-3 py-2 font-mono focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-1 block">
                    Strain Name
                  </label>
                  <input
                    id="workflow-strain-input"
                    value={newStrain}
                    onChange={(e) => setNewStrain(e.target.value)}
                    placeholder="e.g. Lifter CBD"
                    className="w-full bg-[#0A0F0D] border border-white/10 text-white text-sm px-3 py-2 font-mono focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  id="workflow-create-submit-btn"
                  onClick={handleCreate}
                  disabled={creating || !newBatchId.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-[#0A0F0D] text-xs font-mono uppercase font-bold tracking-widest hover:bg-emerald-400 disabled:opacity-40 transition-colors"
                >
                  {creating && <Loader2 size={12} className="animate-spin" />}
                  Create Workflow
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 border border-white/10 text-slate-400 text-xs font-mono uppercase tracking-widest hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Workflow Error */}
          {wfError && (
            <div className="border border-red-500/30 bg-red-950/20 p-4 text-red-300 text-sm font-mono">
              ⚠ {wfError}
            </div>
          )}

          {/* Workflow Grid */}
          {wfLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
          ) : workflows.length === 0 ? (
            <div className="border border-white/5 bg-white/2 p-12 text-center">
              <Workflow className="w-10 h-10 text-slate-600 mx-auto mb-4" />
              <p className="text-sm text-slate-500 font-mono">No workflows found for your tenant.</p>
              {hasPermission(userRole, "CREATE_WORKFLOW" as Permission) && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono uppercase tracking-widest hover:bg-emerald-500/20 transition-colors"
                >
                  <Plus size={12} /> Create First Workflow
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {workflows.map((wf) => (
                <div key={wf.id} className="relative">
                  {transitioning === wf.id && (
                    <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                    </div>
                  )}
                  <StageTrack
                    workflow={wf}
                    userRole={userRole}
                    onTransition={handleTransition}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: ROI ANALYTICS ── */}
      {activeTab === "roi" && (
        <div className="space-y-6">
          {/* Header actions */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-mono text-slate-500">
                Based on{" "}
                <span className="text-white font-bold">{coas.length}</span> COA batches processed.
              </p>
              {report && (
                <p className="text-[10px] font-mono text-slate-600 mt-0.5">
                  Report sealed:{" "}
                  <code className="text-emerald-700">{report.metadata.integrityHash?.slice(0, 16)}…</code>
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                id="roi-refresh-btn"
                onClick={fetchReport}
                disabled={reportLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-slate-400 text-xs font-mono uppercase tracking-widest hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={12} className={reportLoading ? "animate-spin" : ""} />
                Refresh
              </button>
              {hasPermission(userRole, "GENERATE_REPORT" as Permission) && (
                <button
                  id="roi-download-report-btn"
                  onClick={handleDownloadMd}
                  disabled={generating}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-[#0A0F0D] text-xs font-mono uppercase tracking-widest font-bold hover:bg-emerald-400 transition-colors disabled:opacity-40"
                >
                  {generating ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                  Download Report
                </button>
              )}
            </div>
          </div>

          {reportError && (
            <div className="border border-amber-500/30 bg-amber-950/20 p-4 text-amber-300 text-sm font-mono">
              ⚠ {reportError}
            </div>
          )}

          {reportLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
          ) : report ? (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                  label="Labour Saved"
                  value={`${report.roi.timeSavedHours}h`}
                  sub={`${report.roi.totalCoas} COAs × 15 min automated`}
                  icon={Clock}
                  color="teal"
                />
                <StatCard
                  label="Labour Savings"
                  value={formatUsd(report.roi.labourSavingsUsd)}
                  sub="@ $50/hr blended rate"
                  icon={DollarSign}
                  color="emerald"
                />
                <StatCard
                  label="Fines Avoided"
                  value={formatUsd(report.roi.finesAvoidedUsd)}
                  sub={`${report.roi.nonCompliantCaught} non-compliant batches caught`}
                  icon={ShieldCheck}
                  color="indigo"
                />
                <StatCard
                  label="Total ROI Value"
                  value={formatUsd(report.roi.totalFinancialValueUsd)}
                  sub={`${report.roi.roiMultiplier}× vs. manual baseline`}
                  icon={TrendingUp}
                  color="emerald"
                />
              </div>

              {/* Compliance KPI row */}
              <div className="grid grid-cols-3 gap-4">
                <StatCard label="Compliance Rate" value={`${report.compliance.complianceRate}%`} icon={CheckCircle2} color="emerald" />
                <StatCard label="At Risk Batches" value={report.compliance.atRisk} sub="Caught early" icon={AlertTriangle} color="amber" />
                <StatCard label="Non-Compliant" value={report.compliance.nonCompliant} sub="Diverted before breach" icon={XCircle} color="red" />
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {/* Cumulative ROI area chart */}
                <div className="xl:col-span-2 bg-[#0D1411] border border-white/10 p-5">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-4">
                    Cumulative ROI Value Over Time
                  </h3>
                  {cumulativeData.length > 1 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={cumulativeData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="roiGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#34D399" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#34D399" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1A221E" />
                        <XAxis dataKey="date" tick={{ fill: "#64748B", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#64748B", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ background: "#0D1411", border: "1px solid #334740", borderRadius: 0, fontSize: 11 }}
                          formatter={(val: any) => [formatUsd(val), "Cumulative Value"]}
                        />
                        <Area type="monotone" dataKey="value" stroke="#34D399" strokeWidth={2} fill="url(#roiGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[220px] flex items-center justify-center text-slate-600 text-sm font-mono">
                      Process more batches to see trend data.
                    </div>
                  )}
                </div>

                {/* Compliance Pie */}
                <div className="bg-[#0D1411] border border-white/10 p-5">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-4">
                    Compliance Distribution
                  </h3>
                  {pieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                          {pieData.map((_, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Legend
                          formatter={(val) => <span style={{ color: "#94A3B8", fontSize: 10, fontFamily: "monospace" }}>{val}</span>}
                        />
                        <Tooltip
                          contentStyle={{ background: "#0D1411", border: "1px solid #334740", borderRadius: 0, fontSize: 11 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[220px] flex items-center justify-center text-slate-600 text-sm font-mono">
                      No batch data yet.
                    </div>
                  )}
                </div>
              </div>

              {/* ROI Breakdown bar chart */}
              <div className="bg-[#0D1411] border border-white/10 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">
                    Financial Value Breakdown
                  </h3>
                  <DataSourceBadge classification="formula-computed" size="sm" />
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={roiBreakdownData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1A221E" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#64748B", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#64748B", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "#0D1411", border: "1px solid #334740", borderRadius: 0, fontSize: 11 }}
                      formatter={(val: any) => [formatUsd(val), "Value"]}
                    />
                    <Bar dataKey="usd" fill="#10B981" radius={[0, 0, 0, 0]} maxBarSize={80} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Report Integrity Card */}
              <div className="border border-indigo-500/20 bg-indigo-950/10 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-indigo-400 mb-1">
                      ALCOA++ Report Seal
                    </p>
                    <p className="text-xs text-slate-400 font-mono">
                      ID: <span className="text-white">{report.metadata.reportId}</span>
                    </p>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      Generated: {formatDate(report.metadata.generatedAt)}
                    </p>
                    <p className="text-[10px] text-slate-600 font-mono mt-1 break-all">
                      HMAC-SHA256: {report.metadata.integrityHash}
                    </p>
                  </div>
                  <DataSourceBadge classification="production-real" size="sm" />
                </div>
              </div>
            </>
          ) : (
            <div className="border border-white/5 bg-white/2 p-12 text-center">
              <Sparkles className="w-10 h-10 text-slate-600 mx-auto mb-4" />
              <p className="text-sm text-slate-500 font-mono">No report available yet.</p>
              <p className="text-xs text-slate-600 font-mono mt-1">Ingest COA batches to populate ROI analytics.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
