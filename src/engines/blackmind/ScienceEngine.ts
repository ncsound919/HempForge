import { eventBus } from './EventBus'
import { knowledgeStore } from './KnowledgeStore'
import { crossDomainAnalytics, type CrossDomainAnalytics } from './CrossDomainAnalytics'
import { scientificOutputValidator } from './ScientificOutputValidator'
import { freeAPIsEngine } from './FreeAPIsEngine'
import { type WorkflowOrchestrator } from './WorkflowOrchestrator'
import { type BlackMindBrain } from './BlackMindBrain'

interface HypotheticalDeduction {
  hypothesis: string
  confidence: number
  supportingEvidence: string[]
  contradictoryEvidence: string[]
  testabilityScore: number
  domain: string
  noveltyScore: number
}

interface ScientificPaper {
  title: string
  abstract: string
  authors: string[]
  year: number
  doi?: string
  pmid?: string
  journal?: string
  citations?: number
}

interface Patent {
  title: string
  number: string
  assignee?: string
  year: number
  abstract: string
  citations: number
  technologyDomain: string
}

interface IsomorphismMatch {
  sourceDomain: string
  targetDomain: string
  pattern: string
  confidence: number
  mechanism: string
  similarity: number
}

interface ExternalScienceAdapters {
  queryPapers(params: { query: string; databases?: string[]; limit?: number; fromYear?: number }): Promise<ScientificPaper[]>
  queryPatents(params: { query: string; limit?: number; fromYear?: number }): Promise<Patent[]>
}

const stubAdapters: ExternalScienceAdapters = {
  async queryPapers() { return [] },
  async queryPatents() { return [] },
}

interface EntityRelationship {
  subject: string
  predicate: string
  object: string
  confidence: number
  evidence: string[]
  domain: string
}

export class ScienceEngine {
  private orchestrator: WorkflowOrchestrator | null = null
  private brain: BlackMindBrain | null = null
  private adapters: ExternalScienceAdapters
  private pendingHypotheses: HypotheticalDeduction[] = []
  private currentCycle = 0

  constructor(adapters?: ExternalScienceAdapters) {
    this.adapters = adapters || stubAdapters
  }

  setOrchestrator(orch: WorkflowOrchestrator): void { this.orchestrator = orch }
  setBrain(b: BlackMindBrain): void { this.brain = b }

  async generateHypothesis(domain: string, context: Record<string, any>): Promise<HypotheticalDeduction> {
    const related = crossDomainAnalytics.semanticSearch({ query: context.query || context.focus || '', domains: [domain], limit: 10 })
    const existingPatterns = related.map(r => r.summary)
    const basePattern = existingPatterns.length > 0 ? existingPatterns.join('; ') : 'No prior patterns found'
    const hypothesis: HypotheticalDeduction = {
      hypothesis: `${domain}: ${context.query || context.focus || 'Unknown focus'} - Deduced pattern from ${basePattern.substring(0, 100)}`,
      confidence: Math.min(0.8, related.length * 0.08),
      supportingEvidence: related.slice(0, 3).map(r => r.summary),
      contradictoryEvidence: [],
      testabilityScore: related.length > 0 ? Math.min(1, related.length * 0.1) : 0.3,
      domain,
      noveltyScore: existingPatterns.length === 0 ? 1 : Math.max(0.1, 1 - existingPatterns.length * 0.1),
    }
    this.pendingHypotheses.push(hypothesis)
    eventBus.emit('hypothesis.generated', {
      domain: [domain], source_system: 'science_engine', subject_id: `hypothesis_${domain}_${Date.now()}`,
      payload: { hypothesis, context }, metadata: { domain, confidence: hypothesis.confidence, novelty: hypothesis.noveltyScore },
    })
    return hypothesis
  }

