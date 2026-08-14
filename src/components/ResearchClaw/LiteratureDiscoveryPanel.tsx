import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen, Bookmark, ChevronDown, ChevronRight, ExternalLink, FileText,
  Filter, Globe, Loader2, RefreshCw, Search, SlidersHorizontal, Star, Users,
} from 'lucide-react';

interface LiteraturePaper {
  id: string;
  title: string;
  authors?: { name: string; affiliation?: string }[];
  year?: number;
  abstract?: string;
  venue?: string;
  citation_count?: number;
  doi?: string;
  arxiv_id?: string;
  url?: string;
  source?: string;
  relevance_score?: number;
  keywords?: string[];
}

export default function LiteratureDiscoveryPanel() {
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LiteraturePaper | null>(null);
  const [booting, setBooting] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'citations' | 'year' | 'relevance'>('citations');
  const [expanded, setExpanded] = useState(true);

  const fetchPapers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/researchclaw/runs');
      if (res.ok) {
        const data = await res.json();
        const runs = data.runs || [];
        if (runs.length > 0) {
          const latest = runs[0];
          const detailRes = await fetch(`/api/researchclaw/pipelines/${latest.run_id}`);
          if (detailRes.ok) {
            const detail = await detailRes.json();
          }
          const resultsRes = await fetch(`/api/researchclaw/pipelines/${latest.run_id}/results`);
          if (resultsRes.ok) {
            const results = await resultsRes.json();
            const metrics = results.metrics || {};
            const candidatePapers = metrics.papers || metrics.candidates || metrics.shortlist || [];
            if (Array.isArray(candidatePapers) && candidatePapers.length > 0) {
              setPapers(candidatePapers);
            }
          }
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPapers().finally(() => setBooting(false));
  }, [fetchPapers]);

  const filtered = papers
    .filter((p) => {
      if (sourceFilter !== 'all' && p.source !== sourceFilter) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        return p.title?.toLowerCase().includes(q) || p.abstract?.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'citations') return (b.citation_count || 0) - (a.citation_count || 0);
      if (sortBy === 'year') return (b.year || 0) - (a.year || 0);
      return (b.relevance_score || 0) - (a.relevance_score || 0);
    });

  const sources = [...new Set(papers.map((p) => p.source).filter(Boolean))];

  if (booting) {
    return (
      <div className="border border-white/5 bg-[#111815] p-8 text-center space-y-3">
        <div className="w-8 h-8 mx-auto border-2 border-emerald-400 border-t-transparent animate-spin" />
        <div className="text-sm text-white">Loading literature discoveries...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-white/10 pb-6 flex flex-col xl:flex-row xl:items-end justify-between gap-5">
        <div className="space-y-2">
          <h2 className="text-3xl font-display font-bold text-white tracking-tight italic">
            Literature Discovery
          </h2>
          <p className="text-white/45 font-mono text-xs uppercase tracking-widest max-w-3xl">
            Discovered papers from pipeline literature search stages
          </p>
        </div>
        <button
          onClick={fetchPapers}
          disabled={loading}
          className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-50 flex items-center gap-1.5"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search titles and abstracts..."
            className="w-full pl-8 pr-3 py-2 bg-black/40 border border-white/10 text-white text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={12} className="text-slate-500" />
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-2 py-2 bg-black/40 border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-emerald-500/40"
          >
            <option value="all">All Sources</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <SlidersHorizontal size={12} className="text-slate-500 ml-2" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-2 py-2 bg-black/40 border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-emerald-500/40"
          >
            <option value="citations">By Citations</option>
            <option value="year">By Year</option>
            <option value="relevance">By Relevance</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 border border-white/5 bg-[#111815]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
              Papers ({filtered.length})
            </div>
            <button onClick={() => setExpanded(!expanded)} className="text-slate-500 hover:text-white">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          </div>
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 size={20} className="animate-spin text-emerald-400 mx-auto" />
              <div className="mt-2 text-xs text-slate-500">Searching literature sources...</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <BookOpen size={24} className="text-slate-600 mx-auto" />
              <div className="mt-2 text-xs text-slate-500">No papers found. Start a pipeline to discover literature.</div>
            </div>
          ) : (
            <div className="divide-y divide-white/5 max-h-[600px] overflow-y-auto">
              {filtered.map((paper) => (
                <button
                  key={paper.id}
                  onClick={() => setSelected(paper)}
                  className={`w-full text-left px-5 py-4 hover:bg-white/5 transition-colors ${selected?.id === paper.id ? 'bg-emerald-500/5 border-l-2 border-emerald-500' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white leading-snug line-clamp-2">{paper.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500">
                        {paper.source && (
                          <span className="bg-black/40 px-1.5 py-0.5 border border-white/5 uppercase tracking-wider">{paper.source}</span>
                        )}
                        {paper.year && <span>{paper.year}</span>}
                        {paper.venue && <span className="truncate max-w-[150px]">{paper.venue}</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
                        {paper.authors && paper.authors.length > 0 && (
                          <span className="flex items-center gap-1"><Users size={10} />{paper.authors.slice(0, 3).map((a) => a.name).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}</span>
                        )}
                        {paper.citation_count !== undefined && (
                          <span className="flex items-center gap-1"><Star size={10} />{paper.citation_count}</span>
                        )}
                      </div>
                    </div>
                    {paper.doi && (
                      <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 p-1.5 text-slate-500 hover:text-emerald-400"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border border-white/5 bg-[#111815] p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400 mb-4">
            Paper Detail
          </div>
          {selected ? (
            <div className="space-y-4">
              <div className="text-sm font-semibold text-white leading-snug">{selected.title}</div>
              {selected.authors && selected.authors.length > 0 && (
                <div className="text-xs text-slate-400">
                  {selected.authors.map((a) => a.name).join(', ')}
                  {selected.authors.some((a) => a.affiliation) && (
                    <div className="mt-1 text-[10px] text-slate-500">
                      {selected.authors.filter((a) => a.affiliation).map((a) => `${a.name} (${a.affiliation})`).join('; ')}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                {selected.year && <span className="bg-black/40 px-2 py-1 border border-white/5 text-slate-400">{selected.year}</span>}
                {selected.source && <span className="bg-black/40 px-2 py-1 border border-white/5 text-slate-400 uppercase">{selected.source}</span>}
                {selected.citation_count !== undefined && <span className="bg-black/40 px-2 py-1 border border-white/5 text-emerald-400">{selected.citation_count} citations</span>}
                {selected.venue && <span className="bg-black/40 px-2 py-1 border border-white/5 text-slate-400 truncate max-w-[150px]">{selected.venue}</span>}
              </div>
              {selected.abstract && (
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">Abstract</div>
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-10">{selected.abstract}</p>
                </div>
              )}
              <div className="flex gap-2">
                {selected.doi && (
                  <a href={`https://doi.org/${selected.doi}`} target="_blank" rel="noopener noreferrer" className="flex-1 px-3 py-2 bg-emerald-500 text-black text-xs font-mono uppercase tracking-widest font-bold hover:bg-emerald-400 text-center flex items-center justify-center gap-2">
                    <Globe size={12} />
                    DOI
                  </a>
                )}
                {selected.arxiv_id && (
                  <a href={`https://arxiv.org/abs/${selected.arxiv_id}`} target="_blank" rel="noopener noreferrer" className="flex-1 px-3 py-2 bg-black/40 border border-white/10 text-white text-xs font-mono uppercase tracking-widest hover:bg-white/5 text-center flex items-center justify-center gap-2">
                    <FileText size={12} />
                    arXiv
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500 text-center py-8">
              <BookOpen size={24} className="mx-auto mb-2 text-slate-600" />
              Select a paper to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
