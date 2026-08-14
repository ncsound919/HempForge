import { eventBus } from './EventBus'
import { knowledgeStore } from './KnowledgeStore'
import { crossDomainAnalytics } from './CrossDomainAnalytics'
import { scienceEngine, type ScienceEngine } from './ScienceEngine'
import { bioPipelineEngine, type BioPipelineEngine } from './BioPipelineEngine'
import { workflowOrchestrator, type WorkflowOrchestrator } from './WorkflowOrchestrator'
import { scientificOutputValidator } from './ScientificOutputValidator'
import { dataBus } from './DataBus'
import type { Hypothesis, IsomorphismMatch, TransferProposal, ClassifiedInsight, TraversalFinding, ManifoldTopology } from './types'

const stubCommandEngine = {
  async execute(command: string) { return { executed: true, command, output: 'stub_output' } },
  getHistory() { return [] },
}

const stubSecurityEngine = {
  async validateInput(input: any) { return { valid: true, sanitized: input } },
  async checkPermissions(userId: string) { return { permitted: true, roles: ['researcher'] } },
}

const stubReasoningPersistenceEngine = {
  async save(params: any) {},
  async load(id: string) { return null },
  async query(filters: any) { return [] },
}

const stubFinancialEngine = {
  async analyzeBudget(params: any) { return { feasible: true, estimatedCost: 1000, currency: 'USD' } },
  async allocateResources(params: any) { return { allocated: true, budget: 1000 } },
}

const stubKnowledgeIngestionEngine = {
  async ingest(params: any) { return { ingested: true, entities: [], relationships: [] } },
  async transform(params: any) { return { transformed: true } },
}

const stubPatternRecognitionEngine = {
  async findIsomorphisms(params: any) { return [] as IsomorphismMatch[] },
  async detectNovelPatterns(params: any) { return { patterns: [] } },
}

const stubMetabolicModelingEngine = {
  async buildModel(params: any) { return { modelId: 'stub', compartments: [], reactions: [] } },
  async simulate(params: any) { return { fluxDistribution: {}, growthRate: 0 } },
}

const stubNLPEngine = {
  async analyze(params: any) { return { entities: [], relationships: [], sentiment: 0 } },
  async generateInsights(params: any) { return [] },
}

const stubTransferLearningEngine = {
  async proposeTransfer(params: any) { return [] as TransferProposal[] },
  async executeTransfer(params: any) { return { transferred: true, performance: {} } },
}

const stubCrossModalEngine = {
  async align(params: any) { return { aligned: true, similarity: 0.5 } },
  async fuse(params: any) { return { fused: true, embeddings: [] } },
}

const stubQuantumEngine = {
  async query(params: any) { return { result: 'stub_quantum_result', confidence: 0.5 } },
  async optimize(params: any) { return { optimized: true, solution: {} } },
}

interface EngineSet {
  commandEngine: typeof stubCommandEngine
  securityEngine: typeof stubSecurityEngine
  reasoningPersistenceEngine: typeof stubReasoningPersistenceEngine
  financialEngine: typeof stubFinancialEngine
  knowledgeIngestionEngine: typeof stubKnowledgeIngestionEngine
  patternRecognitionEngine: typeof stubPatternRecognitionEngine
  metabolicModelingEngine: typeof stubMetabolicModelingEngine
  nlpEngine: typeof stubNLPEngine
  transferLearningEngine: typeof stubTransferLearningEngine
  crossModalEngine: typeof stubCrossModalEngine
  quantumEngine: typeof stubQuantumEngine
}

interface BlackMindCycleMetrics {
  cycleNumber: number
  startTime: string
  duration: number
  hypothesesGenerated: number
  insightsClassified: number
  isomorphismsFound: number
  transfersProposed: number
  errors: string[]
}