  async testHypothesis(hypothesis: HypotheticalDeduction): Promise<{ validated: boolean; score: number; evidence: string[]; contradictions: string[] }> {
    const testResult = await this.designExperiment(hypothesis)
    const evidence: string[] = []
    const contradictions: string[] = []
    if (testResult.expected) evidence.push(`Predicted outcome aligns with hypothesis: ${testResult.expected}`)
    if (testResult.controls) evidence.push(`Controls confirm hypothesis: ${testResult.controls.join(', ')}`)
    if (testResult.variables) contradictions.push(...testResult.variables.filter(v => v.conflict).map(v => `Variable ${v.name} conflicts: ${v.conflict}`))
    const score = evidence.length / Math.max(1, evidence.length + contradictions.length)
    const validated = score >= 0.6
    eventBus.emit('hypothesis.tested', {
      domain: [hypothesis.domain], source_system: 'science_engine', subject_id: `test_${hypothesis.domain}_${Date.now()}`,
      payload: { hypothesis, validated, score, evidence, contradictions }, metadata: { domain: hypothesis.domain, validated, score },
    })
    return { validated, score, evidence, contradictions }
  }

  async designExperiment(hypothesis: HypotheticalDeduction): Promise<{ expected?: string; controls?: string[]; variables: Array<{ name: string; expected: string; conflict?: string }> }> {
    const variables = [
      { name: 'primary_outcome', expected: 'confirm' },
      { name: 'secondary_effect', expected: 'positive', conflict: undefined as string | undefined },
      { name: 'confounding_factor', expected: 'controlled', conflict: hypothesis.testabilityScore < 0.5 ? 'poor testability' : undefined },
    ]
    return {
      expected: `Hypothesis "${hypothesis.hypothesis.substring(0, 50)}" expected to confirm primary prediction`,
      controls: ['negative_control', 'positive_control'],
      variables: variables.filter(v => v),
    }
  }

