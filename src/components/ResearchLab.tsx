import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../lib/firebase';
import {
  Activity,
  AlertTriangle,
  Beaker,
  BookOpen,
  Calendar,
  CheckCircle2,
  Database,
  FileCheck2,
  Image,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import LiteratureFeeds from './LiteratureFeeds';
import DocumentLibrary, { DocumentEntry } from './DocumentLibrary';
import FlyerCreator from './FlyerCreator';
import ReportScheduler from './ReportScheduler';

import ResearchPipeline from './research-lab/ResearchPipeline';
import DecarbSimulatorTab from './research-lab/DecarbSimulatorTab';
import CsaWorkspaceTab from './research-lab/CsaWorkspaceTab';

import { PipelineProvider } from '../contexts/PipelineContext';


type LabTab =
  | 'overview'
  | 'pipeline'
  | 'simulators'
  | 'documents'
  | 'flyers'
  | 'scheduler'
  | 'csa'
  | 'literature';

type NotificationTone = 'info' | 'success' | 'error';

type LabNotification = {
  message: string;
  tone: NotificationTone;
};

type FeedPaper = {
  id: string;
  title: string;
  abstract: string;
  source: string;
  journal?: string;
  publishedDate?: string;
  authors: string[];
};

const TAB_CONFIG: Array<{
  id: LabTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: 'overview', label: 'Lab Overview', icon: Database },
  { id: 'pipeline', label: 'Research Pipeline', icon: Sparkles },
  { id: 'simulators', label: 'Simulators & Sliders', icon: Beaker },
  { id: 'documents', label: 'Document Library & RAG', icon: FileCheck2 },
  { id: 'flyers', label: 'Science Poster Designer', icon: Image },
  { id: 'scheduler', label: 'Cron Brief Scheduler', icon: Calendar },
  { id: 'csa', label: 'CSA & System Audits', icon: ShieldCheck },
  { id: 'literature', label: 'Literature Feeds', icon: BookOpen },
];

function mergeUniquePapers(base: DocumentEntry[], incoming: DocumentEntry[]) {
  const map = new Map<string, DocumentEntry>();

  for (const paper of base) {
    map.set(paper.id, paper);
  }

  for (const paper of incoming) {
    const existing = map.get(paper.id);
    map.set(paper.id, existing ? { ...existing, ...paper } : paper);
  }

  return Array.from(map.values()).sort((a, b) =>
    (b.uploadDate || '').localeCompare(a.uploadDate || '')
  );
}

function normalizeYear(input?: string) {
  if (!input) return new Date().getFullYear();
  const year = Number.parseInt(String(input).slice(0, 4), 10);
  return Number.isFinite(year) ? year : new Date().getFullYear();
}

