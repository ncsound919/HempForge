import { knowledgeStore, type CuratedRecord } from './KnowledgeStore'
import { eventBus } from './EventBus'
import type { TrendAnalysis, AnomalyReport, CrossDomainCorrelation, ReproducibilityScore } from './types'

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1))
}

function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = Math.min(x.length, y.length)
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 }
  const xMean = mean(x); const yMean = mean(y)
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (x[i] - xMean) * (y[i] - yMean)
    den += (x[i] - xMean) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = yMean - slope * xMean
  const ssRes = y.reduce((s, yi, i) => s + (yi - (slope * x[i] + intercept)) ** 2, 0)
  const ssTot = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0)
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 2) return 0
  const xMean = mean(x); const yMean = mean(y)
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xMean; const dy = y[i] - yMean
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  const den = Math.sqrt(dx2 * dy2)
  return den === 0 ? 0 : num / den
}

export class CrossDomainAnalytics {
  private static instance: CrossDomainAnalytics | null = null

  private constructor() {}

  static getInstance(): CrossDomainAnalytics {
    if (!CrossDomainAnalytics.instance) CrossDomainAnalytics.instance = new CrossDomainAnalytics()
    return CrossDomainAnalytics.instance
  }

  analyzeTrend(params: { domain: string; timeRange?: { from: string; to: string }; metric?: string; windowSize?: number }): TrendAnalysis | null {
    const records = knowledgeStore.queryCuratedRecords({ domain: [params.domain] })
    if (records.length < 3) return null
    const timePoints = records
      .filter(r => r.metrics?.[params.metric || 'confidence'])
      .map(r => ({ time: new Date(r.created_at).getTime(), value: r.metrics[params.metric || 'confidence'] }))
      .sort((a, b) => a.time - b.time)
    if (timePoints.length < 3) return null
    const values = timePoints.map(t => t.value)
    const times = timePoints.map(t => t.time)
    const { slope, r2 } = linearRegression(times, values)
    let direction: 'up' | 'down' | 'stable' = 'stable'
    if (slope > 0.01) direction = 'up'
    else if (slope < -0.01) direction = 'down'
    return { domain: params.domain, direction, slope, confidence: r2, data_points: timePoints.length, period: this.computePeriod(timePoints) }
  }

  private computePeriod(points: Array<{ time: number; value: number }>): string {
    if (points.length < 2) return 'unknown'
    const days = (points[points.length - 1].time - points[0].time) / (1000 * 60 * 60 * 24)
    if (days < 1) return 'daily'
    if (days < 7) return 'weekly'
    if (days < 30) return 'monthly'
    if (days < 365) return 'yearly'
    return 'multi_year'
  }

  detectAnomalies(params: { domain?: string; timeRange?: { from: string; to: string }; threshold?: number }): AnomalyReport[] {
    const records = knowledgeStore.queryCuratedRecords({ domain: params.domain ? [params.domain] : undefined })
    const threshold = params.threshold || 2.0
    const allRecords = records.filter(r => r.confidence !== undefined)
    const confidences = allRecords.map(r => r.confidence)
    if (confidences.length < 5) return []
    const m = mean(confidences); const sd = stddev(confidences)
    const anomalies: AnomalyReport[] = []
    for (const record of allRecords) {
      const zScore = sd > 0 ? Math.abs((record.confidence - m) / sd) : 0
      if (zScore > threshold) {
        let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
        if (zScore > 4) severity = 'critical'
        else if (zScore > 3) severity = 'high'
        else if (zScore > 2) severity = 'medium'
        else severity = 'low'
        anomalies.push({
          id: `anomaly_${record.id}`, domain: record.domains[0] || 'unknown',
          type: 'point', severity,
          description: `Confidence anomaly: ${record.confidence.toFixed(3)} vs mean ${m.toFixed(3)}`,
          timestamp: record.created_at, metrics: { confidence: record.confidence, z_score: zScore }, z_score: zScore,
        })
      }
    }
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
  }

  computeCrossDomainCorrelation(params: { domainA: string; domainB: string; timeRange?: { from: string; to: string }; metric?: string }): CrossDomainCorrelation | null {
    const recordsA = knowledgeStore.queryCuratedRecords({ domain: [params.domainA] })
    const recordsB = knowledgeStore.queryCuratedRecords({ domain: [params.domainB] })
    if (recordsA.length < 3 || recordsB.length < 3) return null
    const metric = params.metric || 'confidence'
    const valuesA = recordsA.map(r => r.metrics?.[metric] || 0)
    const valuesB = recordsB.map(r => r.metrics?.[metric] || 0)
    const correlation = pearsonCorrelation(valuesA, valuesB)
    const n = Math.min(valuesA.length, valuesB.length)
    const tStat = correlation * Math.sqrt(Math.max(0, n - 2)) / Math.sqrt(Math.max(0.001, 1 - correlation * correlation))
    const significance = Math.exp(-tStat * tStat / 2)
    let strength: 'weak' | 'moderate' | 'strong' | 'very_strong' = 'weak'
    const absCorr = Math.abs(correlation)
    if (absCorr > 0.8) strength = 'very_strong'
    else if (absCorr > 0.6) strength = 'strong'
    else if (absCorr > 0.4) strength = 'moderate'
    const mechanism = this.inferMechanism(params.domainA, params.domainB)
    return { domainA: params.domainA, domainB: params.domainB, correlation, strength, significance, sample_size: n, mechanism }
  }