  async discoverIsomorphism(params: { sourceDomain: string; targetDomain: string; depth?: number }): Promise<IsomorphismMatch[]> {
    const sourcePatterns = crossDomainAnalytics.semanticSearch({ query: params.sourceDomain, domains: [params.sourceDomain], limit: 10 })
    const targetPatterns = crossDomainAnalytics.semanticSearch({ query: params.targetDomain, domains: [params.targetDomain], limit: 10 })
    const matches: IsomorphismMatch[] = []
    for (const source of sourcePatterns) {
      for (const target of targetPatterns) {
        const shared = source.tags.filter(t => target.tags.includes(t))
        if (shared.length > 0) {
          matches.push({
            sourceDomain: params.sourceDomain, targetDomain: params.targetDomain,
            pattern: shared[0], confidence: Math.min(1, shared.length / source.tags.length),
            mechanism: `shared_pattern:${shared[0]}`,
            similarity: shared.length / Math.max(1, Math.max(source.tags.length, target.tags.length)),
          })
        }
      }
    }
    const correlation = crossDomainAnalytics.computeCrossDomainCorrelation({ domainA: params.sourceDomain, domainB: params.targetDomain })
    if (correlation && correlation.correlation > 0.5) {
      matches.push({
        sourceDomain: params.sourceDomain, targetDomain: params.targetDomain,
        pattern: correlation.mechanism || 'statistical', confidence: Math.abs(correlation.correlation),
        mechanism: correlation.mechanism || 'statistical_correlation', similarity: Math.abs(correlation.correlation),
      })
    }
    return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 10)
  }

  async runScientificCycle(domain: string, context: Record<string, any>): Promise<{
    hypothesis: HypotheticalDeduction
    testResult: { validated: boolean; score: number; evidence: string[]; contradictions: string[] }
    isomorphisms: IsomorphismMatch[]
  }> {
    this.currentCycle++
    const hypothesis = await this.generateHypothesis(domain, context)
    const testResult = await this.testHypothesis(hypothesis)
    const isomorphisms = await this.discoverIsomorphism({ sourceDomain: domain, targetDomain: 'genomics', depth: 3 })
    if (testResult.validated) {
      const envelope = eventBus.publish({
        event_type: 'hypothesis_validated', source_system: 'science_engine',
        domain: [domain], subject_id: `cycle_${this.currentCycle}`,
        tags: ['validated', 'hypothesis'], metadata: { cycle: this.currentCycle, score: testResult.score },
      })
      knowledgeStore.storeCuratedRecord({
        event: envelope,
        entity_type: 'hypothesis', entity_id: hypothesis.hypothesis.substring(0, 64), summary: hypothesis.hypothesis,
        metrics: { confidence: hypothesis.confidence, novelty: hypothesis.noveltyScore, test_score: testResult.score },
        tags: ['validated', hypothesis.domain],
      })
    }
    eventBus.emit('science_cycle.completed', {
      domain: [domain], source_system: 'science_engine', subject_id: `cycle_${this.currentCycle}_${domain}`,
      payload: { cycle: this.currentCycle, hypothesis, testResult, isomorphisms }, metadata: { domain, cycle: this.currentCycle, validated: testResult.validated },
    })
    return { hypothesis, testResult, isomorphisms }
  }

  async crossDomainSearch(params: { query: string; domains: string[]; includePapers?: boolean; includePatents?: boolean }): Promise<{
    localResults: any[]; papers: ScientificPaper[]; patents: Patent[]; isomorphisms: IsomorphismMatch[]
  }> {
    const localResults = crossDomainAnalytics.semanticSearch({ query: params.query, domains: params.domains, limit: 20 })
    const [papers, patents] = await Promise.all([
      params.includePapers ? this.adapters.queryPapers({ query: params.query, limit: 10 }) : Promise.resolve([] as ScientificPaper[]),
      params.includePatents ? this.adapters.queryPatents({ query: params.query, limit: 10 }) : Promise.resolve([] as Patent[]),
    ])
    let isomorphisms: IsomorphismMatch[] = []
    for (let i = 0; i < params.domains.length; i++) {
      for (let j = i + 1; j < params.domains.length; j++) {
        const matches = await this.discoverIsomorphism({ sourceDomain: params.domains[i], targetDomain: params.domains[j], depth: 2 })
        isomorphisms = isomorphisms.concat(matches)
      }
    }
    return { localResults, papers, patents, isomorphisms: isomorphisms.slice(0, 20) }
  }

  async extractEntities(text: string): Promise<EntityRelationship[]> {
    const domainPatterns = [
      { domain: 'genomics', patterns: ['BRCA1', 'TP53', 'EGFR', 'KRAS', 'APOE', 'CFTR', 'HBB', 'DMD'] },
      { domain: 'neuroscience', patterns: ['dopamine', 'serotonin', 'cortisol', 'synaptic', 'neuron', 'hippocampus', 'prefrontal'] },
      { domain: 'immunology', patterns: ['cytokine', 'interleukin', 'TNF', 'IFN', 'antibody', 'antigen', 'macrophage', 'T cell', 'B cell'] },
      { domain: 'metabolomics', patterns: ['glucose', 'ATP', 'NADH', 'lactate', 'pyruvate', 'metabolite'] },
      { domain: 'microbiome', patterns: ['gut microbiome', 'probiotic', 'bifidobacterium', 'lactobacillus', 'firmicutes', 'bacteroidetes'] },
      { domain: 'proteomics', patterns: ['kinase', 'phosphatase', 'ubiquitin', 'proteasome', 'G protein', 'receptor'] },
    ]
    const textLower = text.toLowerCase()
    const relationships: EntityRelationship[] = []
    const allPatterns = domainPatterns.flatMap(dp => dp.patterns)
    for (const entity of allPatterns) {
      if (textLower.includes(entity.toLowerCase())) {
        const domain = domainPatterns.find(dp => dp.patterns.includes(entity))?.domain || 'unknown'
        relationships.push({
          subject: entity, predicate: 'mentioned_in', object: 'text',
          confidence: 0.7, evidence: [`Entity ${entity} found in text`], domain,
        })
      }
    }
    for (const dp of domainPatterns) {
      const found = dp.patterns.filter(p => textLower.includes(p.toLowerCase()))
      for (let i = 0; i < found.length; i++) {
        for (let j = i + 1; j < found.length; j++) {
          relationships.push({
            subject: found[i], predicate: 'co_occurs_with', object: found[j],
            confidence: 0.5, evidence: [`Both found in same text under domain ${dp.domain}`], domain: dp.domain,
          })
        }
      }
    }
    return relationships
  }

  getCycle(): number { return this.currentCycle }
}

export const scienceEngine = new ScienceEngine()