function normalizePaperName(title: string) {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}.pdf`;
}

function papersDiffer(prev?: DocumentEntry, next?: DocumentEntry) {
  if (!prev) return true;
  if (!next) return true;

  return [
    prev.title,
    prev.journal,
    prev.year,
    prev.authors,
    prev.abstract,
    JSON.stringify(prev.compounds || []),
    prev.dosage,
    prev.outcomes,
    prev.path,
    prev.name,
  ].join('|') !==
    [
      next.title,
      next.journal,
      next.year,
      next.authors,
      next.abstract,
      JSON.stringify(next.compounds || []),
      next.dosage,
      next.outcomes,
      next.path,
      next.name,
    ].join('|');
}

function mapFeedPaperToDocument(
  paper: FeedPaper,
  extracted?: Partial<DocumentEntry>
): DocumentEntry {
  return {
    id: paper.id,
    name: normalizePaperName(paper.title),
    path: `/Literature/${paper.source || 'external'}/`,
    size: 'N/A',
    type: 'pdf',
    uploadDate: new Date().toISOString().split('T')[0],
    title: paper.title,
    journal: paper.journal || 'Unspecified Journal',
    year: normalizeYear(paper.publishedDate),
    authors: Array.isArray(paper.authors) ? paper.authors.join(', ') : 'Unknown',
    abstract: paper.abstract || 'No abstract available.',
    compounds:
      extracted?.compounds && extracted.compounds.length > 0
        ? extracted.compounds
        : ['THCa', 'CBD'],
    dosage: extracted?.dosage || 'N/A',
    outcomes: extracted?.outcomes || 'N/A',
  };
}

function StatCard({
  label,
  value,
  helper,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  helper: string;
  tone?: 'default' | 'success' | 'warn';
}) {
  const toneClasses =
    tone === 'success'
      ? 'border-emerald-500/20 bg-emerald-500/5'
      : tone === 'warn'
      ? 'border-amber-500/20 bg-amber-500/5'
      : 'border-white/5 bg-[#1A221E]';

  return (
    <div className={`p-4 border ${toneClasses}`}>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-white/50">{helper}</div>
    </div>
  );
}

const TabButton: React.FC<{
  active: boolean;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
}> = ({
  active,
  label,
  icon: Icon,
  onClick,
}) => {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 font-mono text-xs uppercase tracking-widest flex items-center gap-2 transition-all ${
        active
          ? 'bg-emerald-500/10 text-emerald-400 border-b-2 border-emerald-500 font-bold'
          : 'text-slate-400 hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon size={14} className={active ? 'text-emerald-400' : ''} />
      {label}
    </button>
  );
}

function NotificationBanner({
  notification,
}: {
  notification: LabNotification | null;
}) {
  if (!notification) return null;

  const styles =
    notification.tone === 'success'
      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
      : notification.tone === 'error'
      ? 'bg-red-500/10 text-red-300 border-red-500/20'
      : 'bg-sky-500/10 text-sky-300 border-sky-500/20';

  const Icon =
    notification.tone === 'success'
      ? CheckCircle2
      : notification.tone === 'error'
      ? AlertTriangle
      : Activity;

  return (
    <div className={`border p-3 text-xs font-mono flex items-center gap-2 ${styles}`}>
      <Icon size={14} className="shrink-0" />
      <span>{notification.message}</span>
    </div>
  );
}

export default function ResearchLab() {
  const [labActiveTab, setLabActiveTab] = useState<LabTab>('overview');
  const [allPapers, setAllPapers] = useState<DocumentEntry[]>([]);
  const [selectedPaperEntity, setSelectedPaperEntity] = useState<DocumentEntry | null>(null);

  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [labError, setLabError] = useState<string | null>(null);
  const [notification, setNotification] = useState<LabNotification | null>(null);

  // Autonomous Swarm Trends & Insights state
  const [trends, setTrends] = useState<any[]>([]);
  const [insights, setInsights] = useState<any[]>([]);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [runningAutonomousSwarm, setRunningAutonomousSwarm] = useState(false);

  const fetchTrendsAndInsights = useCallback(async (silent = false) => {
    setLoadingTrends(true);
    try {
      const res = await authFetch('/api/literature/trends-insights');
      if (res.ok) {
        const data = await res.json();
        setTrends(data.trends || []);
        setInsights(data.insights || []);
      }
    } catch (err) {
      console.error("Error fetching trends/insights:", err);
    } finally {
      setLoadingTrends(false);
    }
  }, []);

  const triggerAutonomousSwarmPipeline = async () => {
    setRunningAutonomousSwarm(true);
    showLabNotification('Triggering multi-agent literature ingest, simulation conversion & document generation cycle...', 'info');
    try {
      const res = await authFetch('/api/literature/run-autonomous-pipeline', {
        method: 'POST'
      });
      if (res.ok) {
        showLabNotification('Autonomous Swarm completed processing cycle successfully!', 'success');
        // Refresh everything
        await Promise.all([
          fetchCachedLiterature(true),
          fetchTrendsAndInsights(true)
        ]);
      } else {
        throw new Error('Pipeline trigger failed');
      }
    } catch (err: any) {
      showLabNotification('Error executing autonomous pipeline.', 'error');
    } finally {
      setRunningAutonomousSwarm(false);
    }
  };

  const notificationTimerRef = useRef<number | null>(null);
  const papersRef = useRef<DocumentEntry[]>(allPapers);

  useEffect(() => {
    papersRef.current = allPapers;
  }, [allPapers]);

  const showLabNotification = useCallback(
    (message: string, tone: NotificationTone = 'info') => {
      setNotification({ message, tone });

      if (notificationTimerRef.current) {
        window.clearTimeout(notificationTimerRef.current);
      }

      notificationTimerRef.current = window.setTimeout(() => {
        setNotification(null);
      }, 4000);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (notificationTimerRef.current) {
        window.clearTimeout(notificationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedPaperEntity && allPapers.length > 0) {
      setSelectedPaperEntity(allPapers[0]);
      return;
    }

    if (
      selectedPaperEntity &&
      !allPapers.some((paper) => paper.id === selectedPaperEntity.id)
    ) {
      setSelectedPaperEntity(allPapers[0] || null);
    }
  }, [allPapers, selectedPaperEntity]);

  const fetchCachedLiterature = useCallback(
    async (silent = false) => {
      setLabError(null);
      setRefreshing(true);

      try {
        const res = await authFetch('/api/literature/cache');

        if (!res.ok) {
          throw new Error(`Cache request failed with status ${res.status}`);
        }

        const data = await res.json();
        const incoming = Array.isArray(data?.papers) ? data.papers : [];

        if (incoming.length > 0) {
          setAllPapers((prev) => mergeUniquePapers(prev, incoming));
        }

        setLastSyncAt(new Date().toISOString());

        if (!silent) {
          showLabNotification(
            incoming.length > 0
              ? `Synchronized ${incoming.length} cached research record(s).`
              : 'Cache sync completed. No new research records were found.',
            'success'
          );
        }
      } catch (error: any) {
        const message =
          error?.message || 'Unable to synchronize literature cache at this time.';
        setLabError(message);

        if (!silent) {
          showLabNotification(message, 'error');
        }
      } finally {
        setBooting(false);
        setRefreshing(false);
      }
    },
    [showLabNotification]
  );

  useEffect(() => {
    fetchCachedLiterature(true);
    fetchTrendsAndInsights(true);
  }, [fetchCachedLiterature, fetchTrendsAndInsights]);

  const persistPaper = useCallback(async (paper: DocumentEntry) => {
    const res = await authFetch('/api/literature/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper }),
    });

    if (!res.ok) {
      throw new Error(`Persist failed with status ${res.status}`);
    }
  }, []);

  const handleIngestPaper = useCallback(
    async (paper: DocumentEntry) => {
      setIngesting(true);
      setLabError(null);

      setAllPapers((prev) => mergeUniquePapers(prev, [paper]));
      setSelectedPaperEntity(paper);

      try {
        await persistPaper(paper);
        setLastSyncAt(new Date().toISOString());
        showLabNotification(`Ingested "${paper.title}" into the research library.`, 'success');
      } catch (error: any) {
        const message = error?.message || 'Paper ingestion failed.';
        setLabError(message);
        showLabNotification(message, 'error');
      } finally {
        setIngesting(false);
      }
    },
    [persistPaper, showLabNotification]
  );

  const handleLibraryChange = useCallback(
    async (updatedPapers: DocumentEntry[]) => {
      setAllPapers(updatedPapers);
      setSavingLibrary(true);
      setLabError(null);

      const changedPapers = updatedPapers.filter((paper) => {
        const previous = papersRef.current.find((entry) => entry.id === paper.id);
        return papersDiffer(previous, paper);
      });

      if (changedPapers.length === 0) {
        setSavingLibrary(false);
        showLabNotification('Library metadata is already up to date.', 'info');
        return;
      }

      const results = await Promise.allSettled(changedPapers.map((paper) => persistPaper(paper)));
      const failed = results.filter((result) => result.status === 'rejected').length;

      setSavingLibrary(false);

      if (failed > 0) {
        const message = `${failed} library update(s) failed to persist.`;
        setLabError(message);
        showLabNotification(message, 'error');
      } else {
        setLastSyncAt(new Date().toISOString());
        showLabNotification(
          `Saved ${changedPapers.length} library update(s) to the research store.`,
          'success'
        );
      }
    },
    [persistPaper, showLabNotification]
  );

  const handleAddFromLiterature = useCallback(
    async (paper: FeedPaper) => {
      setIngesting(true);
      setLabError(null);
      showLabNotification('Extracting structured metadata from literature feed...', 'info');

      try {
        const res = await authFetch('/api/literature/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: paper.title,
            abstract: paper.abstract,
          }),
        });

        if (!res.ok) {
          throw new Error(`Extraction failed with status ${res.status}`);
        }

        const extracted = await res.json();

        const mappedPaper = mapFeedPaperToDocument(paper, {
          compounds:
            Array.isArray(extracted?.compounds) && extracted.compounds.length > 0
              ? extracted.compounds
              : ['THCa', 'CBD'],
          dosage: extracted?.dosage || 'N/A',
          outcomes: extracted?.outcomes || 'N/A',
        });

        await handleIngestPaper(mappedPaper);
      } catch (error: any) {
        const fallbackPaper = mapFeedPaperToDocument(paper, {
          compounds: ['THCa', 'CBD'],
          dosage: 'N/A',
          outcomes: 'N/A',
        });

        setAllPapers((prev) => mergeUniquePapers(prev, [fallbackPaper]));
        setSelectedPaperEntity(fallbackPaper);

        try {
          await persistPaper(fallbackPaper);
          setLastSyncAt(new Date().toISOString());
          showLabNotification(
            'Extraction failed, but the paper was ingested with fallback metadata.',
            'error'
          );
        } catch (persistError: any) {
          const message =
            persistError?.message || 'Fallback ingestion failed during persistence.';
          setLabError(message);
          showLabNotification(message, 'error');
        } finally {
          setIngesting(false);
        }

        return;
      }

      setIngesting(false);
    },
    [handleIngestPaper, persistPaper, showLabNotification]
  );

  const stats = useMemo(() => {
    const totalPapers = allPapers.length;

    const papersWithFullMetadata = allPapers.filter(
      (paper) =>
        Boolean(paper.title) &&
        Boolean(paper.journal) &&
        Boolean(paper.authors) &&
        Boolean(paper.abstract)
    ).length;

    const flyerReady = allPapers.filter(
      (paper) =>
        Array.isArray(paper.compounds) &&
        paper.compounds.length > 0 &&
        Boolean(paper.outcomes)
    ).length;

    const journalsCovered = new Set(
      allPapers.map((paper) => paper.journal).filter(Boolean)
    ).size;

    return {
      totalPapers,
      papersWithFullMetadata,
      flyerReady,
      journalsCovered,
      integrityScore:
        totalPapers === 0
          ? 0
          : Math.round((papersWithFullMetadata / totalPapers) * 100),
    };
  }, [allPapers]);

  const selectedPaperSummary = useMemo(() => {
    if (!selectedPaperEntity) return null;

    return {
      title: selectedPaperEntity.title || selectedPaperEntity.name,
      journal: selectedPaperEntity.journal || 'Unspecified Journal',
      authors: selectedPaperEntity.authors || 'Unknown',
      compounds: selectedPaperEntity.compounds?.join(', ') || 'Unspecified',
      outcomes: selectedPaperEntity.outcomes || 'No outcome summary available.',
    };
  }, [selectedPaperEntity]);

  return (
    <PipelineProvider
      allPapers={allPapers}
      setAllPapers={setAllPapers}
      selectedPaperEntity={selectedPaperEntity}
      setSelectedPaperEntity={setSelectedPaperEntity}
    >
      <div className="max-w-7xl mx-auto space-y-8 pb-12">
        <header className="border-b border-white/10 pb-6 flex flex-col xl:flex-row xl:items-end justify-between gap-5">
          <div className="space-y-2">
            <h2 className="text-3xl font-display font-bold text-white tracking-tight italic">
              Research Integrity Lab
            </h2>
            <p className="text-white/45 font-mono text-xs uppercase tracking-widest max-w-3xl">
              Literature ingestion, protocol generation, simulation control, audit visibility,
              and publication packaging in one governed workspace.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 font-mono flex items-center gap-1.5 h-fit">
              <Activity size={12} className={refreshing || ingesting ? 'animate-pulse' : ''} />
              {booting
                ? 'BOOTING LAB'
                : refreshing
                ? 'SYNC IN PROGRESS'
                : ingesting
                ? 'INGESTING RECORD'
                : 'INTEGRITY ENGINE ACTIVE'}
            </div>

            <button
              onClick={() => fetchCachedLiterature(false)}
              disabled={refreshing}
              className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              Refresh Cache
            </button>
          </div>
        </header>

        <NotificationBanner notification={notification} />

        {labError && (
          <div className="border border-red-500/20 bg-red-500/10 text-red-300 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em]">Lab Warning</div>
            <div className="mt-1 text-sm">{labError}</div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            label="Total Research Records"
            value={stats.totalPapers}
            helper="Documents currently available in the lab."
            tone="default"
          />
          <StatCard
            label="Metadata Integrity"
            value={`${stats.integrityScore}%`}
            helper={`${stats.papersWithFullMetadata} record(s) have citation-grade metadata.`}
            tone={stats.integrityScore >= 80 ? 'success' : 'warn'}
          />
          <StatCard
            label="Flyer Ready"
            value={stats.flyerReady}
            helper="Records with compounds and outcomes ready for public packaging."
            tone="default"
          />
          <StatCard
            label="Journal Coverage"
            value={stats.journalsCovered}
            helper={
              lastSyncAt
                ? `Last sync: ${new Date(lastSyncAt).toLocaleString()}`
                : 'No successful sync recorded yet.'
            }
            tone="default"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 border border-white/5 bg-[#111815] p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                  Credibility Control Surface
                </div>
                <div className="mt-1 text-sm text-white/65">
                  Use the overview to monitor whether the lab is operating as a research record
                  system, not just a UI for experiments.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setLabActiveTab('literature')}
                  className="px-3 py-2 bg-[#1A221E] border border-white/10 text-xs font-mono uppercase tracking-widest text-white/75 hover:text-white hover:bg-white/5"
                >
                  Add from Feeds
                </button>
                <button
                  onClick={() => setLabActiveTab('documents')}
                  className="px-3 py-2 bg-emerald-500 text-[#0A0F0D] text-xs font-mono uppercase tracking-widest font-bold hover:bg-emerald-400"
                >
                  Open Library
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="border border-white/5 bg-black/20 p-4">
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
                  Library State
                </div>
                <div className="mt-2 text-sm text-white">
                  {savingLibrary ? 'Persisting edits to research store...' : 'Library ready'}
                </div>
              </div>

              <div className="border border-white/5 bg-black/20 p-4">
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
                  Ingestion State
                </div>
                <div className="mt-2 text-sm text-white">
                  {ingesting ? 'Extracting and saving incoming paper...' : 'No active ingestion job'}
                </div>
              </div>

              <div className="border border-white/5 bg-black/20 p-4">
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
                  Audit Readiness
                </div>
                <div className="mt-2 text-sm text-white">
                  {stats.integrityScore >= 80
                    ? 'Research metadata is in strong shape.'
                    : 'Metadata completion needs improvement.'}
                </div>
              </div>
            </div>
          </div>

          <div className="border border-white/5 bg-[#111815] p-5 space-y-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
              Selected Paper
            </div>

            {selectedPaperSummary ? (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-white leading-snug">
                  {selectedPaperSummary.title}
                </div>
                <div className="text-xs text-white/50">{selectedPaperSummary.journal}</div>
                <div className="text-xs text-white/65">{selectedPaperSummary.authors}</div>
                <div className="text-xs font-mono text-emerald-300">
                  Compounds: {selectedPaperSummary.compounds}
                </div>
                <div className="text-sm text-white/70 leading-relaxed line-clamp-5">
                  {selectedPaperSummary.outcomes}
                </div>
                <button
                  onClick={() => setLabActiveTab('flyers')}
                  className="w-full px-3 py-2 bg-[#1A221E] border border-white/10 text-xs font-mono uppercase tracking-widest text-white/80 hover:text-white hover:bg-white/5"
                >
                  Package for Flyer
                </button>
              </div>
            ) : (
              <div className="text-sm text-white/50">
                No paper is selected yet. Choose a document to inspect or package.
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-white/5 pb-1">
          {TAB_CONFIG.map((tab) => (
            <TabButton
              key={tab.id}
              active={labActiveTab === tab.id}
              label={tab.label}
              icon={tab.icon}
              onClick={() => setLabActiveTab(tab.id)}
            />
          ))}
        </div>

        {booting ? (
          <div className="border border-white/5 bg-[#111815] p-8 text-center space-y-3">
            <div className="w-8 h-8 mx-auto border-2 border-emerald-400 border-t-transparent animate-spin" />
            <div className="text-sm text-white">Loading research lab...</div>
            <div className="text-xs text-white/45 font-mono uppercase tracking-widest">
              Synchronizing cached literature and integrity state
            </div>
          </div>
        ) : (
          <>
            {labActiveTab === 'overview' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Left Column: Operational Priorities and Actions */}
                <div className="space-y-6">
                  <div className="border border-white/5 bg-[#111815] p-6 space-y-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                      Operational Priorities
                    </div>

                    <div className="space-y-3">
                      <div className="border border-white/5 bg-black/20 p-4">
                        <div className="text-xs font-semibold text-white">1. Metadata completeness</div>
                        <div className="mt-1 text-sm text-white/60">
                          Every research record should have authors, journal, abstract, compounds,
                          outcomes, and publication year.
                        </div>
                      </div>

                      <div className="border border-white/5 bg-black/20 p-4">
                        <div className="text-xs font-semibold text-white">2. Persist every change</div>
                        <div className="mt-1 text-sm text-white/60">
                          Edits to library records should be treated as governed research updates,
                          not casual UI state changes.
                        </div>
                      </div>

                      <div className="border border-white/5 bg-black/20 p-4">
                        <div className="text-xs font-semibold text-white">3. Package trust visibly</div>
                        <div className="mt-1 text-sm text-white/60">
                          Only flyer-ready, metadata-complete papers should move to public-facing
                          publication assets.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border border-white/5 bg-[#111815] p-6 space-y-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                      Quick Actions
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => setLabActiveTab('pipeline')}
                        className="text-left border border-white/10 bg-[#1A221E] p-4 hover:bg-white/5"
                      >
                        <div className="text-xs font-semibold text-white">Run Research Pipeline</div>
                        <div className="mt-1 text-sm text-white/55">
                          Generate protocol-linked research outputs from active material flows.
                        </div>
                      </button>

                      <button
                        onClick={() => setLabActiveTab('literature')}
                        className="text-left border border-white/10 bg-[#1A221E] p-4 hover:bg-white/5"
                      >
                        <div className="text-xs font-semibold text-white">Ingest Literature</div>
                        <div className="mt-1 text-sm text-white/55">
                          Pull feed papers into the governed document library.
                        </div>
                      </button>

                      <button
                        onClick={() => setLabActiveTab('documents')}
                        className="text-left border border-white/10 bg-[#1A221E] p-4 hover:bg-white/5"
                      >
                        <div className="text-xs font-semibold text-white">Curate Library</div>
                        <div className="mt-1 text-sm text-white/55">
                          Normalize metadata, select canonical papers, and improve traceability.
                        </div>
                      </button>

                      <button
                        onClick={() => setLabActiveTab('csa')}
                        className="text-left border border-white/10 bg-[#1A221E] p-4 hover:bg-white/5"
                      >
                        <div className="text-xs font-semibold text-white">Review Audit State</div>
                        <div className="mt-1 text-sm text-white/55">
                          Keep credibility tied to compliance visibility, not just generated content.
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column: Swarm Trend & Insight Engine */}
                <div className="border border-white/5 bg-[#111815] p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                        Autonomous Swarm Trend & Insight Engine
                      </div>
                      <span className="text-[9px] font-mono bg-emerald-500/15 text-emerald-400 px-2 py-0.5 border border-emerald-500/20 animate-pulse uppercase tracking-widest flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-400 inline-block"></span>
                        Active
                      </span>
                    </div>

                    <p className="text-xs text-white/50 mb-4">
                      Continuous background swarm monitoring active. Scrapes peer-reviewed literature, identifies industry trends, generates compliance/kinetic insights, converts them to physical simulations, and authors research documents.
                    </p>

                    <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
                      {/* Trends Section */}
                      <div>
                        <div className="text-[9px] font-mono uppercase tracking-widest text-white/40 mb-2 border-b border-white/5 pb-1">
                          Detected Research Trends ({trends.length})
                        </div>
                        {loadingTrends ? (
                          <div className="text-xs text-white/30 italic">Refreshing trends database...</div>
                        ) : trends.length === 0 ? (
                          <div className="text-xs text-white/30 italic">No trends detected yet. Trigger a swarm run below.</div>
                        ) : (
                          <div className="space-y-2">
                            {trends.slice(0, 3).map((trend, i) => (
                              <div key={trend.id || i} className="bg-black/20 p-2.5 border border-white/5">
                                <div className="flex justify-between items-start gap-2">
                                  <span className="text-[10px] font-mono bg-emerald-400/10 text-emerald-300 border border-emerald-400/20 px-1 font-bold uppercase">{trend.category || "General"}</span>
                                  <span className="text-[10px] font-mono text-emerald-400">Growth: +{trend.growthRate}%</span>
                                </div>
                                <h4 className="text-xs font-semibold text-white mt-1.5">{trend.title}</h4>
                                <p className="text-[10px] text-white/55 mt-1 leading-normal">{trend.description}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Insights Section */}
                      <div>
                        <div className="text-[9px] font-mono uppercase tracking-widest text-white/40 mb-2 border-b border-white/5 pb-1">
                          Actionable Safety & Regulatory Insights ({insights.length})
                        </div>
                        {loadingTrends ? (
                          <div className="text-xs text-white/30 italic">Extracting telemetry logs...</div>
                        ) : insights.length === 0 ? (
                          <div className="text-xs text-white/30 italic">No insights extracted yet.</div>
                        ) : (
                          <div className="space-y-2">
                            {insights.slice(0, 3).map((ins, i) => {
                              const badgeStyle = ins.severity === 'CRITICAL' || ins.severity === 'HIGH' 
                                ? 'bg-red-500/10 text-red-300 border-red-500/20' 
                                : 'bg-amber-500/10 text-amber-300 border-amber-500/20';
                              return (
                                <div key={ins.id || i} className="bg-black/20 p-2.5 border border-white/5">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[9px] font-mono uppercase font-bold text-slate-400">Compounds: {ins.relatedCompounds?.join(", ")}</span>
                                    <span className={`text-[8px] font-mono border px-1.5 py-0.2 uppercase font-bold ${badgeStyle}`}>{ins.severity || "INFO"}</span>
                                  </div>
                                  <h4 className="text-xs font-semibold text-white mt-1.5">{ins.title}</h4>
                                  <p className="text-[10px] text-white/55 mt-1 leading-normal">{ins.summary}</p>
                                  {ins.implications && (
                                    <p className="text-[9px] text-amber-400/80 mt-1 font-mono italic leading-normal">Implication: {ins.implications}</p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/5 mt-4">
                    <button
                      onClick={triggerAutonomousSwarmPipeline}
                      disabled={runningAutonomousSwarm}
                      className="w-full px-3 py-2 bg-emerald-500 text-black hover:bg-emerald-400 disabled:bg-emerald-800 disabled:text-white/40 text-xs font-mono uppercase tracking-widest font-bold flex items-center justify-center gap-2"
                    >
                      {runningAutonomousSwarm ? (
                        <>
                          <RefreshCw size={12} className="animate-spin" />
                          Executing Pipeline...
                        </>
                      ) : (
                        <>
                          <Sparkles size={12} />
                          Force Swarm Ingest & Update
                        </>
                      )}
                    </button>
                    <div className="text-[8px] font-mono text-center text-white/30 uppercase mt-2 tracking-widest">
                      Automatically runs hourly in standard background cron job
                    </div>
                  </div>
                </div>
              </div>
            )}

            {labActiveTab === 'pipeline' && (
              <ResearchPipeline showLabNotification={showLabNotification} />
            )}

            {labActiveTab === 'simulators' && (
              <DecarbSimulatorTab
                allPapers={allPapers}
                showLabNotification={showLabNotification}
                onNavigateToTab={(tab) => setLabActiveTab(tab as LabTab)}
              />
            )}

            {labActiveTab === 'documents' && (
              <DocumentLibrary
                papers={allPapers}
                onPapersChange={handleLibraryChange}
                onPaperSelected={(paper) => setSelectedPaperEntity(paper)}
              />
            )}

            {labActiveTab === 'flyers' && (
              <FlyerCreator
                papers={allPapers}
                selectedPaperId={selectedPaperEntity?.id || allPapers[0]?.id || ''}
              />
            )}

            {labActiveTab === 'scheduler' && <ReportScheduler />}

            {labActiveTab === 'csa' && (
              <CsaWorkspaceTab onNavigateToTab={(tab) => setLabActiveTab(tab as LabTab)} />
            )}

            {labActiveTab === 'literature' && (
              <div className="space-y-6 animate-in fade-in duration-300 p-6 border border-white/5 bg-[#111815]">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                      Literature Intake
                    </div>
                    <div className="mt-1 text-sm text-white/60">
                      Feed discovery should end in a normalized, persistent, searchable research
                      record.
                    </div>
                  </div>

                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                    {ingesting ? 'Extraction active' : 'Ready for ingestion'}
                  </div>
                </div>

                <LiteratureFeeds onAddToLibrary={handleAddFromLiterature} />
              </div>
            )}
          </>
        )}
      </div>
    </PipelineProvider>
  );
}