import React, { useState, useEffect, useCallback } from 'react'
import { Activity, AlertTriangle, TrendingUp, GitBranch, Loader2, AlertCircle, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { authFetch } from '../../lib/firebase'

const DOMAINS = ['genomics', 'neuroscience', 'immunology', 'metabolomics', 'microbiome', 'proteomics']

interface TrendData {
  domain: string
  direction: string
  slope: number
  confidence: number
  data_points: number
}

interface AnomalyData {
  id: string
  domain: string
  severity: string
  description: string
  timestamp: string
  z_score: number
}

interface CorrelationData {
  domainA: string
  domainB: string
  correlation: number
  strength: string
  significance: number
  mechanism?: string
}

export default function CrossDomainAnalyticsDashboard() {
  const [trends, setTrends] = useState<TrendData[]>([])
  const [anomalies, setAnomalies] = useState<AnomalyData[]>([])
  const [correlations, setCorrelations] = useState<CorrelationData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDomain, setSelectedDomain] = useState<string>('genomics')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [trendResults, anomalyResults, matrixResults] = await Promise.all([
        Promise.all(DOMAINS.map(d =>
          authFetch('/api/blackmind/analytics/trend', {
            method: 'POST',
            body: JSON.stringify({ domain: d }),
          }).then(r => r.ok ? r.json() : null)
        )),
        authFetch('/api/blackmind/analytics/anomalies', {
          method: 'POST',
          body: JSON.stringify({}),
        }),
        authFetch('/api/blackmind/analytics/correlation-matrix', {
          method: 'POST',
          body: JSON.stringify({ domains: DOMAINS }),
        }),
      ])
      setTrends(trendResults.filter(Boolean))
      if (anomalyResults.ok) setAnomalies(await anomalyResults.json())
      if (matrixResults.ok) setCorrelations(await matrixResults.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const trendChartData = trends.map(t => ({
    name: t.domain.substring(0, 6),
    confidence: Math.round(t.confidence * 100),
    slope: Math.round(t.slope * 1000),
  }))

  const correlationChartData = correlations.slice(0, 10).map(c => ({
    name: `${c.domainA.substring(0, 4)}-${c.domainB.substring(0, 4)}`,
    correlation: Math.round(c.correlation * 100),
  }))

  const severityColors = { critical: 'text-red-400', high: 'text-orange-400', medium: 'text-amber-400', low: 'text-yellow-400' }

  return (
    <div className="bg-black/40 border border-white/10 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <Activity className="text-emerald-400" size={24} />
        <h2 className="text-xl font-semibold text-white">Cross-Domain Analytics</h2>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-emerald-400" size={32} />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded mb-4 text-red-400 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white/5 border border-white/10 rounded p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <TrendingUp size={14} />
                Domain Trends
              </h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Bar dataKey="confidence" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <GitBranch size={14} />
                Cross-Domain Correlations
              </h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={correlationChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[-100, 100]} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={70} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                  <Bar dataKey="correlation" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {DOMAINS.map(d => (
              <button
                key={d}
                onClick={() => setSelectedDomain(d)}
                className={`px-3 py-1.5 rounded text-xs transition-colors ${
                  selectedDomain === d
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white/5 border border-white/10 rounded p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <AlertTriangle size={14} />
                Anomalies ({anomalies.length})
              </h3>
              {anomalies.length === 0 ? (
                <p className="text-slate-500 text-sm">No anomalies detected</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {anomalies
                    .filter(a => selectedDomain ? a.domain === selectedDomain : true)
                    .slice(0, 10)
                    .map(a => (
                      <div key={a.id} className="flex items-start gap-2 p-2 bg-black/20 rounded border border-white/5">
                        <AlertTriangle size={14} className={`mt-0.5 ${severityColors[a.severity as keyof typeof severityColors] || 'text-slate-400'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-slate-300 truncate">{a.description}</div>
                          <div className="flex gap-2 text-xs text-slate-500 mt-0.5">
                            <span>{a.domain}</span>
                            <span>{a.severity}</span>
                            <span>z: {a.z_score.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="bg-white/5 border border-white/10 rounded p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Activity size={14} />
                Top Correlations
              </h3>
              {correlations.length === 0 ? (
                <p className="text-slate-500 text-sm">No correlations computed</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {correlations.filter(c => selectedDomain ? c.domainA === selectedDomain || c.domainB === selectedDomain : true).slice(0, 8).map((c, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-black/20 rounded border border-white/5">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-300">{c.domainA} ↔ {c.domainB}</div>
                        <div className="flex gap-2 text-xs text-slate-500 mt-0.5">
                          <span className={c.correlation > 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {(c.correlation * 100).toFixed(1)}%
                          </span>
                          <span>{c.strength}</span>
                          {c.mechanism && <span className="text-slate-600">{c.mechanism}</span>}
                        </div>
                      </div>
                      {c.correlation > 0.3 ? (
                        <ArrowUp size={14} className="text-emerald-400 shrink-0" />
                      ) : c.correlation < -0.3 ? (
                        <ArrowDown size={14} className="text-red-400 shrink-0" />
                      ) : (
                        <Minus size={14} className="text-slate-500 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
