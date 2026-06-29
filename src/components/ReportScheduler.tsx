import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  Info,
  Play,
  Plus,
  Send,
  Sliders,
  Sparkles,
  Trash2,
  } from 'lucide-react';

import { authFetch } from '../lib/firebase';

type CronFrequency = 'Daily' | 'Weekly' | 'Monthly' | 'Regulatory Trigger';
type CronStatus = 'active' | 'paused';
type DispatchResult = 'success' | 'warning' | 'failed';

interface CronJob {
  id: string;
  name: string;
  cronString: string;
  frequency: CronFrequency;
  targetEmail: string;
  targetFocus: string;
  status: CronStatus;
  lastRun: string | null;
  nextRunHint: string;
  createdAt: string;
  lastResult?: DispatchResult;
}

interface NotificationState {
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface BriefingPreview {
  jobId: string;
  title: string;
  payload: string;
  generatedAt: string;
}

const DEFAULT_EMAIL =
  ((import.meta as { env?: Record<string, string> }).env?.VITE_ADMIN_EMAIL || '').trim() ||
  'ops@hempforge.lan';

const FOCUS_OPTIONS = [
  'Total-THC Compliance',
  'Decarb Outliers',
  'Harvest Moisture Variance',
  'Entourage Infusions',
  'Packaging Claims Review',
  'Research Integrity Digest',
] as const;

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidCronExpression(expression: string) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const tokenPattern = /^(\*|\*\/\d+|\d+|\d+-\d+|\d+(,\d+)*)$/;

  return parts.every((part) => tokenPattern.test(part));
}

function getHumanFrequencyHint(cronString: string, frequency: CronFrequency) {
  const [minute = '*', hour = '*', dayOfMonth = '*', month = '*', dayOfWeek = '*'] =
    cronString.trim().split(/\s+/);

  const hourText =
    hour === '*'
      ? 'every hour'
      : `${String(hour).padStart(2, '0')}:${String(minute === '*' ? '00' : minute).padStart(2, '0')}`;

  if (frequency === 'Daily') {
    return hour === '*'
      ? 'Runs on a daily repeating schedule'
      : `Every day at ${hourText}`;
  }

  if (frequency === 'Weekly') {
    return dayOfWeek === '*'
      ? `Weekly schedule near ${hourText}`
      : `Weekly on day ${dayOfWeek} at ${hourText}`;
  }

  if (frequency === 'Monthly') {
    return dayOfMonth === '*'
      ? `Monthly schedule near ${hourText}`
      : `Day ${dayOfMonth} of each month at ${hourText}`;
  }

  return `Trigger-watch cadence ${cronString} (event-driven polling)`;
}

function formatDateTimeForDisplay(value: string | null) {
  if (!value) return 'Never';
  return value.replace('T', ' ').slice(0, 16);
}

function buildSyntheticBrief(job: CronJob) {
  const inventoryChecked = Math.floor(Math.random() * 10) + 8;
  const meanPotentialThc = (Math.random() * 0.12 + 0.11).toFixed(3);
  const driftIndex = (Math.random() * 4.2 + 0.8).toFixed(2);
  const successRoll = Math.random();

  const dispatchResult: DispatchResult =
    successRoll > 0.82 ? 'failed' : successRoll > 0.18 ? 'success' : 'warning';

  const complianceFlag =
    dispatchResult === 'failed'
      ? 'INSUFFICIENT DATA'
      : Math.random() > 0.2
      ? 'COMPLIANT'
      : 'AT-RISK';

  const advisory =
    dispatchResult === 'failed'
      ? 'Dispatch halted. Review upstream data availability and rerun after dataset validation.'
      : dispatchResult === 'warning'
      ? 'Review flagged variance before relying on this briefing for external decision-making.'
      : 'All monitored signals are within expected tolerance. No urgent remediation workflow triggered.';

  const payload = `========================================================================
HEMPFORGE RESEARCH BRIEFING
========================================================================
JOB NAME: ${job.name.toUpperCase()}
GENERATED: ${new Date().toLocaleString()}
TRACKING ID: RPT-${job.id.slice(-6).toUpperCase()}
RECIPIENT: ${job.targetEmail}
FOCUS DOMAIN: ${job.targetFocus}
EXECUTION MODE: ${job.frequency}
CRON STRING: ${job.cronString}

SYSTEM SUMMARY
- Inventory batches scanned: ${inventoryChecked}
- Mean potential THC: ${meanPotentialThc}% dry weight
- Drift index: ${driftIndex}
- Compliance signal: ${complianceFlag}
- Dispatch result: ${dispatchResult.toUpperCase()}

ANALYST NOTES
- Data pulled from governed briefing configuration.
- Focus-specific checks executed against the scheduler simulation layer.
- Follow-up should be logged if result is AT-RISK or INSUFFICIENT DATA.

ADVISORY
${advisory}

========================================================================
MAIL TRANSPORT
Status: ${dispatchResult === 'failed' ? 'Dispatch blocked' : 'Dispatch successful'}
========================================================================`;

  return { dispatchResult, payload };
}