export class BlackMindBrain {
  private scienceEngine: ScienceEngine | null = null
  private bioPipelineEngine: BioPipelineEngine | null = null
  private workflowOrchestrator: WorkflowOrchestrator | null = null
  private engines: EngineSet | null = null
  private active = false
  private cycleInterval: ReturnType<typeof setInterval> | null = null
  private currentCycle = 0
  private cycleHistory: BlackMindCycleMetrics[] = []
  private focusAreas: string[] = ['genomics', 'neuroscience', 'immunology', 'metabolomics', 'microbiome', 'proteomics']
  private errorCount = 0
  private maxErrorsBeforeStop = 10
  private truthMaintenanceQueue: Array<{ type: string; data: any; timestamp: string }> = []

  private static instance: BlackMindBrain | null = null

  private constructor() {}

  static getInstance(): BlackMindBrain {
    if (!BlackMindBrain.instance) BlackMindBrain.instance = new BlackMindBrain()
    return BlackMindBrain.instance
  }

  setEngines(science: ScienceEngine, bio: BioPipelineEngine, wf: WorkflowOrchestrator): void {
    this.scienceEngine = science
    this.bioPipelineEngine = bio
    this.workflowOrchestrator = wf
    science.setBrain(this)
    science.setOrchestrator(wf)
  }

  setStubs(stubs: Partial<EngineSet>): void {
    this.engines = {
      commandEngine: stubCommandEngine, securityEngine: stubSecurityEngine,
      reasoningPersistenceEngine: stubReasoningPersistenceEngine, financialEngine: stubFinancialEngine,
      knowledgeIngestionEngine: stubKnowledgeIngestionEngine, patternRecognitionEngine: stubPatternRecognitionEngine,
      metabolicModelingEngine: stubMetabolicModelingEngine, nlpEngine: stubNLPEngine,
      transferLearningEngine: stubTransferLearningEngine, crossModalEngine: stubCrossModalEngine,
      quantumEngine: stubQuantumEngine, ...stubs,
    }
  }

  private getE(): EngineSet {
    if (!this.engines) this.setStubs({})
    return this.engines!
  }

  async start(intervalMs = 60000): Promise<void> {
    if (this.active) return
    this.active = true
    eventBus.emit('brain.started', {
      domain: this.focusAreas, source_system: 'blackmind_brain', subject_id: 'brain_main',
      payload: { focusAreas: this.focusAreas, intervalMs }, metadata: { focusAreas: this.focusAreas },
    })
    this.runAutonomousCycle()
    this.cycleInterval = setInterval(() => this.runAutonomousCycle(), intervalMs)
  }

  stop(): void {
    this.active = false
    if (this.cycleInterval !== null) { clearInterval(this.cycleInterval); this.cycleInterval = null }
    eventBus.emit('brain.stopped', {
      domain: this.focusAreas, source_system: 'blackmind_brain', subject_id: 'brain_main',
      payload: { cyclesCompleted: this.currentCycle }, metadata: { cyclesCompleted: this.currentCycle },
    })
  }

  isActive(): boolean { return this.active }

