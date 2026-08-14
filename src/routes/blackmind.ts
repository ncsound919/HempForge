import { Router, RequestHandler } from "express"
import { blackMindBrain } from "../engines/blackmind/BlackMindBrain"
import { scienceEngine } from "../engines/blackmind/ScienceEngine"
import { bioPipelineEngine } from "../engines/blackmind/BioPipelineEngine"
import { workflowOrchestrator } from "../engines/blackmind/WorkflowOrchestrator"
import { crossDomainAnalytics } from "../engines/blackmind/CrossDomainAnalytics"
import { knowledgeStore } from "../engines/blackmind/KnowledgeStore"
import { observabilityStack } from "../engines/blackmind/ObservabilityStack"
import { eventBus } from "../engines/blackmind/EventBus"
import { freeAPIsEngine } from "../engines/blackmind/FreeAPIsEngine"
import { externalScienceAdapters } from "../engines/blackmind/ProductionAdapters"
import { scientificOutputValidator } from "../engines/blackmind/ScientificOutputValidator"

export function blackmindRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router()

  // ─── POST /api/blackmind/brain/start ──────────────────────────────────────
  router.post("/brain/start", deps.authMiddleware, async (_req, res) => {
    try {
      blackMindBrain.setEngines(scienceEngine, bioPipelineEngine, workflowOrchestrator)
      await blackMindBrain.start()
      res.json({ message: "BlackMind brain started", cycle: blackMindBrain.getCurrentCycle() })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/brain/stop ────────────────────────────────────────
  router.post("/brain/stop", deps.authMiddleware, async (_req, res) => {
    try {
      blackMindBrain.stop()
      res.json({ message: "BlackMind brain stopped", cyclesCompleted: blackMindBrain.getCurrentCycle() })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/brain/status ───────────────────────────────────────
  router.get("/brain/status", deps.authMiddleware, async (_req, res) => {
    try {
      res.json({ active: blackMindBrain.isActive(), stats: blackMindBrain.getStats(), cycleHistory: blackMindBrain.getCycleHistory() })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/brain/execute ─────────────────────────────────────
  router.post("/brain/execute", deps.authMiddleware, async (req, res) => {
    try {
      const { command, params } = req.body
      const result = await blackMindBrain.executeCommand(command, params)
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/brain/hypothesis ──────────────────────────────────
  router.post("/brain/hypothesis", deps.authMiddleware, async (req, res) => {
    try {
      const { domain, context } = req.body
      if (!domain) return res.status(400).json({ error: "domain is required" })
      const hypothesis = await blackMindBrain.generateHypothesis({ domain, context: context || {} })
      res.json(hypothesis)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/brain/stats ────────────────────────────────────────
  router.get("/brain/stats", deps.authMiddleware, async (_req, res) => {
    try {
      const stats = await blackMindBrain.getSystemStats()
      res.json(stats)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/knowledge/search ──────────────────────────────────
  router.post("/knowledge/search", deps.authMiddleware, async (req, res) => {
    try {
      const { query, limit, domain } = req.body
      const results = domain
        ? crossDomainAnalytics.semanticSearch({ query: query || "", domains: [domain], limit: limit || 20 })
        : crossDomainAnalytics.semanticSearch({ query: query || "", limit: limit || 20 })
      res.json(results)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/knowledge/stats ────────────────────────────────────
  router.get("/knowledge/stats", deps.authMiddleware, async (_req, res) => {
    try {
      res.json(knowledgeStore.getStats())
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/knowledge/lineage ──────────────────────────────────
  router.get("/knowledge/lineage", deps.authMiddleware, async (req, res) => {
    try {
      const entityId = req.query.entityId as string
      if (!entityId) return res.status(400).json({ error: "entityId is required" })
      const lineage = knowledgeStore.getLineageGraph(entityId)
      res.json(lineage)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/analytics/trend ───────────────────────────────────
  router.post("/analytics/trend", deps.authMiddleware, async (req, res) => {
    try {
      const { domain, metric, windowSize } = req.body
      if (!domain) return res.status(400).json({ error: "domain is required" })
      const trend = crossDomainAnalytics.analyzeTrend({ domain, metric, windowSize })
      res.json(trend)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/analytics/anomalies ───────────────────────────────
  router.post("/analytics/anomalies", deps.authMiddleware, async (req, res) => {
    try {
      const { domain, threshold } = req.body
      const anomalies = crossDomainAnalytics.detectAnomalies({ domain, threshold })
      res.json(anomalies)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/analytics/correlation ─────────────────────────────
  router.post("/analytics/correlation", deps.authMiddleware, async (req, res) => {
    try {
      const { domainA, domainB, metric } = req.body
      if (!domainA || !domainB) return res.status(400).json({ error: "domainA and domainB are required" })
      const correlation = crossDomainAnalytics.computeCrossDomainCorrelation({ domainA, domainB, metric })
      res.json(correlation)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/analytics/correlation-matrix ──────────────────────
  router.post("/analytics/correlation-matrix", deps.authMiddleware, async (req, res) => {
    try {
      const { domains } = req.body
      if (!domains || !Array.isArray(domains)) return res.status(400).json({ error: "domains array is required" })
      const matrix = crossDomainAnalytics.computeCorrelationMatrix({ domains })
      res.json(matrix)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/analytics/reproducibility ─────────────────────────
  router.post("/analytics/reproducibility", deps.authMiddleware, async (req, res) => {
    try {
      const { entityId } = req.body
      if (!entityId) return res.status(400).json({ error: "entityId is required" })
      const score = crossDomainAnalytics.computeReproducibilityScore(entityId)
      res.json(score)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/analytics/drift ───────────────────────────────────
  router.post("/analytics/drift", deps.authMiddleware, async (req, res) => {
    try {
      const { domain, windowSize, threshold } = req.body
      if (!domain) return res.status(400).json({ error: "domain is required" })
      const drift = crossDomainAnalytics.detectDrift({ domain, windowSize, threshold })
      res.json(drift)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/pipeline/run ──────────────────────────────────────
  router.post("/pipeline/run", deps.authMiddleware, async (req, res) => {
    try {
      const { pipelineType, input } = req.body
      if (!pipelineType) return res.status(400).json({ error: "pipelineType is required" })
      const result = await blackMindBrain.runPipeline({ pipelineType, input })
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/pipeline/status ────────────────────────────────────
  router.get("/pipeline/status", deps.authMiddleware, async (req, res) => {
    try {
      const pipelineId = req.query.pipelineId as string
      if (!pipelineId) return res.status(400).json({ error: "pipelineId is required" })
      const status = await bioPipelineEngine.getPipelineStatus(pipelineId)
      res.json(status)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/workflow/create ───────────────────────────────────
  router.post("/workflow/create", deps.authMiddleware, async (req, res) => {
    try {
      const { workflowName, description, tasks } = req.body
      if (!workflowName || !tasks) return res.status(400).json({ error: "workflowName and tasks are required" })
      const result = await blackMindBrain.runWorkflow({ workflowName, description, tasks })
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/workflow/list ──────────────────────────────────────
  router.get("/workflow/list", deps.authMiddleware, async (_req, res) => {
    try {
      res.json(workflowOrchestrator.getWorkflows())
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/workflow/:id ───────────────────────────────────────
  router.get("/workflow/:id", deps.authMiddleware, async (req, res) => {
    try {
      const workflow = workflowOrchestrator.getWorkflow(req.params.id)
      if (!workflow) return res.status(404).json({ error: "Workflow not found" })
      res.json({ id: workflow.id, name: workflow.name, status: workflow.status, tasks: workflow.tasks.map(t => ({ id: t.id, name: t.name, status: workflow.results.has(t.id) ? 'completed' : workflow.errors.has(t.id) ? 'failed' : 'pending' })), results: Array.from(workflow.results.entries()), errors: Array.from(workflow.errors.entries()) })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/search/scientific ─────────────────────────────────
  router.post("/search/scientific", deps.authMiddleware, async (req, res) => {
    try {
      const { query, databases, limit } = req.body
      if (!query) return res.status(400).json({ error: "query is required" })
      const results = await blackMindBrain.searchScientificLiterature({ query, databases, limit })
      res.json(results)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/search/free-apis ──────────────────────────────────
  router.post("/search/free-apis", deps.authMiddleware, async (req, res) => {
    try {
      const { query, maxResults } = req.body
      if (!query) return res.status(400).json({ error: "query is required" })
      const results = await freeAPIsEngine.deepSearch(query)
      res.json(results)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/science/extract-entities ──────────────────────────
  router.post("/science/extract-entities", deps.authMiddleware, async (req, res) => {
    try {
      const { text } = req.body
      if (!text) return res.status(400).json({ error: "text is required" })
      const entities = await blackMindBrain.extractEntitiesFromText(text)
      res.json(entities)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/science/cross-domain-search ───────────────────────
  router.post("/science/cross-domain-search", deps.authMiddleware, async (req, res) => {
    try {
      const { query, domains, includePapers, includePatents } = req.body
      if (!query || !domains) return res.status(400).json({ error: "query and domains are required" })
      const results = await scienceEngine.crossDomainSearch({ query, domains, includePapers, includePatents })
      res.json(results)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/science/run-cycle ─────────────────────────────────
  router.post("/science/run-cycle", deps.authMiddleware, async (req, res) => {
    try {
      const { domain, context } = req.body
      if (!domain) return res.status(400).json({ error: "domain is required" })
      const cycle = await scienceEngine.runScientificCycle(domain, context || {})
      res.json(cycle)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── POST /api/blackmind/validate ──────────────────────────────────────────
  router.post("/validate", deps.authMiddleware, async (req, res) => {
    try {
      const { data, type } = req.body
      if (!data || !type) return res.status(400).json({ error: "data and type are required" })
      const validTypes = ['data', 'trend', 'insight', 'cross-domain', 'drift', 'science-paper']
      if (!validTypes.includes(type)) return res.status(400).json({ error: `Invalid validator type: ${type}` })
      const result = await scientificOutputValidator.validate(data, type)
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/observability/metrics ──────────────────────────────
  router.get("/observability/metrics", deps.authMiddleware, async (req, res) => {
    try {
      const { name, aggregate, from, to } = req.query
      const result = observabilityStack.queryMetrics({ name: name as string, aggregate: aggregate as any, from: from as string, to: to as string })
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/observability/traces ───────────────────────────────
  router.get("/observability/traces", deps.authMiddleware, async (_req, res) => {
    try {
      res.json(observabilityStack.getRecentTraces())
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/observability/trace/:id ────────────────────────────
  router.get("/observability/trace/:id", deps.authMiddleware, async (req, res) => {
    try {
      const trace = observabilityStack.getTraceSummary(req.params.id)
      if (!trace) return res.status(404).json({ error: "Trace not found" })
      res.json(trace)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/observability/stats ────────────────────────────────
  router.get("/observability/stats", deps.authMiddleware, async (_req, res) => {
    try {
      res.json(observabilityStack.getStats())
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ─── GET /api/blackmind/events ─────────────────────────────────────────────
  router.get("/events", deps.authMiddleware, async (req, res) => {
    try {
      const { type, domain, limit } = req.query
      const events = eventBus.query({ event_type: type ? [type as any] : undefined, domain: domain ? [domain as string] : undefined, limit: Number(limit) || 50 })
      res.json(events)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