async function fetchJobs(): Promise<CronJob[]> {
  try {
    const res = await authFetch('/api/scheduler/jobs');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    return [];
  }
}

async function createJob(job: Omit<CronJob, 'id'>): Promise<CronJob | null> {
  try {
    const res = await authFetch('/api/scheduler/jobs', {
      method: 'POST',
      body: JSON.stringify(job),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.job || null;
  } catch {
    return null;
  }
}

async function updateJob(id: string, updates: Partial<CronJob>): Promise<boolean> {
  try {
    const res = await authFetch(`/api/scheduler/jobs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteJob(id: string): Promise<boolean> {
  try {
    const res = await authFetch(`/api/scheduler/jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default function ReportScheduler() {
  const [crons, setCrons] = useState<CronJob[]>([]);
  const [currentViewBriefing, setCurrentViewBriefing] = useState<BriefingPreview | null>(null);

  const [newJobName, setNewJobName] = useState('');
  const [newCronString, setNewCronString] = useState('0 9 * * *');
  const [newFrequency, setNewFrequency] = useState<CronFrequency>('Daily');
  const [newTargetEmail, setNewTargetEmail] = useState<string>(DEFAULT_EMAIL);
  const [newTargetFocus, setNewTargetFocus] = useState<string>('Total-THC Compliance');

  const [executingJobId, setExecutingJobId] = useState<string | null>(null);
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | CronStatus>('all');

  const loadJobs = useCallback(async () => {
    const jobs = await fetchJobs();
    setCrons(jobs);
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  const showToastNotification = (
    message: string,
    tone: NotificationState['tone'] = 'success'
  ) => {
    setNotification({ message, tone });
  };

  const filteredCrons = useMemo(() => {
    if (filter === 'all') return crons;
    return crons.filter((job) => job.status === filter);
  }, [crons, filter]);

  const stats = useMemo(() => {
    const active = crons.filter((job) => job.status === 'active').length;
    const paused = crons.filter((job) => job.status === 'paused').length;
    const warning = crons.filter((job) => job.lastResult === 'warning').length;
    const failed = crons.filter((job) => job.lastResult === 'failed').length;

    return {
      total: crons.length,
      active,
      paused,
      warning,
      failed,
    };
  }, [crons]);

  const handleToggleCron = async (id: string) => {
    const target = crons.find((j) => j.id === id);
    if (!target) return;

    const newStatus: CronStatus = target.status === 'active' ? 'paused' : 'active';
    const ok = await updateJob(id, { status: newStatus });
    if (ok) {
      setCrons((prev) =>
        prev.map((job) =>
          job.id === id ? { ...job, status: newStatus } : job
        )
      );
    }

    showToastNotification('Scheduler state updated.', 'info');
  };

  const resetForm = () => {
    setNewJobName('');
    setNewCronString('0 9 * * *');
    setNewFrequency('Daily');
    setNewTargetEmail(DEFAULT_EMAIL);
    setNewTargetFocus('Total-THC Compliance');
    setFormError(null);
  };

  const handleAddCron = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = newJobName.trim();
    const trimmedCron = newCronString.trim();
    const trimmedEmail = newTargetEmail.trim();

    if (!trimmedName) {
      setFormError('A job title is required.');
      return;
    }

    if (!isValidCronExpression(trimmedCron)) {
      setFormError('Cron expression must use standard 5-field UNIX format.');
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setFormError('Enter a valid destination email address.');
      return;
    }

    const duplicate = crons.some(
      (job) => job.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicate) {
      setFormError('A job with this title already exists.');
      return;
    }

    const newJobData = {
      name: trimmedName,
      cronString: trimmedCron,
      frequency: newFrequency,
      targetEmail: trimmedEmail,
      targetFocus: newTargetFocus,
      status: 'active' as CronStatus,
      lastRun: null,
      nextRunHint: getHumanFrequencyHint(trimmedCron, newFrequency),
      createdAt: new Date().toISOString(),
      lastResult: undefined as DispatchResult | undefined,
    };

    const created = await createJob(newJobData);
    if (created) {
      setCrons((prev) => [created, ...prev]);
    }
    resetForm();
    showToastNotification(`Registered schedule: "${newJobData.name}"`, 'success');
  };

  const handleDeleteCron = async (id: string) => {
    const ok = await deleteJob(id);
    if (ok) {
      setCrons((prev) => prev.filter((job) => job.id !== id));
    }

    if (currentViewBriefing?.jobId === id) {
      setCurrentViewBriefing(null);
    }

    showToastNotification('Scheduler definition removed.', 'info');
  };

  const handleTriggerReportNow = (job: CronJob) => {
    setExecutingJobId(job.id);

    window.setTimeout(async () => {
      const { dispatchResult, payload } = buildSyntheticBrief(job);
      const now = new Date().toISOString();

      await updateJob(job.id, {
        lastRun: now,
        lastResult: dispatchResult,
      });

      setCrons((prev) =>
        prev.map((item) =>
          item.id === job.id
            ? {
                ...item,
                lastRun: now,
                lastResult: dispatchResult,
              }
            : item
        )
      );

      setCurrentViewBriefing({
        jobId: job.id,
        title: job.name,
        payload,
        generatedAt: now,
      });

      setExecutingJobId(null);

      if (dispatchResult === 'failed') {
        showToastNotification(`Dispatch failed for "${job.name}".`, 'error');
      } else if (dispatchResult === 'warning') {
        showToastNotification(`Dispatch completed with warnings for "${job.name}".`, 'info');
      } else {
        showToastNotification(`Dispatch successful to ${job.targetEmail}.`, 'success');
      }
    }, 1200);
  };

  const notificationStyles =
    notification?.tone === 'error'
      ? 'bg-red-500/10 text-red-300 border-red-500/20'
      : notification?.tone === 'info'
      ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';

  return (
    <div id="report-scheduler-section" className="space-y-6">
      {notification && (
        <div
          className={`border p-3 text-xs font-mono flex items-center gap-2 animate-in fade-in slide-in-from-top-4 ${notificationStyles}`}
        >
          {notification.tone === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {notification.message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#0D1411] border border-white/10 p-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
            Total Jobs
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{stats.total}</div>
          <div className="mt-1 text-xs text-white/45">Configured scheduler definitions.</div>
        </div>

        <div className="bg-[#0D1411] border border-emerald-500/20 p-4">
          <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-mono">
            Active
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{stats.active}</div>
          <div className="mt-1 text-xs text-white/45">Currently eligible to dispatch.</div>
        </div>

        <div className="bg-[#0D1411] border border-amber-500/20 p-4">
          <div className="text-[10px] uppercase tracking-widest text-amber-400 font-mono">
            Paused
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{stats.paused}</div>
          <div className="mt-1 text-xs text-white/45">Retained but not currently running.</div>
        </div>

        <div className="bg-[#0D1411] border border-sky-500/20 p-4">
          <div className="text-[10px] uppercase tracking-widest text-sky-300 font-mono">
            Attention Needed
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{stats.warning + stats.failed}</div>
          <div className="mt-1 text-xs text-white/45">Latest warning or failed dispatches.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-[#0D1411] border border-white/10 p-5 space-y-4">
          <div>
            <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
              <Calendar size={14} />
              Schedule Briefings
            </h4>
            <p className="text-[11px] text-white/50 mt-1">
              Define recurring research, compliance, and monitoring briefings with validation and persistence.
            </p>
          </div>

          <form onSubmit={handleAddCron} className="space-y-4 font-mono text-[10px]">
            <div className="space-y-1">
              <label className="text-[8px] text-white/40 uppercase block">Job Title</label>
              <input
                type="text"
                value={newJobName}
                onChange={(e) => setNewJobName(e.target.value)}
                placeholder="weekly_decarb_potency_audit"
                className="w-full bg-[#1A221E] border border-white/10 p-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[8px] text-white/40 uppercase block">Cron Expression</label>
                <input
                  type="text"
                  value={newCronString}
                  onChange={(e) => setNewCronString(e.target.value)}
                  placeholder="0 9 * * 1"
                  className="w-full bg-[#1A221E] border border-white/10 p-2 text-xs text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[8px] text-white/40 uppercase block">Frequency</label>
                <select
                  value={newFrequency}
                  onChange={(e) => setNewFrequency(e.target.value as CronFrequency)}
                  className="w-full bg-[#1A221E] border border-white/10 p-2 text-xs text-white focus:outline-none"
                >
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Regulatory Trigger">Regulatory Trigger</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[8px] text-white/40 uppercase block">Destination Email</label>
              <input
                type="email"
                value={newTargetEmail}
                onChange={(e) => setNewTargetEmail(e.target.value)}
                placeholder="auditor@hempforge.com"
                className="w-full bg-[#1A221E] border border-white/10 p-2 text-xs text-white"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-[8px] text-white/40 uppercase block">Analytical Focus</label>
              <select
                value={newTargetFocus}
                onChange={(e) => setNewTargetFocus(e.target.value)}
                className="w-full bg-[#1A221E] border border-white/10 p-2 text-xs text-white focus:outline-none"
              >
                {FOCUS_OPTIONS.map((focus) => (
                  <option key={focus} value={focus}>
                    {focus}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-white/5 border border-white/5 p-3 text-[9px] text-slate-400 space-y-1">
              <div className="text-amber-500 font-bold uppercase flex items-center gap-1.5">
                <Info size={11} />
                Cron Cheat Sheet
              </div>
              <p>0 9 * * 1 = Every Monday at 9:00 AM</p>
              <p>0 18 * * * = Every day at 6:00 PM</p>
              <p>*/30 * * * * = Every 30 minutes</p>
              <p>For Regulatory Trigger mode, the cron controls polling cadence.</p>
            </div>

            {formError && (
              <div className="border border-red-500/20 bg-red-500/10 p-3 text-[10px] text-red-300 flex items-center gap-2">
                <AlertTriangle size={12} />
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] font-bold text-xs uppercase py-2.5 flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus size={14} />
                Save Schedule
              </button>

              <button
                type="button"
                onClick={resetForm}
                className="w-full bg-[#1A221E] hover:bg-white/5 text-white font-bold text-xs uppercase py-2.5 flex items-center justify-center gap-1.5 transition-colors border border-white/10"
              >
                <Sliders size={14} />
                Reset Form
              </button>
            </div>
          </form>
        </div>

        <div className="xl:col-span-2 bg-[#0D1411] border border-white/10 p-5 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
              <Clock size={14} />
              Registered Briefing Threads ({filteredCrons.length})
            </h4>

            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 text-[10px] font-mono uppercase border ${
                  filter === 'all'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    : 'bg-[#1A221E] text-white/60 border-white/10'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('active')}
                className={`px-3 py-1 text-[10px] font-mono uppercase border ${
                  filter === 'active'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    : 'bg-[#1A221E] text-white/60 border-white/10'
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setFilter('paused')}
                className={`px-3 py-1 text-[10px] font-mono uppercase border ${
                  filter === 'paused'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                    : 'bg-[#1A221E] text-white/60 border-white/10'
                }`}
              >
                Paused
              </button>
            </div>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {filteredCrons.length === 0 && (
              <div className="border border-white/5 bg-black/10 p-6 text-center text-white/40 font-mono text-xs">
                No scheduler definitions match the current filter.
              </div>
            )}

            {filteredCrons.map((job) => {
              const isRunning = executingJobId === job.id;

              const resultStyles =
                job.lastResult === 'failed'
                  ? 'text-red-300 border-red-500/20 bg-red-500/10'
                  : job.lastResult === 'warning'
                  ? 'text-amber-300 border-amber-500/20 bg-amber-500/10'
                  : 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10';

              return (
                <div
                  key={job.id}
                  className={`border p-4 transition-all ${
                    job.status === 'active'
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : 'bg-[#121915]/50 border-white/5 opacity-75'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 mb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 ${
                            job.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'
                          }`}
                        />
                        <h5 className="text-sm font-semibold text-white">{job.name}</h5>
                      </div>

                      <div className="text-[11px] text-white/50 font-mono">
                        Recipient: <span className="text-white">{job.targetEmail}</span> · Focus:{' '}
                        <span className="text-emerald-400">{job.targetFocus}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span className="bg-[#0A0F0D] text-slate-300 font-mono text-[9px] px-2 py-1 border border-white/5">
                        {job.frequency}
                      </span>
                      <span className="bg-[#0A0F0D] text-slate-300 font-mono text-[9px] px-2 py-1 border border-white/5">
                        {job.cronString}
                      </span>
                      {job.lastResult && (
                        <span className={`font-mono text-[9px] px-2 py-1 border uppercase ${resultStyles}`}>
                          {job.lastResult}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[10px] font-mono border-t border-white/5 pt-3">
                    <div className="text-white/45">
                      Last run: <span className="text-slate-200">{formatDateTimeForDisplay(job.lastRun)}</span>
                    </div>
                    <div className="text-white/45">
                      Next run hint: <span className="text-slate-200">{job.nextRunHint}</span>
                    </div>
                    <div className="text-white/45">
                      Created: <span className="text-slate-200">{formatDateTimeForDisplay(job.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                    <div className="text-[10px] font-mono text-white/35 flex items-center gap-1.5">
                      <Database size={11} />
                      Scheduler definition retained locally for now.
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleCron(job.id)}
                        className={`px-3 py-1 border text-[9px] uppercase transition-colors font-mono ${
                          job.status === 'active'
                            ? 'bg-transparent text-amber-400 border-amber-500/30 hover:bg-amber-500/5'
                            : 'bg-emerald-500 text-black border-transparent font-bold'
                        }`}
                      >
                        {job.status === 'active' ? 'Pause' : 'Activate'}
                      </button>

                      <button
                        onClick={() => handleTriggerReportNow(job)}
                        disabled={isRunning}
                        className="bg-[#1A221E] text-white hover:text-emerald-400 border border-white/10 hover:border-emerald-500/30 px-3 py-1 text-[9px] uppercase flex items-center gap-1 transition-colors font-mono disabled:opacity-50"
                      >
                        {isRunning ? (
                          <>
                            <div className="w-2.5 h-2.5 border border-white border-t-transparent animate-spin" />
                            Running...
                          </>
                        ) : (
                          <>
                            <Play size={10} />
                            Dispatch Now
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => handleDeleteCron(job.id)}
                        className="text-white/30 hover:text-red-400 p-1"
                        title="Delete scheduler definition"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {currentViewBriefing && (
            <div className="border-t border-white/10 pt-4 space-y-3 animate-in fade-in slide-in-from-bottom-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-[10px] font-mono">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <Sparkles size={11} className="text-amber-500 animate-pulse" />
                  Dispatch Terminal Output
                </span>

                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard?.writeText(currentViewBriefing.payload)}
                    className="px-3 py-1 border border-white/10 text-white/70 hover:text-white hover:bg-white/5"
                  >
                    Copy Payload
                  </button>
                  <button
                    onClick={() => setCurrentViewBriefing(null)}
                    className="px-3 py-1 border border-white/10 text-white/70 hover:text-white hover:bg-white/5"
                  >
                    Clear Console
                  </button>
                </div>
              </div>

              <div className="text-[10px] font-mono text-white/35">
                Preview for: <span className="text-white/70">{currentViewBriefing.title}</span> · Generated:{' '}
                <span className="text-white/70">
                  {formatDateTimeForDisplay(currentViewBriefing.generatedAt)}
                </span>
              </div>

              <pre className="bg-[#050907] border border-white/5 p-4 font-mono text-[9px] text-emerald-400 h-56 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                {currentViewBriefing.payload}
              </pre>
            </div>
          )}

          <div className="border border-white/5 bg-black/10 p-3 text-[10px] font-mono text-white/45 flex items-start gap-2">
            <Send size={12} className="mt-0.5 text-sky-300 shrink-0" />
            This version upgrades UX, validation, persistence, and reporting structure, but it still uses simulated dispatch.
            The next step is to connect create/update/run actions to backend scheduler endpoints and persisted audit logs.
          </div>
        </div>
      </div>
    </div>
  );
}