  private inferMechanism(domainA: string, domainB: string): string | undefined {
    const mechanisms: Record<string, Record<string, string>> = {
      genomics: { proteomics: 'gene-expression', metabolomics: 'metabolic-pathway', microbiome: 'gut-brain-axis' },
      neuroscience: { immunology: 'neuroinflammation', genomics: 'neurogenetics', microbiome: 'gut-brain-axis' },
      immunology: { oncology: 'immuno-oncology', microbiome: 'immune-microbiome', metabolomics: 'immunometabolism' },
    }
    return mechanisms[domainA]?.[domainB] || mechanisms[domainB]?.[domainA]
  }

  computeCorrelationMatrix(params: { domains: string[]; timeRange?: { from: string; to: string } }): CrossDomainCorrelation[] {
    const correlations: CrossDomainCorrelation[] = []
    for (let i = 0; i < params.domains.length; i++) {
      for (let j = i + 1; j < params.domains.length; j++) {
        const c = this.computeCrossDomainCorrelation({ domainA: params.domains[i], domainB: params.domains[j], timeRange: params.timeRange })
        if (c) correlations.push(c)
      }
    }
    return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
  }

  computeReproducibilityScore(entityId: string): ReproducibilityScore {
    const events = eventBus.query({ limit: 50 })
    const relevantEvents = events.filter(e => e.subject_id.includes(entityId) || e.metadata?.entity_id === entityId)
    if (relevantEvents.length < 2) {
      return { entity_id: entityId, score: 0, runs: relevantEvents.length, consistency: 0, factors: ['insufficient_data'] }
    }
    const completedEvents = relevantEvents.filter(e => e.status === 'completed')
    const successRate = completedEvents.length / relevantEvents.length
    const hashes = relevantEvents.map(e => e.payload_hash).filter(h => h)
    const uniqueHashes = new Set(hashes)
    const consistency = hashes.length > 0 ? uniqueHashes.size / hashes.length : 1
    const factors: string[] = []
    if (successRate >= 0.9) factors.push('high_success_rate')
    if (successRate < 0.7) factors.push('unstable')
    if (consistency >= 0.9) factors.push('consistent_output')
    if (relevantEvents.length >= 5) factors.push('adequate_sample_size')
    const score = (successRate * 0.6) + (consistency * 0.4)
    return { entity_id: entityId, score, runs: relevantEvents.length, consistency, factors }
  }

  semanticSearch(params: { query: string; domains?: string[]; minConfidence?: number; limit?: number }): CuratedRecord[] {
    const records = knowledgeStore.queryCuratedRecords({ domain: params.domains, min_confidence: params.minConfidence, limit: params.limit || 20 })
    const queryLower = params.query.toLowerCase()
    return records
      .map(record => {
        let score = 0
        if (record.summary.toLowerCase().includes(queryLower)) score += 2
        if (record.entity_id.toLowerCase().includes(queryLower)) score += 1
        if (record.tags.some(t => t.toLowerCase().includes(queryLower))) score += 1
        return { record, score }
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ record }) => record)
  }

  detectDrift(params: { domain: string; windowSize?: number; threshold?: number }): { has_drift: boolean; drift_score: number; trend: TrendAnalysis | null; anomalies: AnomalyReport[] } {
    const windowSize = params.windowSize || 20
    const threshold = params.threshold || 0.15
    const recentEvents = eventBus.query({ domain: [params.domain], limit: windowSize * 2 })
    if (recentEvents.length < windowSize) return { has_drift: false, drift_score: 0, trend: null, anomalies: [] }
    const older = recentEvents.slice(0, Math.floor(windowSize / 2))
    const newer = recentEvents.slice(Math.floor(windowSize / 2))
    const olderConfidences = older.map(e => e.metadata?.confidence as number || 0.5)
    const newerConfidences = newer.map(e => e.metadata?.confidence as number || 0.5)
    const meanOlder = mean(olderConfidences); const meanNewer = mean(newerConfidences)
    const stdOlder = stddev(olderConfidences); const stdNewer = stddev(newerConfidences)
    const driftScore = Math.abs(meanNewer - meanOlder) / Math.max(stdOlder, stdNewer, 0.1)
    const anomalies = this.detectAnomalies({ domain: params.domain })
    const trend = this.analyzeTrend({ domain: params.domain })
    return { has_drift: driftScore > threshold, drift_score: driftScore, trend, anomalies: anomalies.slice(0, 5) }
  }
}

export const crossDomainAnalytics = CrossDomainAnalytics.getInstance()
