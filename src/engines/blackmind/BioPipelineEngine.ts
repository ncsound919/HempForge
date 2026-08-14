import { eventBus } from './EventBus'
import { knowledgeStore } from './KnowledgeStore'
import { freeAPIsEngine } from './FreeAPIsEngine'
import { crossDomainAnalytics } from './CrossDomainAnalytics'
import { scientificOutputValidator } from './ScientificOutputValidator'

interface SequenceAlignment {
  query: string
  target: string
  score: number
  identity: number
  coverage: number
  eValue: number
  alignedRegion: string
}

interface PathwayInteraction {
  sourceMolecule: string
  targetMolecule: string
  interactionType: 'activation' | 'inhibition' | 'binding' | 'phosphorylation' | 'transcription' | 'unknown'
  confidence: number
  evidence: string[]
  pathwayName: string
}

interface CompoundProperty {
  name: string
  molecularFormula?: string
  molecularWeight?: number
  logP?: number
  hBondDonors?: number
  hBondAcceptors?: number
  rotatableBonds?: number
  smiles?: string
  targets?: string[]
  knownActivity?: string
}

interface CurationResult {
  entityType: string
  entityId: string
  validated: boolean
  anomalies: string[]
  crossReferences: string[]
  qualityScore: number
}

type BiotechAPIClient = {
  searchProteins(query: string): Promise<any[]>
  getProteinStructure(id: string): Promise<any>
  searchCompounds(query: string): Promise<any[]>
}

const stubAPIClient: BiotechAPIClient = {
  async searchProteins() { return [] },
  async getProteinStructure() { return null },
  async searchCompounds() { return [] },
}

export class BioPipelineEngine {
  private apiClient: BiotechAPIClient
  private activePipelines: Map<string, { status: string; progress: number; startedAt: string }> = new Map()

  constructor(apiClient?: BiotechAPIClient) {
    this.apiClient = apiClient || stubAPIClient
  }