  private async runAutonomousCycle(): Promise<void> {
    if (!this.active) return
    this.currentCycle++
    const cycleStart = Date.now()
    const metrics: BlackMindCycleMetrics = { cycleNumber: this.currentCycle, startTime: new Date().toISOString(), duration: 0, hypothesesGenerated: 0, insightsClassified: 0, isomorphismsFound: 0, transfersProposed: 0, errors: [] }
    try {
      const insights = await this.gatherInsights()
      metrics.insightsClassified = insights.length
      const focusArea = this.focusAreas[this.currentCycle % this.focusAreas.length]
      const hypothesis = await this.scienceEngine!.runScientificCycle(focusArea, { query: insights.map(i => i.summary).join(' '), focus: focusArea })
      metrics.hypothesesGenerated = 1
      if (hypothesis.isomorphisms.length > 0) {
        for (const iso of hypothesis.isomorphisms) {
          const proposal = await this.generateTransferProposal(iso)
          metrics.transfersProposed++
          if (proposal) {
            eventBus.emit('transfer.proposed', {
              domain: [iso.sourceDomain, iso.targetDomain], source_system: 'blackmind_brain', subject_id: `transfer_${iso.sourceDomain}_${iso.targetDomain}`,
              payload: { proposal, isomorphism: iso }, metadata: { confidence: iso.confidence, sourceDomain: iso.sourceDomain, targetDomain: iso.targetDomain },
            })
          }
        }
      }
      metrics.isomorphismsFound = hypothesis.isomorphisms.length
      this.maintainTruth(hypothesis)
      this.generateCrossDomainInsights(insights)
      dataBus.emit('brain_cycle_completed', { cycle: this.currentCycle, metrics: { ...metrics }, timestamp: new Date().toISOString() })
      this.errorCount = 0
    } catch (err) {
      this.errorCount++
      metrics.errors.push(err instanceof Error ? err.message : String(err))
      if (this.errorCount >= this.maxErrorsBeforeStop) {
        this.stop()
        dataBus.emit('brain_emergency_stop', { reason: `Too many errors: ${this.errorCount}`, cycle: this.currentCycle, timestamp: new Date().toISOString() })
      }
    }
    metrics.duration = Date.now() - cycleStart
    this.cycleHistory.push(metrics)
    if (this.cycleHistory.length > 100) this.cycleHistory.shift()
    eventBus.emit('brain.cycle.completed', {
      domain: this.focusAreas, source_system: 'blackmind_brain', subject_id: `cycle_${this.currentCycle}`,
      payload: { cycle: this.currentCycle, metrics }, metadata: { cycle: this.currentCycle, duration: metrics.duration, errors: metrics.errors.length },
    })
  }

  private async gatherInsights(): Promise<any[]> {
    const insights: any[] = []
    const records = knowledgeStore.queryCuratedRecords({ limit: 10 })
    for (const record of records) {
      const targetDomain = this.focusAreas.find(d => record.domains.includes(d)) || record.domains[0]
      insights.push({
        id: record.id, type: 'entity', summary: record.summary, domain: targetDomain,
        confidence: record.confidence, timestamp: record.created_at,
        tags: record.tags, sourceSystem: 'knowledge_store',
        entityType: record.entity_type, entityId: record.entity_id,
      })
    }
    return insights
  }

  private async generateTransferProposal(isomorphism: IsomorphismMatch): Promise<TransferProposal | null> {
    return {
      id: `transfer_${Date.now()}`,
      sourceDomain: isomorphism.sourceDomain,
      targetDomain: isomorphism.targetDomain,
      pattern: isomorphism.pattern,
      confidence: isomorphism.confidence,
      estimatedImpact: isomorphism.similarity,
      mechanism: isomorphism.mechanism,
      riskFactors: isomorphism.confidence < 0.5 ? ['low_confidence'] : [],
      recommendedExperiments: [`validate_${isomorphism.mechanism}_in_${isomorphism.targetDomain}`],
    }
  }

  private maintainTruth(hypothesisResult: any): void {
    const entry = { type: 'hypothesis', data: hypothesisResult, timestamp: new Date().toISOString() }
    this.truthMaintenanceQueue.push(entry)
    if (this.truthMaintenanceQueue.length > 50) this.truthMaintenanceQueue.shift()
    if (hypothesisResult.testResult?.validated) {
      const envelope = eventBus.publish({
        event_type: 'truth_maintained', source_system: 'blackmind_brain',
        domain: ['truth_maintenance'], subject_id: `tm_${Date.now()}`,
        tags: ['truth', 'validated'], metadata: {},
      })
      knowledgeStore.storeCuratedRecord({
        event: envelope,
        entity_type: 'validated_hypothesis',
        entity_id: hypothesisResult.hypothesis?.hypothesis?.substring(0, 64) || 'unknown',
        summary: hypothesisResult.hypothesis?.hypothesis || 'Validated hypothesis',
        metrics: { confidence: hypothesisResult.hypothesis?.confidence || 0, testScore: hypothesisResult.testResult?.score || 0 },
        tags: ['truth_maintained', 'validated'],
        confidence: Math.max(0.7, hypothesisResult.testResult?.score || 0.7),
      })
    }
  }

