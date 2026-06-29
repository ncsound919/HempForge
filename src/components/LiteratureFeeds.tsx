import React, { useMemo, useState } from 'react';
import {
  Search,
  BookOpen,
  Download,
  ExternalLink,
  Zap,
  GitCompare,
  FlaskConical,
  FileSearch,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Microscope,
  ShieldCheck,
  Layers3,
  Sparkles,
} from 'lucide-react';
import { authFetch } from '../lib/firebase';

export interface ResearchPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  doi?: string;
  pmid?: string;
  url: string;
  fullTextUrl?: string;
  source: string;
  publishedDate: string;
  journal?: string;
  keywords: string[];
  citationCount?: number;
  isOpenAccess: boolean;
}

export interface LiteratureAnalysis {
  summary: string;
  methods: string[];
  compounds: string[];
  complianceSignals: string[];
  hypotheses: string[];
  confidence: number;
}

export interface CrossReferenceMatch {
  id: string;
  title: string;
  source: string;
  score: number;
  reason: string;
}

export interface CrossReferenceReport {
  duplicateRisk: 'low' | 'medium' | 'high';
  conflictingSignals: string[];
  matches: CrossReferenceMatch[];
}

export interface ExperimentPlan {
  title: string;
  objective: string;
  modelType: string;
  variables: string[];
  endpoints: string[];
  protocolSteps: string[];
  safetyNotes: string[];
}

interface LiteratureFeedsProps {
  onAddToLibrary: (paper: ResearchPaper) => void | Promise<void>;
  onCreateExperimentPlan?: (plan: ExperimentPlan, paper: ResearchPaper) => void;
}

const DEFAULT_QUERIES = [
  'cannabidiol bioavailability',
  'hemp safety toxicology',
  'THC pharmacokinetics',
  'cannabis regulatory compliance',
  'cannabinoid receptor agonist',
  'hemp extraction supercritical CO2',
];

const SOURCE_COLOR: Record<string, string> = {
  pubmed: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  openalex: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  europepmc: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
  semanticscholar: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
};

const KNOWN_COMPOUNDS = [
  'THCa',
  'Δ9-THC',
  'Delta-9 THC',
  'THC',
  'CBD',
  'CBDa',
  'CBC',
  'CBG',
  'CBN',
  'CBDA',
  'Myrcene',
  'Linalool',
  'Beta-caryophyllene',
  'Caryophyllene',
  'Terpenes',
];

function normalizeTitle(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenize(input: string) {
  return normalizeTitle(input)
    .split(' ')
    .filter((token) => token.length > 2);
}

function titleOverlapScore(a: string, b: string) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}

function extractCompounds(paper: ResearchPaper) {
  const haystack = `${paper.title} ${paper.abstract} ${(paper.keywords || []).join(' ')}`.toLowerCase();

  return KNOWN_COMPOUNDS.filter((compound) =>
    haystack.includes(compound.toLowerCase())
  );
}

function buildFallbackAnalysis(paper: ResearchPaper): LiteratureAnalysis {
  const compounds = extractCompounds(paper);
  const abstract = paper.abstract || '';

  const complianceSignals = [
    /compliance|regulatory|limit|threshold|safety/i.test(abstract) ? 'Mentions regulatory or safety framing.' : '',
    /toxic|toxicity|adverse/i.test(abstract) ? 'Contains toxicology or adverse-event language.' : '',
    /pharmacokinetic|bioavailability|absorption/i.test(abstract) ? 'Contains PK or bioavailability signals.' : '',
    /decarb|decarboxyl/i.test(abstract) ? 'Contains thermal conversion or decarboxylation relevance.' : '',
  ].filter(Boolean);

  const methods = [
    /in vitro|cell/i.test(abstract) ? 'In vitro or cell-based model.' : '',
    /animal|murine|mouse|rat/i.test(abstract) ? 'Preclinical animal model.' : '',
    /clinical|human|patient/i.test(abstract) ? 'Human or clinical signal present.' : '',
    /review|systematic/i.test(abstract) ? 'Review-style evidence source.' : '',
  ].filter(Boolean);

  return {
    summary:
      abstract.length > 220 ? `${abstract.slice(0, 220).trim()}...` : abstract || 'No abstract was available for analysis.',
    methods: methods.length ? methods : ['Method not confidently inferred from abstract alone.'],
    compounds: compounds.length ? compounds : ['No known hemp compounds confidently extracted.'],
    complianceSignals: complianceSignals.length
      ? complianceSignals
      : ['No explicit compliance signals were found in the abstract.'],
    hypotheses: [
      compounds.length
        ? `Test whether ${compounds.slice(0, 2).join(' + ')} changes observed endpoint strength under controlled dosing.`
        : 'Test whether the reported intervention changes potency, safety, or receptor response under controlled conditions.',
      'Compare literature claim against your internal COA, potency, and stability data.',
    ],
    confidence: abstract ? 68 : 40,
  };
}