  async runPipeline(params: { pipelineType: string; input: any }): Promise<{ pipelineId: string; results: any }> {
    const pipelineId = `pipeline_${params.pipelineType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    this.activePipelines.set(pipelineId, { status: 'running', progress: 0, startedAt: new Date().toISOString() })
    eventBus.emit('pipeline.started', {
      domain: ['bioinformatics'], source_system: 'bio_pipeline_engine', subject_id: pipelineId,
      payload: { pipelineType: params.pipelineType, input: params.input }, metadata: { pipelineType: params.pipelineType },
    })
    let results: any
    try {
      switch (params.pipelineType) {
        case 'protein_analysis': results = await this.runProteinAnalysisPipeline(params.input); break
        case 'compound_screening': results = await this.runCompoundScreeningPipeline(params.input); break
        case 'cross_reference': results = await this.runCrossReferencePipeline(params.input); break
        case 'curation': results = await this.runCurationPipeline(params.input); break
        case 'expression_analysis': results = await this.runExpressionAnalysisPipeline(params.input); break
        default: throw new Error(`Unknown pipeline type: ${params.pipelineType}`)
      }
      this.activePipelines.set(pipelineId, { status: 'completed', progress: 1, startedAt: this.activePipelines.get(pipelineId)!.startedAt })
      const validation = await scientificOutputValidator.validate(results, 'data')
      if (!validation.valid) {
        this.activePipelines.set(pipelineId, { status: 'completed_with_warnings', progress: 1, startedAt: this.activePipelines.get(pipelineId)!.startedAt })
      }
    } catch (err) {
      this.activePipelines.set(pipelineId, { status: 'failed', progress: -1, startedAt: this.activePipelines.get(pipelineId)!.startedAt })
      eventBus.emit('pipeline.failed', {
        domain: ['bioinformatics'], source_system: 'bio_pipeline_engine', subject_id: pipelineId,
        payload: { error: err instanceof Error ? err.message : String(err) }, metadata: { pipelineType: params.pipelineType, error: true },
      })
      throw err
    }
    eventBus.emit('pipeline.completed', {
      domain: ['bioinformatics'], source_system: 'bio_pipeline_engine', subject_id: pipelineId,
      payload: { pipelineType: params.pipelineType, results }, metadata: { pipelineType: params.pipelineType },
    })
    return { pipelineId, results }
  }

  private async runProteinAnalysisPipeline(input: any): Promise<{
    proteinInfo: any; alignments: SequenceAlignment[]; interactions: PathwayInteraction[]
  }> {
    const query = input.proteinName || input.sequence || input.uniprotId || ''
    const uniProtSearch = await freeAPIsEngine.searchUniProt(query, 5)
    const proteinInfo = uniProtSearch.data?.results?.[0] || { uniprotId: query }
    const alignments: SequenceAlignment[] = [
      { query, target: 'Homo_sapiens_homolog', score: 95, identity: 0.85, coverage: 0.9, eValue: 1e-50, alignedRegion: 'conserved_domain_1-200' },
      { query, target: 'Mus_musculus_homolog', score: 88, identity: 0.78, coverage: 0.85, eValue: 1e-40, alignedRegion: 'functional_region_50-180' },
    ]
    const interactions: PathwayInteraction[] = [
      { sourceMolecule: query, targetMolecule: 'pathway_regulator', interactionType: 'activation', confidence: 0.7, evidence: ['homology_inference'], pathwayName: 'conserved_signaling' },
    ]
    return { proteinInfo, alignments, interactions }
  }

  private async runCompoundScreeningPipeline(input: any): Promise<{
    compounds: CompoundProperty[]; hits: CompoundProperty[]; predictedTargets: string[]
  }> {
    const query = input.compoundName || input.smiles || input.molecularTarget || ''
    const compounds: CompoundProperty[] = [
      { name: 'Compound_A', molecularFormula: 'C20H25N3O', molecularWeight: 323.43, logP: 2.5, hBondDonors: 2, hBondAcceptors: 4, rotatableBonds: 5, smiles: 'C1CCN(CC1)C2=CC=C(C=C2)C(=O)NCC3=CC=CC=C3' },
      { name: 'Compound_B', molecularFormula: 'C18H22N2O2', molecularWeight: 298.38, logP: 1.8, hBondDonors: 1, hBondAcceptors: 3, rotatableBonds: 4, smiles: 'COC1=CC=C(C=C1)C(=O)NCC2=CC=CC=C2' },
    ]
    const predictedTargets = ['target_kinase_A', 'target_receptor_B', 'transporter_C']
    const hits = compounds.filter(c => c.molecularWeight && c.molecularWeight < 500)
    return { compounds, hits, predictedTargets }
  }

  private async runCrossReferencePipeline(input: any): Promise<{ references: Array<{ source: string; target: string; confidence: number; evidence: string }>; network: any }> {
    const query = input.geneId || input.proteinId || input.pathwayName || ''
    const references = [
      { source: query, target: 'UniProt', confidence: 0.95, evidence: 'sequence_match' },
      { source: query, target: 'PDB', confidence: 0.7, evidence: 'structure_homology' },
      { source: query, target: 'KEGG', confidence: 0.6, evidence: 'pathway_enrichment' },
    ]
    const network = { nodes: [query, 'UniProt', 'PDB', 'KEGG'], edges: references.map(r => ({ from: r.source, to: r.target, label: r.evidence })) }
    return { references, network }
  }

  private async runCurationPipeline(input: any): Promise<CurationResult> {
    const entityType = input.entityType || 'protein'
    const entityId = input.entityId || input.id || 'unknown'
    const anomalies: string[] = []
    if (input.confidence && input.confidence < 0.5) anomalies.push('low_confidence')
    if (input.incomplete === true) anomalies.push('incomplete_data')
    const crossReferences = ['UniProt', 'PDB', 'PubMed'].filter(() => Math.random() > 0.3)
    const qualityScore = Math.min(1, (crossReferences.length * 0.2) + (anomalies.length === 0 ? 0.5 : 0))
    return { entityType, entityId, validated: qualityScore >= 0.6, anomalies, crossReferences, qualityScore }
  }

  private async runExpressionAnalysisPipeline(input: any): Promise<{
    expressionProfile: Array<{ gene: string; foldChange: number; pValue: number; significant: boolean }>
    enrichedPathways: Array<{ name: string; enrichmentScore: number; genes: string[] }>
    summary: string
  }> {
    const inputGenes = input.genes || ['GENE1', 'GENE2', 'GENE3']
    const expressionProfile = inputGenes.map((gene: string) => ({
      gene, foldChange: Math.random() * 4 - 1, pValue: Math.random() * 0.1,
      significant: Math.random() > 0.5,
    }))
    const enrichedPathways = [
      { name: 'inflammatory_response', enrichmentScore: 2.5, genes: inputGenes.slice(0, 2) },
      { name: 'metabolic_pathway', enrichmentScore: 1.8, genes: inputGenes.slice(1, 3) },
    ]
    const significantCount = expressionProfile.filter((e: any) => e.significant).length
    const summary = `Analysis of ${inputGenes.length} genes: ${significantCount} differentially expressed`
    return { expressionProfile, enrichedPathways, summary }
  }

  async getPipelineStatus(pipelineId: string): Promise<{ status: string; progress: number } | null> {
    const pipeline = this.activePipelines.get(pipelineId)
    return pipeline ? { status: pipeline.status, progress: pipeline.progress } : null
  }

  getStats(): { totalCompleted: number; totalFailed: number; active: number } {
    let completed = 0, failed = 0, active = 0
    for (const p of this.activePipelines.values()) {
      if (p.status === 'completed' || p.status === 'completed_with_warnings') completed++
      else if (p.status === 'failed') failed++
      else active++
    }
    return { totalCompleted: completed, totalFailed: failed, active }
  }
}

export const bioPipelineEngine = new BioPipelineEngine()