  private generateCrossDomainInsights(insights: ClassifiedInsight[]): void {
    const domainGroups = new Map<string, ClassifiedInsight[]>()
    for (const insight of insights) {
      if (!domainGroups.has(insight.domain)) domainGroups.set(insight.domain, [])
      domainGroups.get(insight.domain)!.push(insight)
    }
    const domains = Array.from(domainGroups.keys())
    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        const corr = crossDomainAnalytics.computeCrossDomainCorrelation({ domainA: domains[i], domainB: domains[j] })
        if (corr && corr.correlation > 0.3) {
          eventBus.emit('cross_domain_insight.generated', {
            domain: [domains[i], domains[j]], source_system: 'blackmind_brain',
            subject_id: `cdi_${domains[i]}_${domains[j]}_${Date.now()}`,
            payload: { correlation: corr, sourceInsights: { [domains[i]]: domainGroups.get(domains[i])!, [domains[j]]: domainGroups.get(domains[j])! } },
            metadata: { correlation: corr.correlation, correlationStrength: corr.strength, mechanism: corr.mechanism },
          })
        }
      }
    }
  }

  setFocusAreas(areas: string[]): void { this.focusAreas = areas }
  getFocusAreas(): string[] { return [...this.focusAreas] }
  getCurrentCycle(): number { return this.currentCycle }

  getCycleHistory(): BlackMindCycleMetrics[] {
    return this.cycleHistory.map(m => ({ ...m }))
  }

  getStats(): { cyclesCompleted: number; averageDuration: number; totalErrors: number; isActive: boolean; focusAreas: string[]; truthQueueSize: number } {
    const durations = this.cycleHistory.map(m => m.duration)
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
    const totalErrors = this.cycleHistory.reduce((sum, m) => sum + m.errors.length, 0)
    return { cyclesCompleted: this.currentCycle, averageDuration: avgDuration, totalErrors, isActive: this.active, focusAreas: [...this.focusAreas], truthQueueSize: this.truthMaintenanceQueue.length }
  }

  async executeCommand(command: string, params?: Record<string, any>): Promise<any> {
    return this.getE().commandEngine.execute(command)
  }

  async queryKnowledge(params: { query: string; limit?: number }): Promise<any> {
    return crossDomainAnalytics.semanticSearch({ query: params.query, limit: params.limit || 20 })
  }

  async runPipeline(params: { pipelineType: string; input: any }): Promise<any> {
    if (!this.bioPipelineEngine) throw new Error('BioPipelineEngine not set')
    return this.bioPipelineEngine.runPipeline(params)
  }

  async runWorkflow(params: { workflowName: string; description: string; tasks: Array<{ name: string; params: Record<string, any>; dependencies: string[] }> }): Promise<any> {
    const wfId = workflowOrchestrator.createWorkflow({
      name: params.workflowName,
      description: params.description,
      tasks: params.tasks,
    })
    return workflowOrchestrator.executeWorkflow(wfId)
  }

  async searchScientificLiterature(params: { query: string; databases?: string[]; limit?: number }): Promise<any> {
    if (!this.scienceEngine) throw new Error('ScienceEngine not set')
    return this.scienceEngine.crossDomainSearch({ query: params.query, domains: params.databases || ['genomics', 'neuroscience'], includePapers: true, includePatents: false })
  }

  async extractEntitiesFromText(text: string): Promise<any> {
    if (!this.scienceEngine) throw new Error('ScienceEngine not set')
    return this.scienceEngine.extractEntities(text)
  }

  async generateHypothesis(params: { domain: string; context: Record<string, any> }): Promise<any> {
    if (!this.scienceEngine) throw new Error('ScienceEngine not set')
    return this.scienceEngine.generateHypothesis(params.domain, params.context)
  }

  async detectAnomalies(params: { domain?: string; threshold?: number }): Promise<any> {
    return crossDomainAnalytics.detectAnomalies(params)
  }

  async getSystemStats(): Promise<any> {
    return {
      brain: this.getStats(),
      knowledgeStore: knowledgeStore.getStats(),
      analytics: { totalAnomalies: crossDomainAnalytics.detectAnomalies({}).length },
    }
  }
}

export const blackMindBrain = BlackMindBrain.getInstance()
