export type EventType =
  | 'lab.output.created' | 'pipeline.stage.completed'
  | 'experiment.run.started' | 'experiment.run.completed' | 'experiment.run.failed'
  | 'sample.processed' | 'analysis.started' | 'analysis.completed' | 'analysis.failed'
  | 'agent.insight.generated' | 'agent.task.started' | 'agent.task.completed'
  | 'simulation.started' | 'simulation.finished' | 'simulation.failed'
  | 'model.checkpoint.created' | 'data.ingested'
  | 'validation.passed' | 'validation.failed' | 'governance.audit'
  | 'system.health' | 'drift.detected' | 'anomaly.detected'
  // BlackMind engine runtime topics (used by BlackMindBrain / BioPipeline /
  // ScienceEngine / WorkflowOrchestrator)
  | 'brain.started' | 'brain.stopped' | 'brain.cycle.completed'
  | 'transfer.proposed' | 'cross_domain_insight.generated'
  | 'truth_maintained' | 'hypothesis.generated' | 'hypothesis.tested'
  | 'hypothesis_validated' | 'science_cycle.completed'
  | 'pipeline.started' | 'pipeline.completed' | 'pipeline.failed'
  | 'workflow.created' | 'workflow.started' | 'workflow.completed' | 'workflow.failed'
  | 'scientific_search.completed'
  | 'task.completed'

export type SourceSystem =
  | 'blackmind' | 'ai_scientist' | 'open_deep_researcher' | 'cosmos'
  | 'science_engine' | 'bio_pipeline' | 'financial_engine' | 'nexus'
  | 'claude' | 'external' | 'science_engine_prod'
  // BlackMind engine runtime source systems
  | 'blackmind_brain' | 'bio_pipeline_engine' | 'free_apis_engine'
  | 'workflow_orchestrator'

export type EventStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying'
export type SecurityClass = 'public' | 'internal' | 'confidential' | 'restricted'

export interface CanonicalEventEnvelope {
  event_id: string
  event_type: EventType
  source_system: SourceSystem
  domain: string[]
  subject_id: string
  experiment_id?: string
  run_id?: string
  sample_id?: string
  simulation_id?: string
  timestamp_utc: string
  schema_version: string
  payload_ref: string
  payload_hash: string
  status: EventStatus
  quality_score?: number
  lineage_parent_ids: string[]
  security_class: SecurityClass
  tags: string[]
  metadata?: Record<string, unknown>
}

export function createCanonicalEnvelope(params: {
  event_type: EventType
  source_system: SourceSystem
  domain: string[]
  subject_id: string
  payload_ref: string
  status?: EventStatus
  security_class?: SecurityClass
  experiment_id?: string
  run_id?: string
  sample_id?: string
  simulation_id?: string
  lineage_parent_ids?: string[]
  tags?: string[]
  metadata?: Record<string, unknown>
}): CanonicalEventEnvelope {
  const now = new Date().toISOString()
  return {
    event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    event_type: params.event_type,
    source_system: params.source_system,
    domain: params.domain,
    subject_id: params.subject_id,
    experiment_id: params.experiment_id,
    run_id: params.run_id,
    sample_id: params.sample_id,
    simulation_id: params.simulation_id,
    timestamp_utc: now,
    schema_version: '1.0.0',
    payload_ref: params.payload_ref,
    payload_hash: '',
    status: params.status || 'pending',
    lineage_parent_ids: params.lineage_parent_ids || [],
    security_class: params.security_class || 'internal',
    tags: params.tags || [],
    metadata: params.metadata,
  }
}

export function computePayloadHash(payload: unknown): string {
  const str = JSON.stringify(payload)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16)
}

export interface ScienceQuery {
  id: string
  type:
    | 'pubmed' | 'uniprot' | 'alphafold' | 'crispr' | 'sequence' | 'bbtech' | 'nexus' | 'experiment'
    | 'colabfold' | 'molecular_graph' | 'pharmacogenomics' | 'quantum_sim'
    | 'deep_research' | 'clinical_trial' | 'cheetah' | 'ai_scientist'
    | 'data_visualization' | 'agent_council'
    | 'open_deep_researcher' | 'cosmos' | 'external_ai_scientist'
  query: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  startedAt: string
  completedAt: string | null
  result: unknown
  insightsGenerated: number
}

