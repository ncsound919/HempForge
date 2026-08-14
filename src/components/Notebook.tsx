import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { authFetch } from '../lib/firebase';
import {
  Notebook as NotebookIcon,
  Plus,
  Sparkles,
  GitMerge,
  AlertTriangle,
  Clock,
  FileSearch,
  Pin,
  X,
  Eye,
  EyeOff,
  Layers,
  Search,
  Network,
  BarChart3,
  Calendar,
  FileText,
  CheckCircle2,
} from 'lucide-react';

interface Source {
  id: string;
  kind: 'researchPaper' | 'coa' | 'report' | 'auditLog' | 'localDoc';
  title: string;
  authors?: string[];
  abstract?: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  url?: string;
  tags: { compounds: string[]; methods: string[]; regulatory: string[] };
  addedAt: string;
  rawTextLength: number;
}

interface PinnedNote {
  id: string;
  text: string;
  sourceId?: string;
  spanId?: string;
  pinnedAt: string;
}

interface Scope {
  included: string[];
  excluded: string[];
}

interface NotebookData {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  scope: Scope;
  sources: Source[];
  pinnedNotes: PinnedNote[];
  createdAt: string;
  updatedAt: string;
}

interface ArtifactSection {
  heading: string;
  body: string;
  citations: string[];
}

interface ArtifactTable {
  headers: string[];
  rows: Array<{ cells: Array<{ text: string; citations: string[] }> }>;
}

interface ArtifactGraph {
  nodes: Array<{ id: string; label: string; kind: string; weight: number }>;
  edges: Array<{ source: string; target: string; relation: string; weight: number }>;
}

interface Artifact {
  id: string;
  kind: string;
  jobName: string;
  generatedAt: string;
  scopedSourceCount: number;
  scopedSpanCount: number;
  sections: ArtifactSection[];
  table?: ArtifactTable;
  graph?: ArtifactGraph;
  provenance: { method: string; rulesFired: number; durationMs: number };
}

type JobName =
  | 'compare-findings'
  | 'contradiction-scan'
  | 'build-timeline'
  | 'evidence-matrix'
  | 'citation-graph'
  | 'review-paper';

const JOBS: Array<{ id: JobName; label: string; icon: any; description: string }> = [
  { id: 'compare-findings', label: 'Compare Findings', icon: GitMerge, description: 'Cluster spans by shared compound or method.' },
  { id: 'contradiction-scan', label: 'Contradiction Scan', icon: AlertTriangle, description: 'Surface spans that disagree numerically.' },
  { id: 'build-timeline', label: 'Build Timeline', icon: Calendar, description: 'Order sources by publication year.' },
  { id: 'evidence-matrix', label: 'Evidence Matrix', icon: BarChart3, description: 'Cross-tabulate compounds × methods.' },
  { id: 'citation-graph', label: 'Citation Graph', icon: Network, description: 'Cytoscape-compatible node/edge graph.' },
  { id: 'review-paper', label: 'Review Paper', icon: FileText, description: 'Deterministic structured paper with inline citations.' },
];

