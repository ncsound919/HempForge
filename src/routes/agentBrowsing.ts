import { Router, RequestHandler } from "express"
import { agentEventBus } from "../lib/agentBrowsing/eventBus"
import type { EventType } from "../lib/agentBrowsing/eventBus"
import { agentScheduler } from "../lib/agentBrowsing/agentScheduler"
import { listWorkflows, runWorkflow } from "../lib/agentBrowsing/workflowEngine"
import { isCronExpression, sanitizePayload } from "../lib/agentBrowsing/autonomousAgents"

const VALID_EVENT_TYPES = [
  "discovery", "alert", "artifact", "decision", "error", "state_change",
  "agent:started", "agent:completed", "agent:failed", "memory:write",
  "pipeline:started", "pipeline:completed", "pipeline:failed",
  "trigger:content-from-intel", "trigger:business-from-content", "trigger:business-from-insights",
] as const

function isEventType(v: string): v is EventType {
  return (VALID_EVENT_TYPES as readonly string[]).includes(v)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function agentBrowsingRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router()

  router.post("/events", deps.authMiddleware, async (req, res) => {
    const { type, source, payload, durable } = req.body
    if (!type || typeof type !== "string" || !isEventType(type)) {
      return res.status(400).json({ error: "Invalid or missing event type" })
    }
    if (!source || typeof source !== "string") {
      return res.status(400).json({ error: "source is required and must be a string" })
    }
    if (payload !== undefined && (typeof payload !== "object" || payload === null || Array.isArray(payload))) {
      return res.status(400).json({ error: "payload must be a plain object" })
    }
    const sanitizedPayload = payload && typeof payload === "object" && !Array.isArray(payload)
      ? sanitizePayload(payload) as Record<string, unknown>
      : {}
    const event = agentEventBus.emit(type, source, sanitizedPayload, durable === true)
    res.status(201).json({ event })
  })

  router.get("/events", deps.authMiddleware, async (req, res) => {
    const type = req.query.type as string | undefined
    if (type !== undefined && (typeof type !== "string" || !isEventType(type))) {
      return res.status(400).json({ error: "Invalid event type filter" })
    }
    const limit = clamp(parseInt(req.query.limit as string, 10) || 50, 1, 500)
    const events = agentEventBus.getRecent(type as any, limit)
    res.json({ events })
  })

  router.post("/schedule", deps.authMiddleware, async (req, res) => {
    const { id, agentId, cronExpression } = req.body
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "id is required and must be a string" })
    }
    if (!agentId || typeof agentId !== "string") {
      return res.status(400).json({ error: "agentId is required and must be a string" })
    }
    if (!cronExpression || typeof cronExpression !== "string") {
      return res.status(400).json({ error: "cronExpression is required and must be a string" })
    }
    if (!isCronExpression(cronExpression)) {
      return res.status(400).json({ error: "Invalid cron expression" })
    }
    const existing = agentScheduler.getAgent(id)
    if (existing) {
      return res.status(409).json({ error: "Schedule already exists" })
    }
    const skills = Array.isArray(req.body.skills) ? req.body.skills.filter((s: unknown): s is string => typeof s === "string") : []
    agentScheduler.registerAgent({
      id,
      name: typeof req.body.name === "string" ? req.body.name : id,
      description: typeof req.body.description === "string" ? req.body.description : "",
      cronExpression,
      skills,
      status: "idle",
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      enabled: req.body.enabled !== false,
      config: req.body.config && typeof req.body.config === "object" && !Array.isArray(req.body.config) ? req.body.config : {},
    })
    res.status(201).json({ schedule: agentScheduler.getAgent(id) })
  })

  router.get("/schedules", deps.authMiddleware, async (_req, res) => {
    const agents = agentScheduler.getAgents()
    res.json({ schedules: agents })
  })

  router.post("/schedules/:id/trigger", deps.authMiddleware, async (req, res) => {
    const agent = agentScheduler.getAgent(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: "Schedule not found" })
    }
    try {
      const log = await agentScheduler.triggerNow(req.params.id)
      res.json({ log })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Trigger failed"
      res.status(400).json({ error: message })
    }
  })

  router.patch("/schedules/:id", deps.authMiddleware, async (req, res) => {
    const agent = agentScheduler.getAgent(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: "Schedule not found" })
    }
    const updates: { enabled?: boolean; cronExpression?: string; name?: string; description?: string } = {}
    if (typeof req.body.enabled === "boolean") updates.enabled = req.body.enabled
    if (typeof req.body.cronExpression === "string") {
      if (!isCronExpression(req.body.cronExpression)) {
        return res.status(400).json({ error: "Invalid cron expression" })
      }
      updates.cronExpression = req.body.cronExpression
    }
    if (typeof req.body.name === "string") updates.name = req.body.name
    if (typeof req.body.description === "string") updates.description = req.body.description
    await agentScheduler.updateAgent(req.params.id, updates)
    res.json({ schedule: agentScheduler.getAgent(req.params.id) })
  })

  router.delete("/schedules/:id", deps.authMiddleware, async (req, res) => {
    const agent = agentScheduler.getAgent(req.params.id)
    if (!agent) {
      return res.status(404).json({ error: "Schedule not found" })
    }
    agentScheduler.deleteAgent(req.params.id)
    res.json({ deleted: true })
  })

  router.get("/agents", deps.authMiddleware, async (_req, res) => {
    const agents = agentScheduler.getAgents()
    res.json({ agents })
  })

  router.get("/workflows", deps.authMiddleware, async (req, res) => {
    const category = req.query.category as string | undefined
    const workflows = listWorkflows(category)
    res.json({ workflows })
  })

  router.post("/workflows/:id/run", deps.authMiddleware, async (req, res) => {
    try {
      const run = await runWorkflow(req.params.id)
      res.status(201).json({ run })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Workflow execution failed"
      res.status(400).json({ error: message })
    }
  })

  return router
}