export interface ScienceProject {
  id: string
  name: string
  description: string
  domain:
    | 'genomics' | 'proteomics' | 'drug_discovery' | 'biomarker' | 'cross_domain' | 'custom'
    | 'structural_biology' | 'cheminformatics' | 'clinical' | 'surgical'
    | 'quantum_chemistry' | 'data_science' | 'gene_therapy' | 'medical_imaging'
  queries: ScienceQuery[]
  status: 'active' | 'paused' | 'completed'
  createdAt: string
  breakthroughs: number
}

export interface ScienceSummary {
  totalProjects: number
  activeProjects: number
  totalQueries: number
  completedQueries: number
  insightsGenerated: number
  breakthroughsDetected: number
  domains: string[]
  projects: ScienceProject[]
  availablePipelines: string[]
  availableQueryTypes: string[]
}

export interface PipelineStep {
  id: string
  name: string
  type: 'biotech_server' | 'free_api' | 'transform' | 'parallel'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  input?: Record<string, any>
  output?: any
  error?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

export interface Pipeline {
  id: string
  name: string
  description: string
  steps: PipelineStep[]
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
  metadata?: Record<string, any>
}

export type PipelineTemplate = {
  name: string
  description: string
  steps: Omit<PipelineStep, 'status' | 'output' | 'error' | 'startedAt' | 'completedAt' | 'durationMs'>[]
}

export interface Artifact {
  id: string
  type: 'raw' | 'curated' | 'feature_view'
  content_type: string
  storage_ref: string
  size_bytes?: number
  checksum: string
  created_at: string
  created_by: string
  lineage: LineageRecord
  metadata: Record<string, unknown>
}

export interface LineageRecord {
  event_id: string
  parent_ids: string[]
  root_id: string
  depth: number
  paths: string[]
}

export interface CuratedRecord {
  id: string
  source_event_id: string
  entity_type: string
  entity_id: string
  domains: string[]
  summary: string
  metrics: Record<string, number>
  tags: string[]
  confidence: number
  created_at: string
  updated_at: string
}

export interface FeatureView {
  id: string
  source_record_id: string
  features: Record<string, number | string>
  embeddings?: number[]
  anomaly_score?: number
  trend_direction?: 'up' | 'down' | 'stable'
  computed_at: string
}

export interface TrendAnalysis {
  domain: string
  direction: 'up' | 'down' | 'stable'
  slope: number
  confidence: number
  data_points: number
  period: string
}

export interface AnomalyReport {
  id: string
  domain: string
  type: 'point' | 'contextual' | 'collective' | 'trend'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  timestamp: string
  metrics: Record<string, number>
  z_score?: number
}

export interface CrossDomainCorrelation {
  domainA: string
  domainB: string
  correlation: number
  strength: 'weak' | 'moderate' | 'strong' | 'very_strong'
  significance: number
  sample_size: number
  mechanism?: string
}

export interface ReproducibilityScore {
  entity_id: string
  score: number
  runs: number
  consistency: number
  factors: string[]
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  metadata: {
    validatedAt: string
    validatorVersion: string
    inputHash: string
    validationDuration: number
  }
}

export interface ValidationError {
  code: string
  message: string
  severity: 'error' | 'critical'
  field?: string
  value?: unknown
}

export interface ValidationWarning {
  code: string
  message: string
  suggestion?: string
}

export type ValidatorType =
  | 'data' | 'trend' | 'insight' | 'cross-domain' | 'multimodal' | 'drift' | 'science-paper'

export interface ValidationConfig {
  enabledValidators: ValidatorType[]
  strictMode: boolean
  allowWarnings: boolean
  thresholds: {
    minConfidence: number
    maxPValue: number
    maxNoiseRatio: number
    maxDriftScore: number
  }
}

export type BusDomain =
  | 'reasoning' | 'science' | 'financial' | 'business' | 'music'
  | 'overlay365' | 'build' | 'system' | 'security' | 'biotech'
  | 'agent_council' | 'gateway' | 'vscode' | 'workforce' | 'temporal'
  | 'fusion' | 'swarm' | 'autonomy'

export type BusEventType =
  | 'insight:created' | 'insight:updated' | 'hypothesis:generated'
  | 'isomorphism:detected' | 'contradiction:detected' | 'contradiction:resolved'
  | 'transfer:proposed' | 'breakthrough:detected' | 'objective:created'
  | 'objective:completed' | 'objective:failed' | 'market:updated'
  | 'signal:generated' | 'strategy:evolved' | 'backtest:complete'
  | 'risk:alert' | 'order:placed' | 'order:executed' | 'portfolio:rebalanced'
  | 'cashflow:recorded' | 'goal:updated' | 'opportunity:created'
  | 'opportunity:advanced' | 'revenue:stream:created'
  | 'pipeline:build:started' | 'pipeline:build:completed' | 'pipeline:build:failed'
  | 'pipeline:test:passed' | 'pipeline:deploy:started'
  | 'science:query:completed' | 'science:sequence:analyzed'
  | 'science:structure:predicted' | 'science:crispr:designed'
  | 'science:experiment:started' | 'science:experiment:completed'
  | 'music:royalty:received' | 'music:distribution:updated' | 'music:release:created'
  | 'overlay365:client:added' | 'overlay365:project:updated'
  | 'kernel:started' | 'kernel:stopped' | 'kernel:health'
  | 'module:registered' | 'module:degraded' | 'module:recovered'
  | 'agent:message'
  | 'pipeline:biotech:started' | 'pipeline:biotech:completed' | 'pipeline:biotech:failed'
  | 'pipeline:colabfold:predicted' | 'pipeline:molecular:analyzed'
  | 'pipeline:clinical:simulated' | 'pipeline:pharmacogenomics:queried'
  | 'pipeline:quantum:simulated'
  | 'agent:council:dispatched' | 'agent:council:completed' | 'agent:council:failed'
  | 'agent:specialist:started' | 'agent:specialist:result'
  | 'gateway:cheetah:request' | 'gateway:cheetah:response' | 'gateway:cheetah:error'
  | 'vscode:command:executed' | 'vscode:biotech:result'
  | 'vscode:extension:connected' | 'vscode:extension:disconnected'
  | 'workforce:agent:heartbeat' | 'workforce:task:dispatched' | 'workforce:task:completed'
  | 'research:deep:started' | 'research:deep:completed' | 'research:literature:found'
  | 'science:pipeline:started' | 'science:pipeline:step:completed'
  | 'science:pipeline:completed' | 'science:pipeline:failed'
  | 'security:threat:detected' | 'security:threat:mitigated'
  | 'security:scan:started' | 'security:scan:completed'
  | 'security:module:activated' | 'security:module:degraded'
  | 'security:compliance:updated' | 'security:playbook:triggered'
  | 'security:playbook:completed' | 'security:posture:changed'
  | 'temporal:session:started' | 'temporal:session:ended'
  | 'temporal:insight:tracked' | 'temporal:hypothesis:reactivated'
  | 'temporal:cycle:detected' | 'temporal:evolution:tracked'
  | 'fusion:convergence:detected' | 'fusion:event:created'
  | 'fusion:cascade:triggered' | 'fusion:anticipation:generated'
  | 'swarm:task:dispatched' | 'swarm:finding:reported'
  | 'swarm:quorum:reached' | 'swarm:emergent:detected' | 'swarm:synergy:found'
  | 'autonomy:cycle:started' | 'autonomy:cycle:completed'
  | 'autonomy:plan:generated' | 'autonomy:action:executed'
  | 'autonomy:learning:recorded' | 'autonomy:pattern:emerged'

export interface BusEvent<T = unknown> {
  id: string
  type: BusEventType
  domain: BusDomain
  payload: T
  timestamp: string
  source: string
  correlationId?: string
}

export type BusHandler<T = unknown> = (event: BusEvent<T>) => void

export type BreakthroughPriority = 'routine' | 'noteworthy' | 'significant' | 'breakthrough' | 'paradigm_shift'

export type AgentRole =
  | 'brain' | 'orchestrator' | 'executor' | 'analyst' | 'researcher'
  | 'lab_director' | 'structure_agent' | 'cheminformatics_agent'
  | 'sequence_agent' | 'literature_agent' | 'surgical_agent'
  | 'simulation_agent' | 'visualization_agent' | 'skills_agent' | 'deep_research_agent'

export interface Breakthrough {
  id: string
  title: string
  description: string
  priority: BreakthroughPriority
  domains: string[]
  sourceInsightIds: string[]
  sourceHypothesisIds: string[]
  evidence: string[]
  confidence: number
  novelty: number
  actionsTaken: string[]
  status: 'detected' | 'investigating' | 'confirmed' | 'published' | 'archived'
  createdAt: string
  updatedAt: string
}

export interface AgentMessage {
  id: string
  from: AgentRole
  to: AgentRole
  type: 'directive' | 'report' | 'request' | 'insight' | 'alert' | 'proposal'
  subject: string
  content: string
  data?: Record<string, unknown>
  timestamp: string
  acknowledged: boolean
}

export interface MissionObjective {
  id: string
  title: string
  description: string
  type: 'research' | 'discovery' | 'validation' | 'monitoring' | 'financial' | 'synthesis'
  status: 'queued' | 'active' | 'blocked' | 'completed' | 'failed'
  assignedTo: AgentRole
  steps: MissionStep[]
  breakthroughCandidate: boolean
  parentObjectiveId?: string
  createdAt: string
  completedAt?: string
}

export interface MissionStep {
  id: string
  action: string
  tool?: string
  params?: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  result?: unknown
  duration?: number
}

export interface BrainState {
  breakthroughs: Breakthrough[]
  messages: AgentMessage[]
  objectives: MissionObjective[]
  activeCycles: number
  lastCycleAt: string | null
  insightCount: number
  hypothesisCount: number
  isomorphismCount: number
  breakthroughCount: number
  autonomyLevel: 'supervised' | 'semi-autonomous' | 'autonomous'
  running: boolean
}

export interface InsightObject {
  id: string
  title: string
  content: string
  domains: string[]
  confidence: number
  novelty: number
  tags: string[]
  sourceModule: string
  parentInsights: string[]
  createdAt: string
}

export interface Hypothesis {
  id: string
  title: string
  reasoning: string
  domains: string[]
  estimatedNovelty: number
  estimatedPlausibility: number
  strategy: string
}

export interface IsomorphismMatch {
  sourceDomain: string
  targetDomain: string
  pattern: string
  confidence: number
  mechanism: string
  similarity: number
}

export interface TransferProposal {
  id: string
  sourceDomain: string
  targetDomain: string
  pattern: string
  confidence: number
  estimatedImpact: number
  mechanism: string
  riskFactors: string[]
  recommendedExperiments: string[]
}

export interface ClassifiedInsight {
  insightId: string
  insightClass: string
  classConfidence: number
  classificationSignals: string[]
  domain: string
}

export interface TraversalFinding {
  type: string
  summary: string
  suggestedAction: string
  significance: number
}

export interface ManifoldTopology {
  findings: TraversalFinding[]
}

export interface AdapterConfig {
  baseUrl: string
  timeoutMs: number
  maxRetries: number
  retryDelayMs: number
  apiKey?: string
  enabled: boolean
}

export interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical'
  source: string
  message: string
  context?: Record<string, unknown>
  correlation_id?: string
  causation_id?: string
}

export interface TraceSpan {
  span_id: string
  parent_id?: string
  operation: string
  started_at: string
  completed_at?: string
  duration_ms?: number
  status: 'started' | 'completed' | 'failed'
  error?: string
  metadata: Record<string, unknown>
}

export interface AuditRecord {
  id: string
  timestamp: string
  actor: string
  action: string
  resource_type: string
  resource_id: string
  result: 'success' | 'failure' | 'denied'
  details?: Record<string, unknown>
  ip_address?: string
  user_agent?: string
}

export interface SystemHealth {
  component: string
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  last_check: string
  latency_ms?: number
  error_rate?: number
  details?: string
}

export type ToolParam = { name: string; type: string; required?: boolean; description?: string }

export interface Tool {
  id: string
  name: string
  description: string
  category: string
  parameters: ToolParam[]
  source: string
  handler: (params: Record<string, any>) => Promise<{ success: boolean; output: any; duration: number }>
}

export interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  triggers: string[]
  steps: { toolId: string; params: Record<string, any>; outputVar?: string }[]
}
