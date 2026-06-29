import React, { useMemo, useState, useEffect } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Clock3,
  FileSearch,
  FileText,
  Filter,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { COARecord } from '../types';
import { authFetch } from '../lib/firebase';
import { useCOAs } from '../contexts';

type DashboardProps = {
  coas: COARecord[];
};

type StatusFilter = 'All' | COARecord['status'];
type SortMode = 'newest' | 'oldest' | 'highest-thc' | 'lowest-thc' | 'strain';

export default function Dashboard({ coas }: DashboardProps) {
  const { refreshCoas } = useCOAs();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [selectedCoaId, setSelectedCoaId] = useState<string | null>(coas[0]?.id || null);

  const [summary, setSummary] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditRunning, setAuditRunning] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    async function loadDashboardData() {
      setLoading(true);
      try {
        const [summaryRes, activityRes] = await Promise.all([
          authFetch('/api/dashboard/summary'),
          authFetch('/api/dashboard/activity?limit=5')
        ]);
        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          setSummary(summaryData.summary);
        }
        if (activityRes.ok) {
          const activityData = await activityRes.json();
          setActivities(activityData.items);
        }
      } catch (error) {
        console.error("Failed to load dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }
    loadDashboardData();
  }, [coas.length]);

  const filteredCoas = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const filtered = coas.filter((coa) => {
      const matchesStatus = statusFilter === 'All' ? true : coa.status === statusFilter;

      const matchesSearch =
        normalizedSearch.length === 0
          ? true
          : [
              coa.batchId,
              coa.strain,
              coa.status,
              coa.recommendation || '',
            ]
              .join(' ')
              .toLowerCase()
              .includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });

    return [...filtered].sort((a, b) => {
      switch (sortMode) {
        case 'oldest':
          return new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime();
        case 'highest-thc':
          return b.totalThc - a.totalThc;
        case 'lowest-thc':
          return a.totalThc - b.totalThc;
        case 'strain':
          return a.strain.localeCompare(b.strain);
        case 'newest':
        default:
          return new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime();
      }
    });
  }, [coas, searchTerm, sortMode, statusFilter]);

  const selectedCoa = useMemo(() => {
    return filteredCoas.find((coa) => coa.id === selectedCoaId) || filteredCoas[0] || null;
  }, [filteredCoas, selectedCoaId]);

  const handleMetricClick = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setSelectedCoaId(null);
  };

  const handleRunAudit = async () => {
    setAuditRunning(true);
    try {
      const res = await authFetch('/api/dashboard/run-audit', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        await refreshCoas();
        
        // Refresh activities
        const activityRes = await authFetch('/api/dashboard/activity?limit=5');
        if (activityRes.ok) {
          const activityData = await activityRes.json();
          setActivities(activityData.items);
        }
      }
    } catch (err) {
      console.error("Audit failed", err);
    } finally {
      setAuditRunning(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await authFetch('/api/dashboard/export', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusFilter, search: searchTerm, sort: sortMode })
      });
      if (res.ok) {
        const data = await res.json();
        console.log("Exported", data.count, "records");
        alert(`Successfully exported ${data.count} records. (Check console or network for details)`);
      }
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      setExporting(false);
    }
  };

  if (loading && !summary) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="border-b border-white/10 pb-6">
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Compliance Dashboard</h1>
            <p className="mt-2 text-sm text-white/50 max-w-3xl">
              Explore live batch compliance, investigate risk signals, and move directly from overview
              to action.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleRunAudit}
              disabled={auditRunning}
              className="px-4 py-2 bg-emerald-500 text-[#0A0F0D] text-xs font-mono uppercase tracking-widest font-bold hover:bg-emerald-400 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {auditRunning && <Loader2 size={14} className="animate-spin" />}
              Run full ledger audit
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 border border-white/10 text-white/70 text-xs font-mono uppercase tracking-widest hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {exporting && <Loader2 size={14} className="animate-spin" />}
              Export audit snapshot
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          title="Total Batches"
          value={String(summary?.totalBatches || 0)}
          icon={<FileText size={18} />}
          subtitle="All ingested COAs in current workspace."
          active={statusFilter === 'All'}
          onClick={() => handleMetricClick('All')}
        />
        <MetricCard
          title="Compliant"
          value={String(summary?.compliant || 0)}
          icon={<CheckCircle size={18} />}
          subtitle={`${summary?.complianceRate || 0}% of inventory currently clears threshold.`}
          valueColor="text-emerald-400"
          active={statusFilter === 'Compliant'}
          onClick={() => handleMetricClick('Compliant')}
        />
        <MetricCard
          title="At Risk"
          value={String(summary?.atRisk || 0)}
          icon={<AlertTriangle size={18} />}
          subtitle="Batches that may require remediation or review."
          valueColor="text-amber-400"
          active={statusFilter === 'At Risk'}
          onClick={() => handleMetricClick('At Risk')}
        />
        <MetricCard
          title="Non-Compliant"
          value={String(summary?.nonCompliant || 0)}
          icon={<ShieldAlert size={18} />}
          subtitle="Batches exceeding allowable posture."
          valueColor="text-red-400"
          active={statusFilter === 'Non-Compliant'}
          onClick={() => handleMetricClick('Non-Compliant')}
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <InsightCard
          title="Average Total THC"
          value={`${summary?.averageTotalThc.toFixed(3) || 0}%`}
          icon={<Sparkles size={15} className="text-amber-400" />}
          description="Cross-batch potency baseline across all current COAs."
        />
        <InsightCard
          title="Highest Risk Batch"
          value={summary?.highestRisk ? summary.highestRisk.batchId : 'No data'}
          icon={<ShieldAlert size={15} className="text-red-400" />}
          description={
            summary?.highestRisk
              ? `${summary.highestRisk.totalThc.toFixed(3)}% total THC · ${summary.highestRisk.strain}`
              : 'No batches available yet.'
          }
        />
        <InsightCard
          title="Recent Upload Flow"
          value={`${summary?.recentUploads?.length || 0} recent`}
          icon={<Clock3 size={15} className="text-sky-300" />}
          description="Most recently ingested records ready for review."
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-4">
          <div className="border border-white/10 bg-[#0D1411] p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-widest font-mono flex items-center gap-2">
                  <FileSearch size={14} />
                  Interactive Batch Explorer
                </h2>
                <p className="mt-1 text-xs text-white/45">
                  Filter, search, and sort COAs to identify compliance hotspots fast.
                </p>
              </div>

              <div className="text-[10px] font-mono uppercase tracking-widest text-white/35">
                {filteredCoas.length} visible batch{filteredCoas.length === 1 ? '' : 'es'}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search batch, strain, status..."
                  className="w-full bg-[#111815] border border-white/10 pl-9 pr-3 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-emerald-500/40"
                />
              </div>

              <div className="relative">
                <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as StatusFilter);
                    setSelectedCoaId(null);
                  }}
                  className="w-full appearance-none bg-[#111815] border border-white/10 pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/40"
                >
                  <option value="All">All statuses</option>
                  <option value="Compliant">Compliant</option>
                  <option value="At Risk">At Risk</option>
                  <option value="Non-Compliant">Non-Compliant</option>
                </select>
              </div>

              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="w-full bg-[#111815] border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/40"
              >
                <option value="newest">Sort by newest</option>
                <option value="oldest">Sort by oldest</option>
                <option value="highest-thc">Sort by highest THC</option>
                <option value="lowest-thc">Sort by lowest THC</option>
                <option value="strain">Sort by strain</option>
              </select>
            </div>
          </div>

          <div className="border border-white/10 bg-[#0D1411] overflow-hidden">
            <div className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-white/10 text-[10px] font-mono uppercase tracking-widest text-white/35">
              <div className="col-span-2">Batch</div>
              <div className="col-span-2">Strain</div>
              <div className="col-span-2">Uploaded</div>
              <div className="col-span-2">Total THC</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Action</div>
            </div>

            <div className="divide-y divide-white/5">
              {filteredCoas.length === 0 ? (
                <div className="p-8 text-center text-white/35 text-sm">
                  No COAs match the current filters.
                </div>
              ) : (
                filteredCoas.map((coa) => (
                  <button
                    key={coa.id}
                    onClick={() => setSelectedCoaId(coa.id)}
                    className={`w-full grid grid-cols-12 gap-3 px-4 py-4 text-left transition-colors ${
                      selectedCoa?.id === coa.id
                        ? 'bg-emerald-500/10'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="col-span-2 text-sm text-white font-medium">{coa.batchId}</div>
                    <div className="col-span-2 text-sm text-white/70">{coa.strain}</div>
                    <div className="col-span-2 text-sm text-white/55">{coa.uploadDate}</div>
                    <div className="col-span-2 text-sm text-white">{coa.totalThc.toFixed(3)}%</div>
                    <div className="col-span-2">
                      <StatusBadge status={coa.status} />
                    </div>
                    <div className="col-span-2 text-xs font-mono uppercase tracking-widest text-emerald-400 flex items-center gap-1">
                      Inspect <ArrowRight size={12} />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-4">
          <div className="border border-white/10 bg-[#0D1411] p-5 sticky top-6 space-y-5">
            <div>
              <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-widest font-mono">
                Batch Detail
              </h2>
              <p className="mt-1 text-xs text-white/45">
                Deep inspection panel for the currently selected COA.
              </p>
            </div>

            {selectedCoa ? (
              <>
                <div className="space-y-2">
                  <div className="text-xl font-semibold text-white">{selectedCoa.batchId}</div>
                  <div className="text-sm text-white/55">{selectedCoa.strain}</div>
                  <StatusBadge status={selectedCoa.status} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <DetailTile label="THCa" value={`${selectedCoa.thca.toFixed(3)}%`} />
                  <DetailTile label="Delta-9 THC" value={`${selectedCoa.d9thc.toFixed(3)}%`} />
                  <DetailTile label="Total THC" value={`${selectedCoa.totalThc.toFixed(3)}%`} />
                  <DetailTile label="Upload Date" value={selectedCoa.uploadDate} />
                </div>

                <div className="border border-white/5 bg-black/20 p-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/35">
                    Recommendation
                  </div>
                  <p className="mt-2 text-sm text-white/70 leading-relaxed">
                    {selectedCoa.recommendation || 'No recommendation has been attached to this COA yet.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <ActionButton label="Open compliance workspace" icon={<ArrowRight size={13} />} />
                  <ActionButton label="Send to research lab" icon={<Sparkles size={13} />} />
                  <ActionButton label="Prepare audit packet" icon={<ShieldCheck size={13} />} />
                </div>
              </>
            ) : (
              <div className="text-sm text-white/45">
                Select a batch from the explorer to inspect its potency profile and recommendation.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title="Recent Activity">
          {activities.length > 0 ? (
            activities.map((act) => (
              <ActivityItem
                key={act.id}
                title={act.action}
                subtitle={act.details}
                tone={act.category === 'AI_INFERENCE' ? 'success' : act.category === 'DATA_CHANGE' ? 'warning' : 'neutral'}
              />
            ))
          ) : (
            <div className="text-sm text-white/45 p-4 border border-white/5 bg-black/20">
              No recent audit activity found.
            </div>
          )}
        </Panel>

        <Panel title="Operational Next Steps">
          <QuickAction
            title="Review high-THC records"
            description="Sort by highest THC and inspect remediation candidates."
          />
          <QuickAction
            title="Export current filtered view"
            description="Use current dashboard filters as the basis for an audit snapshot."
          />
          <QuickAction
            title="Move research-ready records"
            description="Send noteworthy batches into the lab for experiment or documentation flows."
          />
        </Panel>
      </section>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  subtitle,
  valueColor = 'text-white',
  active = false,
  onClick,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle: string;
  valueColor?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left border p-5 transition-all ${
        active
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : 'bg-[#0D1411] border-white/10 hover:border-emerald-500/20 hover:bg-white/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">{title}</div>
          <div className={`mt-3 text-3xl font-bold ${valueColor}`}>{value}</div>
        </div>
        <div className="text-white/40">{icon}</div>
      </div>
      <div className="mt-3 text-xs text-white/45 leading-relaxed">{subtitle}</div>
    </button>
  );
}

function InsightCard({
  title,
  value,
  icon,
  description,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  description: string;
}) {
  return (
    <div className="border border-white/10 bg-[#0D1411] p-4">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/40">
        {icon}
        {title}
      </div>
      <div className="mt-3 text-2xl font-bold text-white">{value}</div>
      <div className="mt-2 text-xs text-white/45 leading-relaxed">{description}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: COARecord['status'] }) {
  const styles =
    status === 'Compliant'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : status === 'At Risk'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-red-500/10 text-red-400 border-red-500/20';

  return (
    <span className={`inline-flex px-2 py-1 text-[10px] font-mono uppercase tracking-widest border ${styles}`}>
      {status}
    </span>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/5 bg-black/20 p-3">
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/35">{label}</div>
      <div className="mt-2 text-sm text-white">{value}</div>
    </div>
  );
}

function ActionButton({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <button className="w-full px-4 py-3 border border-white/10 bg-[#111815] text-white/75 hover:text-white hover:bg-white/5 transition-colors text-sm flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="text-emerald-400">{icon}</span>
    </button>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-white/10 bg-[#0D1411] p-5 space-y-4">
      <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-widest font-mono">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

const ActivityItem: React.FC<{
  title: string;
  subtitle: string;
  tone: 'success' | 'warning' | 'neutral';
}> = ({
  title,
  subtitle,
  tone,
}) => {
  const toneClass =
    tone === 'success'
      ? 'bg-emerald-500'
      : tone === 'warning'
      ? 'bg-amber-500'
      : 'bg-white/20';

  return (
    <div className="flex gap-3 items-start border border-white/5 bg-black/20 p-4">
      <div className={`w-2.5 h-2.5 mt-1.5 rounded-full ${toneClass}`} />
      <div>
        <div className="text-sm text-white">{title}</div>
        <div className="mt-1 text-xs text-white/45 leading-relaxed">{subtitle}</div>
      </div>
    </div>
  );
}

function QuickAction({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <button className="w-full text-left border border-white/5 bg-black/20 p-4 hover:bg-white/5 transition-colors">
      <div className="text-sm text-white">{title}</div>
      <div className="mt-1 text-xs text-white/45 leading-relaxed">{description}</div>
    </button>
  );
}