import React, { useState } from 'react'
import { Search, Dna, Beaker, FileText, AlertCircle, Loader2, BookOpen, FlaskConical, Activity } from 'lucide-react'
import { authFetch } from '../../lib/firebase'

type Domain = 'genomics' | 'neuroscience' | 'immunology' | 'metabolomics' | 'microbiome' | 'proteomics'

const DOMAINS: { value: Domain; label: string; icon: React.ReactNode }[] = [
  { value: 'genomics', label: 'Genomics', icon: <Dna size={16} /> },
  { value: 'neuroscience', label: 'Neuroscience', icon: <Activity size={16} /> },
  { value: 'immunology', label: 'Immunology', icon: <Beaker size={16} /> },
  { value: 'metabolomics', label: 'Metabolomics', icon: <FlaskConical size={16} /> },
  { value: 'microbiome', label: 'Microbiome', icon: <BookOpen size={16} /> },
  { value: 'proteomics', label: 'Proteomics', icon: <FileText size={16} /> },
]

interface SearchResult {
  localResults: any[]
  papers: any[]
  patents: any[]
  isomorphisms: any[]
}

interface HypothesisResult {
  hypothesis: any
  testResult: any
  isomorphisms: any[]
}

export default function ScienceLabPanel() {
  const [query, setQuery] = useState('')
  const [selectedDomain, setSelectedDomain] = useState<Domain>('genomics')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [hypothesisResult, setHypothesisResult] = useState<HypothesisResult | null>(null)

  async function handleSearch() {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const [searchRes, hypothesisRes] = await Promise.all([
        authFetch('/api/blackmind/science/cross-domain-search', {
          method: 'POST',
          body: JSON.stringify({ query, domains: [selectedDomain, 'genomics'], includePapers: true }),
        }),
        authFetch('/api/blackmind/science/run-cycle', {
          method: 'POST',
          body: JSON.stringify({ domain: selectedDomain, context: { query } }),
        }),
      ])
      if (!searchRes.ok) { const e = await searchRes.json(); throw new Error(e.error) }
      if (!hypothesisRes.ok) { const e = await hypothesisRes.json(); throw new Error(e.error) }
      setSearchResult(await searchRes.json())
      setHypothesisResult(await hypothesisRes.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-black/40 border border-white/10 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <Search className="text-emerald-400" size={24} />
        <h2 className="text-xl font-semibold text-white">Science Lab</h2>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {DOMAINS.map(d => (
          <button
            key={d.value}
            onClick={() => setSelectedDomain(d.value)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
              selectedDomain === d.value
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
            }`}
          >
            {d.icon}
            {d.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search scientific concepts, genes, proteins..."
          className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded transition-colors flex items-center gap-2"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded mb-4 text-red-400 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {searchResult && (
          <div className="bg-white/5 border border-white/10 rounded p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <FileText size={14} />
              Local Results ({searchResult.localResults.length})
            </h3>
            {searchResult.localResults.length === 0 ? (
              <p className="text-slate-500 text-sm">No local results found</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {searchResult.localResults.map((r: any, i: number) => (
                  <div key={i} className="text-xs text-slate-400 p-2 bg-black/20 rounded border border-white/5">
                    <div className="text-slate-300">{r.summary?.substring(0, 120)}</div>
                    <div className="flex gap-2 mt-1">
                      <span className="text-emerald-400/70">{r.entity_type}</span>
                      <span className="text-slate-500">{(r.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 className="text-sm font-semibold text-slate-300 mt-4 mb-2">Isomorphisms Found ({searchResult.isomorphisms.length})</h3>
            {searchResult.isomorphisms.length === 0 ? (
              <p className="text-slate-500 text-sm">No cross-domain patterns</p>
            ) : (
              <div className="space-y-1">
                {searchResult.isomorphisms.map((iso: any, i: number) => (
                  <div key={i} className="text-xs text-slate-400 flex justify-between p-1.5 bg-black/20 rounded">
                    <span>{iso.sourceDomain} → {iso.targetDomain}</span>
                    <span className="text-emerald-400/70">{(iso.confidence * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {hypothesisResult && (
          <div className="bg-white/5 border border-white/10 rounded p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <Beaker size={14} />
              Generated Hypothesis
            </h3>
            <div className="text-xs text-slate-400 mb-3 p-2 bg-black/20 rounded border border-white/5">
              <p className="text-slate-300 mb-2">{hypothesisResult.hypothesis?.hypothesis}</p>
              <div className="flex gap-3 text-xs">
                <span>Confidence: <span className="text-emerald-400">{(hypothesisResult.hypothesis?.confidence * 100).toFixed(0)}%</span></span>
                <span>Novelty: <span className="text-amber-400">{(hypothesisResult.hypothesis?.noveltyScore * 100).toFixed(0)}%</span></span>
              </div>
            </div>
            <h4 className="text-xs font-semibold text-slate-400 mb-1">Test Result</h4>
            <div className={`text-xs p-2 rounded ${hypothesisResult.testResult?.validated ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
              {hypothesisResult.testResult?.validated ? 'Validated' : 'Not validated'}
              {' - Score: '}{(hypothesisResult.testResult?.score * 100).toFixed(0)}%
            </div>
            {hypothesisResult.testResult?.evidence?.length > 0 && (
              <div className="mt-2">
                <h4 className="text-xs font-semibold text-slate-400 mb-1">Evidence</h4>
                {hypothesisResult.testResult.evidence.map((e: string, i: number) => (
                  <div key={i} className="text-xs text-slate-500">• {e}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