function buildLocalCrossReference(
  target: ResearchPaper,
  corpus: ResearchPaper[]
): CrossReferenceReport {
  const matches = corpus
    .filter((paper) => paper.id !== target.id)
    .map((paper) => {
      const sameDoi = Boolean(target.doi && paper.doi && target.doi === paper.doi);
      const samePmid = Boolean(target.pmid && paper.pmid && target.pmid === paper.pmid);
      const titleScore = titleOverlapScore(target.title, paper.title);

      let score = 0;
      let reason = 'Low textual overlap.';

      if (sameDoi || samePmid) {
        score = 0.99;
        reason = 'Exact DOI/PMID match detected.';
      } else if (titleScore >= 0.8) {
        score = titleScore;
        reason = 'Very high title overlap; likely duplicate or near-duplicate coverage.';
      } else if (titleScore >= 0.45) {
        score = titleScore;
        reason = 'Moderate thematic overlap; useful cross-reference candidate.';
      }

      return {
        id: paper.id,
        title: paper.title,
        source: paper.source,
        score,
        reason,
      };
    })
    .filter((item) => item.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const duplicateRisk: CrossReferenceReport['duplicateRisk'] =
    matches.some((m) => m.score >= 0.95) ? 'high' : matches.length >= 3 ? 'medium' : 'low';

  const conflictingSignals = [
    target.isOpenAccess ? 'Open-access evidence available for direct inspection.' : 'Primary full text may require external access.',
    target.citationCount !== undefined && target.citationCount < 3
      ? 'Low citation count; treat as emerging evidence.'
      : '',
    matches.length === 0 ? 'No strong overlap found in current result set.' : '',
  ].filter(Boolean);

  return {
    duplicateRisk,
    conflictingSignals,
    matches,
  };
}

function buildFallbackExperiment(
  paper: ResearchPaper,
  analysis: LiteratureAnalysis
): ExperimentPlan {
  const primaryCompounds = analysis.compounds.slice(0, 3).join(', ') || 'target compounds';

  return {
    title: `Validation protocol for: ${paper.title}`,
    objective: `Validate whether the literature claim in "${paper.title}" holds under controlled in-house conditions.`,
    modelType: /clinical|human|patient/i.test(paper.abstract)
      ? 'Observational replication / human evidence review'
      : /in vitro|cell/i.test(paper.abstract)
      ? 'In vitro bench experiment'
      : 'Pilot assay / evidence translation protocol',
    variables: [
      'Starting cannabinoid profile',
      'Dose or concentration range',
      'Temperature / time where relevant',
      'Outcome endpoint response',
      'Compliance threshold exposure',
    ],
    endpoints: [
      'Primary effect size against control',
      'Potency stability before and after processing',
      'Any compliance-relevant threshold changes',
      'Replicability across repeated runs',
    ],
    protocolSteps: [
      `Extract structured variables from the paper and isolate ${primaryCompounds}.`,
      'Define a control group and at least one test condition.',
      'Run triplicate measurements with timestamped batch logging.',
      'Record potency, response endpoint, and any degradation or conversion behavior.',
      'Compare internal results against literature claims and archive deviation notes.',
    ],
    safetyNotes: [
      'Do not treat literature claims as validated until internal replication succeeds.',
      'Flag any claim touching THC thresholds, toxicity, or serving limits for compliance review.',
    ],
  };
}

export default function LiteratureFeeds({
  onAddToLibrary,
  onCreateExperimentPlan,
}: LiteratureFeedsProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResearchPaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());

  // Autonomous Swarm Integration States
  const [runningSwarm, setRunningSwarm] = useState(false);
  const [swarmSuccess, setSwarmSuccess] = useState('');
  const [swarmError, setSwarmError] = useState('');

  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [analysisById, setAnalysisById] = useState<Record<string, LiteratureAnalysis>>({});
  const [crossRefById, setCrossRefById] = useState<Record<string, CrossReferenceReport>>({});
  const [experimentById, setExperimentById] = useState<Record<string, ExperimentPlan>>({});
  const [runningById, setRunningById] = useState<Record<string, boolean>>({});
  const [pipelineErrorById, setPipelineErrorById] = useState<Record<string, string>>({});

  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [sortMode, setSortMode] = useState<'relevance' | 'recent' | 'citations'>('relevance');

  const selectedPaper = useMemo(
    () => results.find((paper) => paper.id === selectedPaperId) || results[0] || null,
    [results, selectedPaperId]
  );

  const filteredResults = useMemo(() => {
    const items = results.filter((paper) => {
      if (sourceFilter !== 'all' && paper.source !== sourceFilter) return false;
      if (openOnly && !paper.isOpenAccess) return false;
      return true;
    });

    if (sortMode === 'recent') {
      return [...items].sort((a, b) => (b.publishedDate || '').localeCompare(a.publishedDate || ''));
    }

    if (sortMode === 'citations') {
      return [...items].sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
    }

    return items;
  }, [results, sourceFilter, openOnly, sortMode]);

  const search = async (q: string) => {
    if (!q.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await authFetch('/api/literature/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.details || 'Failed to fetch results');
      }

      const papers = Array.isArray(data.papers) ? data.papers : [];
      setResults(papers);
      setSelectedPaperId(papers[0]?.id || null);
    } catch (e: any) {
      setError(e.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const runAutonomousSwarm = async () => {
    if (!query.trim()) {
      setSwarmError('Please enter or select a query first.');
      return;
    }
    setRunningSwarm(true);
    setSwarmSuccess('');
    setSwarmError('');
    try {
      const res = await authFetch('/api/literature/run-autonomous-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to trigger autonomous research swarm.');
      }
      setSwarmSuccess(`Successfully executed autonomous swarm analysis! Swarm ingested live papers for query '${query}' and generated corresponding trends, safety insights, physical simulations, and draft research documents.`);
    } catch (e: any) {
      setSwarmError(e.message || 'Error executing swarm pipeline.');
    } finally {
      setRunningSwarm(false);
    }
  };

  const handleAdd = async (paper: ResearchPaper) => {
    await onAddToLibrary(paper);
    setAdded((prev) => new Set(prev).add(paper.id));
  };

  const runPipeline = async (paper: ResearchPaper) => {
    setSelectedPaperId(paper.id);
    setRunningById((prev) => ({ ...prev, [paper.id]: true }));
    setPipelineErrorById((prev) => ({ ...prev, [paper.id]: '' }));

    let analysis = buildFallbackAnalysis(paper);
    let crossRef = buildLocalCrossReference(paper, results);
    let experiment = buildFallbackExperiment(paper, analysis);

    try {
      const [analysisRes, crossRes, experimentRes] = await Promise.allSettled([
        authFetch('/api/literature/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paper }),
        }),
        authFetch('/api/literature/cross-reference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paper, corpus: results }),
        }),
        authFetch('/api/literature/experiment-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paper }),
        }),
      ]);

      if (analysisRes.status === 'fulfilled' && analysisRes.value.ok) {
        const data = await analysisRes.value.json();
        analysis = {
          summary: data.summary || analysis.summary,
          methods: Array.isArray(data.methods) ? data.methods : analysis.methods,
          compounds: Array.isArray(data.compounds) ? data.compounds : analysis.compounds,
          complianceSignals: Array.isArray(data.complianceSignals)
            ? data.complianceSignals
            : analysis.complianceSignals,
          hypotheses: Array.isArray(data.hypotheses) ? data.hypotheses : analysis.hypotheses,
          confidence:
            typeof data.confidence === 'number' ? data.confidence : analysis.confidence,
        };
      }

      if (crossRes.status === 'fulfilled' && crossRes.value.ok) {
        const data = await crossRes.value.json();
        crossRef = {
          duplicateRisk: data.duplicateRisk || crossRef.duplicateRisk,
          conflictingSignals: Array.isArray(data.conflictingSignals)
            ? data.conflictingSignals
            : crossRef.conflictingSignals,
          matches: Array.isArray(data.matches) ? data.matches : crossRef.matches,
        };
      }

      if (experimentRes.status === 'fulfilled' && experimentRes.value.ok) {
        const data = await experimentRes.value.json();
        experiment = {
          title: data.title || experiment.title,
          objective: data.objective || experiment.objective,
          modelType: data.modelType || experiment.modelType,
          variables: Array.isArray(data.variables) ? data.variables : experiment.variables,
          endpoints: Array.isArray(data.endpoints) ? data.endpoints : experiment.endpoints,
          protocolSteps: Array.isArray(data.protocolSteps)
            ? data.protocolSteps
            : experiment.protocolSteps,
          safetyNotes: Array.isArray(data.safetyNotes)
            ? data.safetyNotes
            : experiment.safetyNotes,
        };
      }
    } catch (e: any) {
      setPipelineErrorById((prev) => ({
        ...prev,
        [paper.id]: e.message || 'Pipeline failed; fallback analysis was used.',
      }));
    } finally {
      setAnalysisById((prev) => ({ ...prev, [paper.id]: analysis }));
      setCrossRefById((prev) => ({ ...prev, [paper.id]: crossRef }));
      setExperimentById((prev) => ({ ...prev, [paper.id]: experiment }));
      setRunningById((prev) => ({ ...prev, [paper.id]: false }));
    }
  };

  const runBatchPipeline = async () => {
    for (const paper of filteredResults.slice(0, 5)) {
      await runPipeline(paper);
    }
  };

  const queueExperiment = (paper: ResearchPaper) => {
    const analysis = analysisById[paper.id] || buildFallbackAnalysis(paper);
    const plan = experimentById[paper.id] || buildFallbackExperiment(paper, analysis);

    onCreateExperimentPlan?.(plan, paper);
  };

  const duplicateRiskColor: Record<'low' | 'medium' | 'high', string> = {
    low: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    high: 'text-red-400 bg-red-500/10 border-red-500/20',
  };

  return (
    <div className="space-y-6" id="literature-feeds-container">
      <div className="border border-white/5 bg-[#111815] p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
              <Microscope size={15} />
              Literature Analysis Console
            </h3>
            <p className="text-xs text-white/45 mt-1 max-w-2xl">
              Search global research indices, analyze evidence quality, cross-reference overlap,
              and turn papers into experiment-ready plans.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={runBatchPipeline}
              disabled={loading || filteredResults.length === 0}
              className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50"
            >
              Run top 5 pipeline
            </button>
          </div>
        </div>

        <div className="flex gap-2" id="lit-search-bar">
          <input
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
            placeholder="Search PubMed, OpenAlex, Europe PMC..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search(query)}
            id="lit-query-input"
          />
          <button
            onClick={() => search(query)}
            disabled={loading}
            className="bg-emerald-500 hover:bg-emerald-400 text-black font-mono text-xs uppercase font-bold px-5 py-2.5 rounded-lg flex items-center gap-2 transition-all disabled:opacity-55 cursor-pointer"
            id="lit-search-button"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            Search
          </button>
          <button
            onClick={runAutonomousSwarm}
            disabled={loading || runningSwarm || !query.trim()}
            className="border border-emerald-500/30 hover:border-emerald-500 text-emerald-400 font-mono text-xs uppercase font-bold px-5 py-2.5 rounded-lg flex items-center gap-2 transition-all disabled:opacity-30 bg-emerald-500/5 hover:bg-emerald-500/10 cursor-pointer"
            id="lit-swarm-button"
            title="Integrates these live feed results directly into autonomous research trends, simulations, and drafted documents."
          >
            {runningSwarm ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Target Swarm Research
          </button>
        </div>

        {swarmSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/25 p-3.5 rounded-lg flex items-start gap-2.5 animate-in fade-in duration-300" id="swarm-success-banner">
            <CheckCircle2 className="text-emerald-400 shrink-0 mt-0.5 animate-pulse" size={16} />
            <div className="space-y-1">
              <div className="text-xs font-semibold text-white">Autonomous Research Swarm Complete</div>
              <div className="text-[11px] text-white/70 font-mono leading-normal">{swarmSuccess}</div>
            </div>
          </div>
        )}

        {swarmError && (
          <div className="bg-red-500/10 border border-red-500/25 p-3.5 rounded-lg flex items-start gap-2.5 animate-in fade-in duration-300" id="swarm-error-banner">
            <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
            <div className="space-y-1">
              <div className="text-xs font-semibold text-white">Swarm Execution Failed</div>
              <div className="text-[11px] text-red-300/80 font-mono leading-normal">{swarmError}</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {DEFAULT_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuery(q);
                search(q);
              }}
              className="text-[10px] font-mono bg-[#121915] hover:bg-emerald-500/10 text-emerald-400/80 hover:text-emerald-300 border border-emerald-500/10 px-3 py-1.5 rounded transition-all"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3 pt-2">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-[#0A0F0D] border border-white/10 px-3 py-2 text-xs text-white font-mono"
          >
            <option value="all">All sources</option>
            <option value="pubmed">PubMed</option>
            <option value="openalex">OpenAlex</option>
            <option value="europepmc">Europe PMC</option>
            <option value="semanticscholar">Semantic Scholar</option>
          </select>

          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as 'relevance' | 'recent' | 'citations')}
            className="bg-[#0A0F0D] border border-white/10 px-3 py-2 text-xs text-white font-mono"
          >
            <option value="relevance">Sort: Relevance</option>
            <option value="recent">Sort: Most recent</option>
            <option value="citations">Sort: Citations</option>
          </select>

          <label className="flex items-center gap-2 text-xs text-white/65 font-mono border border-white/10 px-3 py-2 bg-[#0A0F0D]">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
              className="accent-emerald-500"
            />
            Open access only
          </label>

          <div className="md:col-span-2 text-[10px] font-mono uppercase tracking-widest text-white/35 flex items-center">
            {filteredResults.length} result(s) loaded
          </div>
        </div>

        {error && (
          <div className="text-red-400 text-xs font-mono bg-red-500/5 border border-red-500/20 p-3 rounded-lg" id="lit-error">
            Error: {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-12 text-white/40 flex flex-col items-center justify-center gap-2 border border-white/5 bg-black/20 rounded-lg" id="lit-loading">
            <Zap size={24} className="animate-pulse text-emerald-400 mb-1" />
            <p className="text-xs font-mono tracking-wider uppercase text-white/80">
              Querying global research repositories
            </p>
            <p className="text-[10px] text-white/30">
              Connecting to PubMed · OpenAlex · Europe PMC ...
            </p>
          </div>
        )}
      </div>

      {!loading && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-5 space-y-4" id="lit-results-list">
            {filteredResults.length === 0 && !error ? (
              <div className="text-center py-12 border border-white/5 bg-black/10 rounded-lg text-white/30 font-mono text-[11px]" id="lit-empty-state">
                <BookOpen size={24} className="mx-auto mb-2 text-white/10" />
                No publications loaded. Enter a medical or compliance query above to search global indices.
              </div>
            ) : (
              filteredResults.map((paper) => {
                const isSelected = selectedPaper?.id === paper.id;
                const isRunning = runningById[paper.id];
                const crossRef = crossRefById[paper.id];

                return (
                  <button
                    key={paper.id}
                    onClick={() => setSelectedPaperId(paper.id)}
                    className={`w-full text-left border rounded-lg p-5 transition-all space-y-3 ${
                      isSelected
                        ? 'border-emerald-500/30 bg-[#16211C]'
                        : 'border-white/5 bg-[#121915] hover:border-emerald-500/20'
                    }`}
                    id={`paper-card-${paper.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="font-sans font-semibold text-sm leading-snug text-white tracking-tight">
                          {paper.title}
                        </h3>
                        <p className="text-[11px] text-white/40 mt-1.5 font-mono">
                          {paper.authors.slice(0, 3).join(', ')}
                          {paper.authors.length > 3 ? ' et al.' : ''}
                          {paper.journal && ` · ${paper.journal}`}
                          {paper.publishedDate && ` · ${paper.publishedDate}`}
                        </p>
                      </div>

                      <span
                        className={`text-[9px] font-mono font-bold uppercase px-2.5 py-1 rounded shrink-0 tracking-wider ${
                          SOURCE_COLOR[paper.source] ?? 'bg-white/5 text-white/60 border border-white/10'
                        }`}
                      >
                        {paper.source}
                      </span>
                    </div>

                    {paper.abstract && (
                      <p className="text-[11px] text-white/60 leading-relaxed font-sans line-clamp-3 bg-black/10 p-3 border border-white/5 rounded-md">
                        {paper.abstract}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {paper.isOpenAccess && (
                        <span className="text-[10px] font-mono text-emerald-400/80 font-semibold uppercase tracking-wider bg-emerald-500/5 px-1.5 py-0.5 rounded border border-emerald-500/10">
                          Open Access
                        </span>
                      )}

                      {paper.citationCount !== undefined && (
                        <span className="text-[10px] font-mono text-white/35">
                          {paper.citationCount} citations
                        </span>
                      )}

                      {crossRef && (
                        <span
                          className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${duplicateRiskColor[crossRef.duplicateRisk]}`}
                        >
                          Duplicate risk: {crossRef.duplicateRisk}
                        </span>
                      )}

                      {analysisById[paper.id] && (
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded border bg-sky-500/10 text-sky-300 border-sky-500/20">
                          Analyzed
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-white/5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          runPipeline(paper);
                        }}
                        disabled={Boolean(isRunning)}
                        className="text-[10px] font-mono uppercase px-3 py-1.5 rounded border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {isRunning ? <RefreshCw size={12} className="animate-spin" /> : <FileSearch size={12} />}
                        {isRunning ? 'Running...' : 'Analyze'}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          queueExperiment(paper);
                        }}
                        className="text-[10px] font-mono uppercase px-3 py-1.5 rounded border border-purple-500/20 bg-purple-500/10 text-purple-300 hover:bg-purple-500/15 flex items-center gap-1.5"
                      >
                        <FlaskConical size={12} />
                        Queue experiment
                      </button>

                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleAdd(paper);
                        }}
                        disabled={added.has(paper.id)}
                        className={`ml-auto text-[10px] font-mono font-bold uppercase px-4 py-1.5 rounded flex items-center gap-1.5 transition-all ${
                          added.has(paper.id)
                            ? 'bg-emerald-500/10 text-emerald-400/40 border border-emerald-500/10 cursor-default'
                            : 'bg-emerald-500 hover:bg-emerald-400 text-black'
                        }`}
                      >
                        <BookOpen size={12} />
                        {added.has(paper.id) ? 'Ingested' : 'Ingest to Library'}
                      </button>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="xl:col-span-7">
            {selectedPaper ? (
              <div className="border border-white/5 bg-[#111815] p-6 space-y-6">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`text-[9px] font-mono font-bold uppercase px-2.5 py-1 rounded tracking-wider ${
                          SOURCE_COLOR[selectedPaper.source] ?? 'bg-white/5 text-white/60 border border-white/10'
                        }`}
                      >
                        {selectedPaper.source}
                      </span>

                      {selectedPaper.isOpenAccess && (
                        <span className="text-[9px] font-mono uppercase px-2.5 py-1 rounded tracking-wider bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                          Open Access
                        </span>
                      )}
                    </div>

                    <h3 className="text-xl font-semibold text-white leading-snug">
                      {selectedPaper.title}
                    </h3>

                    <p className="text-xs text-white/50">
                      {selectedPaper.authors.join(', ')}
                      {selectedPaper.journal ? ` · ${selectedPaper.journal}` : ''}
                      {selectedPaper.publishedDate ? ` · ${selectedPaper.publishedDate}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => runPipeline(selectedPaper)}
                      disabled={Boolean(runningById[selectedPaper.id])}
                      className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {runningById[selectedPaper.id] ? (
                        <RefreshCw size={12} className="animate-spin" />
                      ) : (
                        <GitCompare size={12} />
                      )}
                      Full pipeline
                    </button>

                    <button
                      onClick={() => queueExperiment(selectedPaper)}
                      className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-purple-500/20 bg-purple-500/10 text-purple-300 hover:bg-purple-500/15 flex items-center gap-1.5"
                    >
                      <FlaskConical size={12} />
                      Send to experiment
                    </button>

                    <a
                      href={selectedPaper.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/70 hover:text-white hover:bg-white/5 flex items-center gap-1.5"
                    >
                      <ExternalLink size={12} />
                      Source
                    </a>

                    {selectedPaper.fullTextUrl && (
                      <a
                        href={selectedPaper.fullTextUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-sky-500/20 bg-sky-500/10 text-sky-300 hover:bg-sky-500/15 flex items-center gap-1.5"
                      >
                        <Download size={12} />
                        PDF
                      </a>
                    )}
                  </div>
                </div>

                {pipelineErrorById[selectedPaper.id] && (
                  <div className="border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-center gap-2">
                    <AlertTriangle size={14} />
                    {pipelineErrorById[selectedPaper.id]}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="border border-white/5 bg-black/20 p-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
                      DOI / PMID
                    </div>
                    <div className="mt-2 text-sm text-white break-all">
                      {selectedPaper.doi || selectedPaper.pmid || 'No identifier available'}
                    </div>
                  </div>

                  <div className="border border-white/5 bg-black/20 p-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
                      Citations
                    </div>
                    <div className="mt-2 text-sm text-white">
                      {selectedPaper.citationCount ?? 'Unknown'}
                    </div>
                  </div>

                  <div className="border border-white/5 bg-black/20 p-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
                      Keywords
                    </div>
                    <div className="mt-2 text-sm text-white">
                      {(selectedPaper.keywords || []).slice(0, 5).join(', ') || 'No keywords'}
                    </div>
                  </div>
                </div>

                <div className="border border-white/5 bg-black/20 p-4">
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                    Abstract
                  </div>
                  <p className="mt-3 text-sm text-white/70 leading-relaxed">
                    {selectedPaper.abstract || 'No abstract available.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="border border-white/5 bg-black/20 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-amber-300">
                      <FileSearch size={13} />
                      Structured Analysis
                    </div>

                    {analysisById[selectedPaper.id] ? (
                      <>
                        <div className="text-sm text-white/75 leading-relaxed">
                          {analysisById[selectedPaper.id].summary}
                        </div>

                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Compounds
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {analysisById[selectedPaper.id].compounds.map((compound) => (
                              <span
                                key={compound}
                                className="text-[10px] px-2 py-1 border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 font-mono"
                              >
                                {compound}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Methods
                          </div>
                          <ul className="space-y-1 text-sm text-white/65">
                            {analysisById[selectedPaper.id].methods.map((item, idx) => (
                              <li key={idx}>- {item}</li>
                            ))}
                          </ul>
                        </div>

                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Compliance signals
                          </div>
                          <ul className="space-y-1 text-sm text-white/65">
                            {analysisById[selectedPaper.id].complianceSignals.map((item, idx) => (
                              <li key={idx} className="flex gap-2">
                                <ShieldCheck size={14} className="mt-0.5 text-emerald-400 shrink-0" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="text-[10px] font-mono uppercase tracking-widest text-sky-300">
                          Confidence: {analysisById[selectedPaper.id].confidence}%
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-white/45">
                        Run analysis to structure the paper into compounds, methods, compliance
                        signals, and testable hypotheses.
                      </div>
                    )}
                  </div>

                  <div className="border border-white/5 bg-black/20 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-purple-300">
                      <Layers3 size={13} />
                      Cross Reference
                    </div>

                    {crossRefById[selectedPaper.id] ? (
                      <>
                        <div
                          className={`inline-flex text-[10px] font-mono uppercase px-2 py-1 rounded border ${
                            duplicateRiskColor[crossRefById[selectedPaper.id].duplicateRisk]
                          }`}
                        >
                          Duplicate risk: {crossRefById[selectedPaper.id].duplicateRisk}
                        </div>

                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Signals
                          </div>
                          <ul className="space-y-1 text-sm text-white/65">
                            {crossRefById[selectedPaper.id].conflictingSignals.map((item, idx) => (
                              <li key={idx}>- {item}</li>
                            ))}
                          </ul>
                        </div>

                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Nearby matches
                          </div>
                          {crossRefById[selectedPaper.id].matches.length === 0 ? (
                            <div className="text-sm text-white/45">
                              No strong overlaps found in the current result set.
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {crossRefById[selectedPaper.id].matches.map((match) => (
                                <div
                                  key={match.id}
                                  className="border border-white/5 bg-[#101613] p-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm text-white">{match.title}</div>
                                      <div className="text-[10px] font-mono text-white/35 mt-1">
                                        {match.source}
                                      </div>
                                    </div>
                                    <div className="text-[10px] font-mono text-emerald-300">
                                      {(match.score * 100).toFixed(0)}%
                                    </div>
                                  </div>
                                  <div className="mt-2 text-xs text-white/55">
                                    {match.reason}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-white/45">
                        Run cross-reference to detect duplicates, evidence neighbors, and overlap risk.
                      </div>
                    )}
                  </div>
                </div>

                <div className="border border-white/5 bg-black/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-300">
                    <FlaskConical size={13} />
                    Experiment Pipeline Draft
                  </div>

                  {experimentById[selectedPaper.id] ? (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            {experimentById[selectedPaper.id].title}
                          </div>
                          <div className="mt-1 text-sm text-white/65">
                            {experimentById[selectedPaper.id].objective}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Model type
                          </div>
                          <div className="text-sm text-white/70">
                            {experimentById[selectedPaper.id].modelType}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Variables
                          </div>
                          <ul className="space-y-1 text-sm text-white/65">
                            {experimentById[selectedPaper.id].variables.map((item, idx) => (
                              <li key={idx}>- {item}</li>
                            ))}
                          </ul>
                        </div>

                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Endpoints
                          </div>
                          <ul className="space-y-1 text-sm text-white/65">
                            {experimentById[selectedPaper.id].endpoints.map((item, idx) => (
                              <li key={idx}>- {item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Protocol steps
                          </div>
                          <ol className="space-y-1 text-sm text-white/65">
                            {experimentById[selectedPaper.id].protocolSteps.map((item, idx) => (
                              <li key={idx}>
                                {idx + 1}. {item}
                              </li>
                            ))}
                          </ol>
                        </div>

                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-white/35 mb-2">
                            Safety notes
                          </div>
                          <ul className="space-y-1 text-sm text-white/65">
                            {experimentById[selectedPaper.id].safetyNotes.map((item, idx) => (
                              <li key={idx} className="flex gap-2">
                                <AlertTriangle size={14} className="mt-0.5 text-amber-400 shrink-0" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <button
                          onClick={() => queueExperiment(selectedPaper)}
                          className="mt-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-[10px] font-mono uppercase tracking-widest font-bold flex items-center gap-1.5"
                        >
                          <CheckCircle2 size={12} />
                          Send plan to lab
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-white/45">
                      Run the full pipeline to draft an experiment plan from this paper.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="border border-white/5 bg-[#111815] p-8 text-center text-white/45">
                Select a paper to inspect its analysis, cross-reference state, and experiment draft.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}