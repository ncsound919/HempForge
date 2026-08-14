import { type CanonicalEventEnvelope, computePayloadHash, type Artifact, type CuratedRecord, type FeatureView } from './types'

export { type Artifact, type CuratedRecord, type FeatureView }

export class KnowledgeStore {
  private static instance: KnowledgeStore | null = null

  private artifacts: Map<string, Artifact> = new Map()
  private curatedRecords: Map<string, CuratedRecord> = new Map()
  private featureViews: Map<string, FeatureView> = new Map()
  private lineageGraph: Map<string, Set<string>> = new Map()

  private constructor() {}

  static getInstance(): KnowledgeStore {
    if (!KnowledgeStore.instance) KnowledgeStore.instance = new KnowledgeStore()
    return KnowledgeStore.instance
  }

  storeArtifact(params: { event: CanonicalEventEnvelope; content: unknown; content_type: string; storage_ref?: string; created_by?: string }): Artifact {
    const id = `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const checksum = computePayloadHash(params.content)
    const artifact: Artifact = {
      id, type: 'raw', content_type: params.content_type,
      storage_ref: params.storage_ref || `memory://${id}`, checksum,
      created_at: new Date().toISOString(),
      created_by: params.created_by || params.event.source_system,
      lineage: {
        event_id: params.event.event_id,
        parent_ids: params.event.lineage_parent_ids,
        root_id: this.findRootId(params.event.lineage_parent_ids),
        depth: this.computeDepth(params.event.lineage_parent_ids),
        paths: [params.event.event_type],
      },
      metadata: { source_system: params.event.source_system, domain: params.event.domain, ...params.event.metadata },
    }
    this.artifacts.set(id, artifact)
    for (const parentId of params.event.lineage_parent_ids) {
      if (!this.lineageGraph.has(parentId)) this.lineageGraph.set(parentId, new Set())
      this.lineageGraph.get(parentId)!.add(id)
    }
    return artifact
  }

  getArtifact(id: string): Artifact | undefined { return this.artifacts.get(id) }

  queryArtifacts(params: { source_system?: string[]; domain?: string[]; content_type?: string; from_date?: string; limit?: number }): Artifact[] {
    let results = Array.from(this.artifacts.values())
    if (params.source_system) results = results.filter(a => params.source_system!.includes(a.metadata.source_system as string))
    if (params.domain) results = results.filter(a => a.metadata.domain && (a.metadata.domain as string[]).some(d => params.domain!.includes(d)))
    if (params.content_type) results = results.filter(a => a.content_type === params.content_type)
    if (params.from_date) results = results.filter(a => a.created_at >= params.from_date!)
    return results.slice(0, params.limit || 100)
  }

  storeCuratedRecord(params: { event: CanonicalEventEnvelope; entity_type: string; entity_id: string; summary: string; metrics?: Record<string, number>; tags?: string[]; confidence?: number }): CuratedRecord {
    const id = `curated_${params.entity_type}_${params.entity_id}_${Date.now()}`
    const record: CuratedRecord = {
      id, source_event_id: params.event.event_id, entity_type: params.entity_type, entity_id: params.entity_id,
      domains: params.event.domain, summary: params.summary, metrics: params.metrics || {},
      tags: params.tags || params.event.tags, confidence: params.confidence || 0.7,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    this.curatedRecords.set(id, record)
    return record
  }

  getCuratedRecord(id: string): CuratedRecord | undefined { return this.curatedRecords.get(id) }

  queryCuratedRecords(params: { entity_type?: string; domain?: string[]; tags?: string[]; min_confidence?: number; limit?: number }): CuratedRecord[] {
    let results = Array.from(this.curatedRecords.values())
    if (params.entity_type) results = results.filter(r => r.entity_type === params.entity_type)
    if (params.domain) results = results.filter(r => r.domains.some(d => params.domain!.includes(d)))
    if (params.tags) results = results.filter(r => r.tags.some(t => params.tags!.includes(t)))
    if (params.min_confidence !== undefined) results = results.filter(r => r.confidence >= params.min_confidence!)
    return results.slice(0, params.limit || 100)
  }

  storeFeatureView(params: { source_record_id: string; features: Record<string, number | string>; embeddings?: number[]; anomaly_score?: number; trend_direction?: 'up' | 'down' | 'stable' }): FeatureView {
    const id = `feature_${params.source_record_id}_${Date.now()}`
    const view: FeatureView = {
      id, source_record_id: params.source_record_id, features: params.features,
      embeddings: params.embeddings, anomaly_score: params.anomaly_score, trend_direction: params.trend_direction,
      computed_at: new Date().toISOString(),
    }
    this.featureViews.set(id, view)
    return view
  }

  getFeatureView(id: string): FeatureView | undefined { return this.featureViews.get(id) }

  queryFeatureViews(params: { anomaly_threshold?: number; trend_direction?: 'up' | 'down' | 'stable'; limit?: number }): FeatureView[] {
    let results = Array.from(this.featureViews.values())
    if (params.anomaly_threshold !== undefined) results = results.filter(v => v.anomaly_score !== undefined && v.anomaly_score >= params.anomaly_threshold!)
    if (params.trend_direction) results = results.filter(v => v.trend_direction === params.trend_direction)
    return results.slice(0, params.limit || 100)
  }

  getLineageGraph(entityId: string): { parents: string[]; children: string[]; root: string; depth: number } {
    const parents: string[] = []
    const children: Array<string> = []
    let root = entityId
    let depth = 0
    let current = entityId
    const visited = new Set<string>()
    while (current) {
      const artifact = this.artifacts.get(current)
      if (!artifact) break
      parents.push(current)
      if (artifact.lineage.parent_ids.length > 0) { current = artifact.lineage.parent_ids[0]; depth++ }
      else { root = current; break }
      if (visited.has(current)) break
      visited.add(current)
    }
    if (this.lineageGraph.has(entityId)) {
      for (const child of this.lineageGraph.get(entityId)!) children.push(child)
    }
    return { parents, children, root, depth }
  }

  crossDomainQuery(params: { domains: string[]; timeRange?: { from: string; to: string }; entity_type?: string }): {
    entities: CuratedRecord[]; artifacts: Artifact[]; features: FeatureView[]; correlations: Array<{ domainA: string; domainB: string; count: number }>
  } {
    const curatedRecords = this.queryCuratedRecords({ domain: params.domains })
    const artifacts = params.domains.flatMap(d => this.queryArtifacts({ domain: [d], from_date: params.timeRange?.from }))
    const features = this.queryFeatureViews({})
    const domainCounts = new Map<string, number>()
    for (const record of curatedRecords) {
      for (const domain of record.domains) domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1)
    }
    const correlations: Array<{ domainA: string; domainB: string; count: number }> = []
    const domainList = Array.from(domainCounts.keys())
    for (let i = 0; i < domainList.length; i++) {
      for (let j = i + 1; j < domainList.length; j++) {
        const countA = domainCounts.get(domainList[i]) || 0
        const countB = domainCounts.get(domainList[j]) || 0
        if (countA > 0 && countB > 0) correlations.push({ domainA: domainList[i], domainB: domainList[j], count: Math.min(countA, countB) })
      }
    }
    return { entities: curatedRecords, artifacts, features, correlations }
  }

  private findRootId(parentIds: string[]): string {
    if (parentIds.length === 0) return ''
    let current = parentIds[0]
    const visited = new Set<string>()
    while (current) {
      if (visited.has(current)) break
      visited.add(current)
      const artifact = this.artifacts.get(current)
      if (!artifact || artifact.lineage.parent_ids.length === 0) return current
      current = artifact.lineage.parent_ids[0]
    }
    return current
  }

  private computeDepth(parentIds: string[]): number {
    return parentIds.length
  }

  getStats(): { totalArtifacts: number; totalCuratedRecords: number; totalFeatureViews: number; lineageNodes: number; domains: string[] } {
    const domains = new Set<string>()
    for (const artifact of this.artifacts.values()) {
      for (const d of artifact.metadata.domain as string[] || []) domains.add(d)
    }
    for (const record of this.curatedRecords.values()) {
      for (const d of record.domains) domains.add(d)
    }
    return {
      totalArtifacts: this.artifacts.size,
      totalCuratedRecords: this.curatedRecords.size,
      totalFeatureViews: this.featureViews.size,
      lineageNodes: this.lineageGraph.size,
      domains: Array.from(domains),
    }
  }
}

export const knowledgeStore = KnowledgeStore.getInstance()
