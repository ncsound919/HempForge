import React, { useState, useEffect, useCallback } from 'react'
import { Search, Network, FileType, Database, ArrowRight, Loader2, Layers, AlertCircle } from 'lucide-react'
import { authFetch } from '../../lib/firebase'

interface Artifact {
  id: string
  content_type: string
  created_at: string
  created_by: string
  metadata: any
}

interface CuratedRecord {
  id: string
  entity_type: string
  entity_id: string
  summary: string
  confidence: number
  tags: string[]
  domains: string[]
}

interface KnowledgeStats {
  totalArtifacts: number
  totalCuratedRecords: number
  totalFeatureViews: number
  lineageNodes: number
  domains: string[]
}

interface LineageGraph {
  parents: string[]
  children: string[]
  root: string
  depth: number
}

export default function KnowledgeGraphViewer() {
  const [stats, setStats] = useState<KnowledgeStats | null>(null)
  const [records, setRecords] = useState<CuratedRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<CuratedRecord | null>(null)
  const [lineage, setLineage] = useState<LineageGraph | null>(null)
  const [lineageLoading, setLineageLoading] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      const [statsRes, searchRes] = await Promise.all([
        authFetch('/api/blackmind/knowledge/stats'),
        authFetch('/api/blackmind/knowledge/search', {
          method: 'POST',
          body: JSON.stringify({ query: '', limit: 50 }),
        }),
      ])
      if (!statsRes.ok) return
      setStats(await statsRes.json())
      if (searchRes.ok) setRecords(await searchRes.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  async function handleSearch() {
    setLoading(true)
    try {
      const res = await authFetch('/api/blackmind/knowledge/search', {
        method: 'POST',
        body: JSON.stringify({ query: searchQuery, limit: 50 }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
      setRecords(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectRecord(record: CuratedRecord) {
    setSelectedRecord(record)
    setLineageLoading(true)
    setLineage(null)
    try {
      const res = await authFetch(`/api/blackmind/knowledge/lineage?entityId=${encodeURIComponent(record.id)}`)
      if (res.ok) setLineage(await res.json())
    } catch (err: any) {
      console.warn('Lineage fetch failed:', err)
    } finally {
      setLineageLoading(false)
    }
  }

  return (
    <div className="bg-black/40 border border-white/10 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <Network className="text-emerald-400" size={24} />
        <h2 className="text-xl font-semibold text-white">Knowledge Graph</h2>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-white/5 border border-white/10 rounded p-3 text-center">
            <div className="text-lg font-bold text-emerald-400">{stats.totalArtifacts}</div>
            <div className="text-xs text-slate-500">Artifacts</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded p-3 text-center">
            <div className="text-lg font-bold text-emerald-400">{stats.totalCuratedRecords}</div>
            <div className="text-xs text-slate-500">Records</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded p-3 text-center">
            <div className="text-lg font-bold text-emerald-400">{stats.totalFeatureViews}</div>
            <div className="text-xs text-slate-500">Features</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded p-3 text-center">
            <div className="text-lg font-bold text-emerald-400">{stats.domains.length}</div>
            <div className="text-xs text-slate-500">Domains</div>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search knowledge records..."
          className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded transition-colors"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded mb-4 text-red-400 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white/5 border border-white/10 rounded p-4 max-h-96 overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Database size={14} />
            Records ({records.length})
          </h3>
          {records.length === 0 ? (
            <p className="text-slate-500 text-sm">No records found</p>
          ) : (
            <div className="space-y-2">
              {records.map((r) => (
                <div
                  key={r.id}
                  onClick={() => handleSelectRecord(r)}
                  className={`p-2 rounded border text-xs cursor-pointer transition-colors ${
                    selectedRecord?.id === r.id
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-black/20 border-white/5 text-slate-400 hover:bg-white/5'
                  }`}
                >
                  <div className="font-medium text-slate-300 mb-1">{r.summary?.substring(0, 80)}</div>
                  <div className="flex gap-2 text-xs">
                    <span className="text-emerald-400/70">{r.entity_type}</span>
                    <span className="text-slate-500">{(r.confidence * 100).toFixed(0)}%</span>
                    <span className="text-slate-500">{r.domains.join(', ')}</span>
                  </div>
                  {r.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {r.tags.slice(0, 3).map(t => (
                        <span key={t} className="px-1.5 py-0.5 bg-white/5 rounded text-xs text-slate-500">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Layers size={14} />
            {selectedRecord ? 'Lineage Details' : 'Select a record'}
          </h3>
          {lineageLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-emerald-400" size={24} />
            </div>
          ) : lineage ? (
            <div className="space-y-3 text-xs text-slate-400">
              <div className="p-2 bg-black/20 rounded border border-white/5">
                <div className="text-slate-300 mb-1">Lineage Path</div>
                <div className="flex items-center gap-1 flex-wrap">
                  {lineage.parents.map((p, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <ArrowRight size={12} className="text-slate-600" />}
                      <span className="px-1.5 py-0.5 bg-white/5 rounded text-slate-400">{p.substring(0, 16)}...</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-black/20 rounded border border-white/5">
                  <div className="text-slate-500 mb-1">Root</div>
                  <div className="text-slate-300 truncate">{lineage.root.substring(0, 24)}</div>
                </div>
                <div className="p-2 bg-black/20 rounded border border-white/5">
                  <div className="text-slate-500 mb-1">Depth</div>
                  <div className="text-slate-300">{lineage.depth}</div>
                </div>
              </div>
              {lineage.children.length > 0 && (
                <div className="p-2 bg-black/20 rounded border border-white/5">
                  <div className="text-slate-300 mb-1">Children ({lineage.children.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {lineage.children.map(c => (
                      <span key={c} className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400/70 rounded text-xs">{c.substring(0, 20)}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">Click a record to view its lineage</p>
          )}
        </div>
      </div>
    </div>
  )
}