export default function Notebook() {
  const [notebooks, setNotebooks] = useState<NotebookData[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notebook, setNotebook] = useState<NotebookData | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [figure, setFigure] = useState<string | null>(null);
  const [runningJob, setRunningJob] = useState<JobName | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [search, setSearch] = useState('');
  const [refId, setRefId] = useState('');
  const [refKind, setRefKind] = useState<'researchPaper' | 'coa' | 'report' | 'auditLog'>('researchPaper');
  const [error, setError] = useState<string | null>(null);

  const loadNotebooks = useCallback(async () => {
    try {
      const res = await authFetch('/api/notebook');
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      setNotebooks(data.notebooks ?? []);
      if (!activeId && data.notebooks?.[0]) setActiveId(data.notebooks[0].id);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [activeId]);

  const loadNotebook = useCallback(async (id: string) => {
    try {
      const res = await authFetch(`/api/notebook/${id}`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      setNotebook(data);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    void loadNotebooks();
  }, [loadNotebooks]);

  useEffect(() => {
    if (activeId) void loadNotebook(activeId);
  }, [activeId, loadNotebook]);

  const createNotebook = async () => {
    if (!newTitle.trim()) return;
    const res = await authFetch('/api/notebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    if (res.ok) {
      setNewTitle('');
      void loadNotebooks();
    }
  };

  const addSource = async () => {
    if (!activeId || !refId.trim()) return;
    const res = await authFetch(`/api/notebook/${activeId}/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: refKind, refId: refId.trim() }),
    });
    if (res.ok) {
      setRefId('');
      void loadNotebook(activeId);
    } else {
      const body = await res.text();
      setError(`Add source failed: ${res.status} ${body.slice(0, 160)}`);
    }
  };

  const toggleSource = async (sourceId: string, currentlyIncluded: boolean) => {
    if (!activeId) return;
    await authFetch(`/api/notebook/${activeId}/scope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, included: !currentlyIncluded }),
    });
    void loadNotebook(activeId);
  };

  const pinNote = async () => {
    if (!activeId || !noteText.trim()) return;
    await authFetch(`/api/notebook/${activeId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: noteText.trim() }),
    });
    setNoteText('');
    void loadNotebook(activeId);
  };

  const removeNote = async (noteId: string) => {
    if (!activeId) return;
    await authFetch(`/api/notebook/${activeId}/notes/${noteId}`, { method: 'DELETE' });
    void loadNotebook(activeId);
  };

  const runJob = async (job: JobName) => {
    if (!activeId) return;
    setRunningJob(job);
    try {
      const res = await authFetch(`/api/notebook/${activeId}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job }),
      });
      if (res.ok) {
        const artifact: Artifact = await res.json();
        setArtifacts((prev) => [artifact, ...prev].slice(0, 10));

        // Generate figure for jobs that have visuals
        if (job === 'citation-graph' || job === 'evidence-matrix' || job === 'build-timeline') {
          const figRes = await authFetch(`/api/notebook/${activeId}/figure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artifactId: artifact.id, figKind: job === 'citation-graph' ? 'citation-network' : job === 'evidence-matrix' ? 'evidence-matrix' : 'timeline' }),
          });
          if (figRes.ok) {
            const fig = await figRes.json();
            setFigure(fig.svg);
          }
        } else {
          setFigure(null);
        }
      }
    } finally {
      setRunningJob(null);
    }
  };

  const renderPanel = async (artifactId: string) => {
    if (!activeId) return;
    const res = await authFetch(`/api/notebook/${activeId}/figure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifactId, figKind: 'panel' }),
    });
    if (res.ok) {
      const fig = await res.json();
      setFigure(fig.svg);
    }
  };

  const scopedSources = useMemo(() => {
    if (!notebook) return [];
    return notebook.sources.filter((s) => !notebook.scope.excluded.includes(s.id));
  }, [notebook]);

  const filteredSources = useMemo(() => {
    if (!notebook) return [];
    const q = search.trim().toLowerCase();
    return notebook.sources.filter((s) => {
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        (s.tags.compounds || []).some((c) => c.toLowerCase().includes(q)) ||
        (s.tags.methods || []).some((m) => m.toLowerCase().includes(q)) ||
        (s.tags.regulatory || []).some((r) => r.toLowerCase().includes(q))
      );
    });
  }, [notebook, search]);

  if (!notebook) {
    return (
      <div className="p-8 text-slate-300">
        <h1 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
          <NotebookIcon size={22} className="text-emerald-400" />
          Notebook
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          Source-grounded synthesis. Add papers, COAs, reports, and audits; pick a synthesis job; export a paper.
        </p>
        <div className="bg-white/5 border border-emerald-700/30 rounded p-4 max-w-md">
          <label className="block text-xs text-emerald-400 uppercase tracking-wider mb-2">New notebook</label>
          <div className="flex gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. THCV evidence review"
              className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white"
            />
            <button onClick={createNotebook} className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] font-bold px-4 py-2 rounded text-sm">
              Create
            </button>
          </div>
          {notebooks.length > 0 && (
            <div className="mt-4 space-y-1">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Existing</div>
              {notebooks.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setActiveId(n.id)}
                  className="block w-full text-left px-3 py-2 rounded hover:bg-white/5 text-sm"
                >
                  <div className="text-white">{n.title}</div>
                  <div className="text-[11px] text-slate-500">
                    {(n as any).sourceCount ?? n.sources?.length ?? 0} sources · {(n as any).pinnedCount ?? n.pinnedNotes?.length ?? 0} notes
                  </div>
                </button>
              ))}
            </div>
          )}
          {error && <div className="mt-4 text-xs text-red-400">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-6 p-8 text-slate-300">
      {/* Sidebar — sources */}
      <aside className="col-span-4 bg-white/5 border border-white/10 rounded p-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs text-emerald-400 uppercase tracking-widest font-bold flex items-center gap-2">
            <Layers size={14} /> Sources ({scopedSources.length}/{notebook.sources.length})
          </h2>
          <span className="text-[10px] text-slate-500">{notebook.title}</span>
        </div>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by compound, method, or text"
            className="w-full bg-black/40 border border-white/10 rounded pl-8 pr-3 py-2 text-xs"
          />
        </div>

        <div className="bg-black/30 border border-emerald-700/20 rounded p-2 mb-3">
          <div className="text-[10px] text-emerald-400 uppercase mb-1">Add source by ID</div>
          <select
            value={refKind}
            onChange={(e) => setRefKind(e.target.value as any)}
            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs mb-1"
          >
            <option value="researchPaper">researchPaper</option>
            <option value="coa">coa</option>
            <option value="report">report</option>
            <option value="auditLog">auditLog</option>
          </select>
          <div className="flex gap-1">
            <input
              value={refId}
              onChange={(e) => setRefId(e.target.value)}
              placeholder="id (e.g. pmid:12345 or coa-...)"
              className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs"
            />
            <button onClick={addSource} className="bg-emerald-700 hover:bg-emerald-600 text-white px-2 rounded text-xs">
              <Plus size={12} />
            </button>
          </div>
        </div>

        <div className="space-y-1">
          {filteredSources.map((s) => {
            const included = !notebook.scope.excluded.includes(s.id);
            return (
              <div
                key={s.id}
                className={`bg-black/30 border rounded p-2 text-xs ${included ? 'border-white/10' : 'border-white/5 opacity-50'}`}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => toggleSource(s.id, included)}
                    className="mt-0.5 text-emerald-400 hover:text-emerald-300"
                    title={included ? 'In scope — click to exclude' : 'Out of scope — click to include'}
                  >
                    {included ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-white truncate">{s.title}</div>
                    <div className="text-[10px] text-slate-500">
                      {s.kind} {s.year ? `· ${s.year}` : ''} · {s.rawTextLength} chars
                    </div>
                    {s.tags.compounds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.tags.compounds.slice(0, 3).map((c) => (
                          <span key={c} className="bg-emerald-900/40 text-emerald-300 px-1.5 py-0.5 rounded text-[10px]">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredSources.length === 0 && (
            <div className="text-xs text-slate-500 italic text-center py-6">
              No sources match. Add one above, or change the filter.
            </div>
          )}
        </div>
      </aside>

      {/* Center — synthesis jobs + artifacts */}
      <main className="col-span-8 space-y-6 max-h-[80vh] overflow-y-auto pr-2">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{notebook.title}</h1>
            {notebook.description && (
              <p className="text-sm text-slate-400 mt-1">{notebook.description}</p>
            )}
          </div>
          <div className="text-[11px] text-slate-500 text-right">
            <div>Created {new Date(notebook.createdAt).toLocaleDateString()}</div>
            <div>Updated {new Date(notebook.updatedAt).toLocaleString()}</div>
          </div>
        </header>

        <section className="bg-white/5 border border-white/10 rounded p-4">
          <h3 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-3 flex items-center gap-2">
            <Sparkles size={14} /> Synthesis Jobs
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {JOBS.map((job) => {
              const Icon = job.icon;
              const running = runningJob === job.id;
              return (
                <button
                  key={job.id}
                  onClick={() => runJob(job.id)}
                  disabled={running || scopedSources.length === 0}
                  className="bg-black/30 hover:bg-emerald-900/30 disabled:opacity-50 border border-white/10 hover:border-emerald-500/50 rounded p-3 text-left transition-colors"
                >
                  <div className="flex items-center gap-2 text-white text-sm font-medium mb-1">
                    <Icon size={14} className="text-emerald-400" />
                    {job.label}
                    {running && <Loader2 className="ml-auto animate-spin" size={12} />}
                  </div>
                  <div className="text-[11px] text-slate-400">{job.description}</div>
                </button>
              );
            })}
          </div>
          {scopedSources.length === 0 && (
            <div className="mt-3 text-xs text-orange-400">
              Add at least one source and toggle it in scope before running a job.
            </div>
          )}
        </section>

        {figure && (
          <section className="bg-white/5 border border-emerald-700/30 rounded p-4">
            <h3 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-3">Figure</h3>
            <div className="bg-[#020617] rounded p-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: figure }} />
          </section>
        )}

        {artifacts.length > 0 && (
          <section className="bg-white/5 border border-white/10 rounded p-4">
            <h3 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-3 flex items-center gap-2">
              <FileSearch size={14} /> Artifacts
            </h3>
            <div className="space-y-3">
              {artifacts.map((a) => (
                <article key={a.id} className="bg-black/30 border border-white/10 rounded p-3">
                  <header className="flex items-center justify-between mb-2">
                    <div className="text-sm text-white font-medium">{a.jobName}</div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => renderPanel(a.id)}
                        className="text-[11px] text-emerald-400 hover:text-emerald-300"
                      >
                        Render panel
                      </button>
                      <span className="text-[10px] text-slate-500">
                        {new Date(a.generatedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </header>

                  {a.sections.map((s, i) => (
                    <div key={i} className="mt-2">
                      <div className="text-xs text-emerald-300 font-medium mb-1">{s.heading}</div>
                      <pre className="text-[11px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{s.body}</pre>
                      {s.citations.length > 0 && (
                        <div className="text-[10px] text-slate-500 mt-1">
                          Citations: {s.citations.slice(0, 6).join(', ')}{s.citations.length > 6 ? `, +${s.citations.length - 6} more` : ''}
                        </div>
                      )}
                    </div>
                  ))}

                  {a.table && (
                    <details className="mt-2">
                      <summary className="text-[11px] text-emerald-400 cursor-pointer">Evidence matrix ({a.table.headers.length} cols × {a.table.rows.length} rows)</summary>
                      <div className="overflow-x-auto mt-2">
                        <table className="text-[10px] text-slate-300 border-collapse">
                          <thead>
                            <tr>
                              {a.table.headers.map((h) => (
                                <th key={h} className="bg-white/5 px-2 py-1 text-left border border-white/10">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {a.table.rows.map((r, ri) => (
                              <tr key={ri}>
                                {r.cells.map((c, ci) => (
                                  <td key={ci} className="bg-black/30 px-2 py-1 border border-white/10 align-top max-w-[200px]">
                                    {c.text}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}

                  {a.graph && (
                    <details className="mt-2">
                      <summary className="text-[11px] text-emerald-400 cursor-pointer">Citation graph ({a.graph.nodes.length} nodes · {a.graph.edges.length} edges)</summary>
                      <div className="text-[10px] text-slate-400 mt-1">
                        Edges by relation: {Array.from(new Set(a.graph.edges.map((e) => e.relation))).map((r) => `${r}=${a.graph!.edges.filter((e) => e.relation === r).length}`).join(', ')}
                      </div>
                    </details>
                  )}

                  <footer className="text-[10px] text-slate-500 mt-2 pt-2 border-t border-white/10 flex items-center gap-3">
                    <span>{a.scopedSourceCount} sources · {a.scopedSpanCount} spans</span>
                    <span>{a.provenance.method}</span>
                    <span className="ml-auto">{a.provenance.durationMs}ms · {a.provenance.rulesFired} rules</span>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Right rail — pinned notes */}
      <aside className="col-span-12 md:col-span-12 lg:col-span-12 hidden">
        {/* placeholder for layout compatibility — pinned notes below */}
      </aside>

      {/* Pinned notes — full width below */}
      <section className="col-span-12 bg-white/5 border border-white/10 rounded p-4">
        <h3 className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-3 flex items-center gap-2">
          <Pin size={14} /> Pinned Notes ({notebook.pinnedNotes.length})
        </h3>
        <div className="flex gap-2 mb-3">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Pin a note (linked to current source scope)…"
            className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm"
          />
          <button onClick={pinNote} className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] font-bold px-4 py-2 rounded text-sm">
            Pin
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {notebook.pinnedNotes.map((n) => (
            <div key={n.id} className="bg-black/30 border border-white/10 rounded p-3 relative">
              <button
                onClick={() => removeNote(n.id)}
                className="absolute top-2 right-2 text-slate-500 hover:text-red-400"
              >
                <X size={12} />
              </button>
              <div className="text-xs text-slate-300 pr-6">{n.text}</div>
              <div className="text-[10px] text-slate-500 mt-2">
                {new Date(n.pinnedAt).toLocaleString()}
                {n.sourceId && ` · ${n.sourceId}`}
              </div>
            </div>
          ))}
          {notebook.pinnedNotes.length === 0 && (
            <div className="col-span-full text-xs text-slate-500 italic text-center py-4">
              No pinned notes. Pin reusable insights from synthesis runs.
            </div>
          )}
        </div>
      </section>

      {error && (
        <div className="col-span-12 bg-red-900/30 border border-red-700/40 rounded p-3 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

function Loader2(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size || 16}
      height={props.size || 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}