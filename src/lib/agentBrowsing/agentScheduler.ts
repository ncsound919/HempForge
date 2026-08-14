import { EventEmitter } from "events"
import cron from "node-cron"
import {
  estimateNextRun,
  runPresetAgent,
  runPresetAgentAsync,
  type ExecutionLog,
  type ScheduledAgent,
  type SchedulerStats,
} from "./autonomousAgents"
import { agentEventBus } from "./eventBus"
import { writeMemory } from "./agentMemory"
import { securityMiddleware } from "./securityMiddleware"
import { registerBuiltInWorkflows, listWorkflows, runWorkflow } from "./workflowEngine"

interface CronJob {
  stop: () => void
  start: () => void
}

export class AgentScheduler extends EventEmitter {
  private agents: Map<string, ScheduledAgent> = new Map()
  private cronJobs: Map<string, CronJob> = new Map()
  private executionLogs: ExecutionLog[] = []
  private readonly MAX_LOGS = 100
  private initialized = false
  private initializing: Promise<void> | null = null

  private inFlightRuns: Map<string, Promise<ExecutionLog>> = new Map()
  private refreshLock = false
  private refreshQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = []

  constructor() {
    super()
  }

  private async acquireRefreshLock(): Promise<void> {
    if (!this.refreshLock) {
      this.refreshLock = true
      return
    }
    return new Promise<void>((resolve, reject) => {
      this.refreshQueue.push({ resolve, reject })
    })
  }

  private releaseRefreshLock(): void {
    const next = this.refreshQueue.shift()
    if (next) {
      next.resolve()
    } else {
      this.refreshLock = false
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initializing) return this.initializing

    this.initializing = (async () => {
      try {
        registerBuiltInWorkflows()
        this.initialized = true
      } catch (error) {
        this.initializing = null
        this.initialized = false
        throw error
      }
    })()

    return this.initializing
  }

  registerAgent(agent: ScheduledAgent): void {
    this.agents.set(agent.id, agent)
    if (agent.enabled) {
      this.scheduleAgent(agent)
    }
  }

  private scheduleAgent(agent: ScheduledAgent): void {
    const existingJob = this.cronJobs.get(agent.id)
    if (existingJob) {
      existingJob.stop()
      this.cronJobs.delete(agent.id)
    }

    const job = cron.schedule(agent.cronExpression, async () => {
      await this.executeAgent(agent.id)
    })

    this.cronJobs.set(agent.id, job as unknown as CronJob)
    agent.nextRun = estimateNextRun(agent.cronExpression) ?? undefined
  }

  async executeAgent(agentId: string): Promise<ExecutionLog> {
    const inFlight = this.inFlightRuns.get(agentId)
    if (inFlight) return inFlight

    if (!this.initialized) {
      await this.initialize()
    }
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }

    const secResult = await securityMiddleware.validateAction(
      `agent:execute:${agent.id}`,
      { agentId: agent.id, agentName: agent.name, skills: agent.skills } as Record<string, unknown>,
    )
    if (!secResult.approved) {
      throw new Error(`Agent execution blocked by security: ${secResult.blockedReasons.join(", ")}`)
    }

    const runPromise = this.doExecuteAgent(agent)
    this.inFlightRuns.set(agentId, runPromise)

    try {
      return await runPromise
    } finally {
      this.inFlightRuns.delete(agentId)
    }
  }

  private async doExecuteAgent(agent: ScheduledAgent): Promise<ExecutionLog> {
    const startTime = Date.now()
    agent.status = "running"
    agent.lastRun = new Date().toISOString()
    agent.nextRun = undefined
    this.emit("agent:started", { agentId: agent.id, timestamp: agent.lastRun })

    try {
      const output = await this.runAgentSkills(agent)
      const duration = Date.now() - startTime

      agent.status = "completed"
      agent.executionCount++
      agent.successCount++
      agent.nextRun = agent.enabled ? estimateNextRun(agent.cronExpression) ?? undefined : undefined

      const log: ExecutionLog = {
        agentId: agent.id,
        timestamp: new Date().toISOString(),
        status: "success",
        duration,
        output,
      }

      this.addLog(log)

      try {
        await writeMemory({
          namespace: "agent-outputs",
          key: `last-run:${agent.id}`,
          value: { agentId: agent.id, status: "success", output, duration, timestamp: new Date().toISOString() },
          agentId: agent.id,
          ttl: 86400,
        })
      } catch {
      }

      this.emit("agent:completed", log)
      agentEventBus.emit("agent:completed", `scheduler:${agent.id}`, {
        agentId: agent.id, agentName: agent.name, output, duration,
      }, true)

      await this.fireCrossAgentTriggers(agent, output).catch(() => {})

      return log
    } catch (error) {
      const duration = Date.now() - startTime
      agent.status = "failed"
      agent.executionCount++
      agent.failureCount++
      agent.nextRun = agent.enabled ? estimateNextRun(agent.cronExpression) ?? undefined : undefined

      const log: ExecutionLog = {
        agentId: agent.id,
        timestamp: new Date().toISOString(),
        status: "failed",
        duration,
        error: error instanceof Error ? error.message : "Unknown error",
      }

      this.addLog(log)
      this.emit("agent:failed", log)
      throw error
    }
  }

  private async runAgentSkills(agent: ScheduledAgent): Promise<unknown> {
    const asyncOutput = await runPresetAgentAsync(agent)
    if (asyncOutput) {
      return { preset: true, ...asyncOutput, executedSkills: agent.skills }
    }

    const presetOutput = runPresetAgent(agent)
    if (presetOutput) {
      return { preset: true, ...presetOutput, executedSkills: agent.skills }
    }

    const results: Record<string, unknown> = {}
    for (const skill of agent.skills) {
      results[skill] = { status: "queued", skill, note: "Skill execution delegated to external service" }
    }
    return results
  }

  private async fireCrossAgentTriggers(completed: ScheduledAgent, output: unknown): Promise<void> {
    if (completed.id === "market-intelligence" && output) {
      const contentAgent = this.agents.get("content-machine")
      if (contentAgent?.enabled) {
        agentEventBus.emit("trigger:content-from-intel", `scheduler:${completed.id}`, {
          sourceAgent: completed.id, intelligence: output, suggestedAction: "generate-content",
        }, true)
      }
    }
    if (completed.id === "content-machine" && output) {
      const bizAgent = this.agents.get("business-daily")
      if (bizAgent?.enabled) {
        agentEventBus.emit("trigger:business-from-content", `scheduler:${completed.id}`, {
          sourceAgent: completed.id, content: output, suggestedAction: "check-budgets",
        }, true)
      }
    }
    if (completed.id === "self-upgrade-scanner") {
      try {
        await writeMemory({
          namespace: "upgrades",
          key: `latest-scan:${Date.now()}`,
          value: { timestamp: new Date().toISOString(), output },
          agentId: "self-upgrade-scanner",
          ttl: 604800,
        })
      } catch {}
    }
    if (completed.id === "learning-digest" && output) {
      try {
        await writeMemory({
          namespace: "book-knowledge",
          key: `learning-digest:${Date.now()}`,
          value: { timestamp: new Date().toISOString(), output },
          agentId: "learning-digest",
          ttl: 86400,
        })
      } catch {}
    }
    if (completed.id === "business-book-insights" && output) {
      const bizAgent = this.agents.get("business-daily")
      if (bizAgent?.enabled) {
        agentEventBus.emit("trigger:business-from-insights", `scheduler:${completed.id}`, {
          sourceAgent: completed.id, insights: output, suggestedAction: "check-budgets",
        }, true)
      }
    }
    if (completed.id === "finance-book-analysis" && output) {
      try {
        await writeMemory({
          namespace: "financial-insights",
          key: `finance-analysis:${Date.now()}`,
          value: { timestamp: new Date().toISOString(), output },
          agentId: "finance-book-analysis",
          ttl: 43200,
        })
      } catch {}
    }
  }

  private addLog(log: ExecutionLog): void {
    this.executionLogs.unshift(log)
    if (this.executionLogs.length > this.MAX_LOGS) {
      this.executionLogs = this.executionLogs.slice(0, this.MAX_LOGS)
    }
  }

  getAgents(): ScheduledAgent[] {
    return Array.from(this.agents.values())
  }

  getAgent(agentId: string): ScheduledAgent | undefined {
    return this.agents.get(agentId)
  }

  async refreshAgents(): Promise<void> {
    await this.acquireRefreshLock()
    try {
      for (const agent of this.agents.values()) {
        if (agent.enabled && !this.cronJobs.has(agent.id)) {
          this.scheduleAgent(agent)
        } else if (!agent.enabled && this.cronJobs.has(agent.id)) {
          const job = this.cronJobs.get(agent.id)
          if (job) {
            job.stop()
            this.cronJobs.delete(agent.id)
          }
        }
      }
    } finally {
      this.releaseRefreshLock()
    }
  }

  async updateAgent(agentId: string, updates: Partial<ScheduledAgent>): Promise<void> {
    await this.initialize()
    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Agent ${agentId} not found`)

    Object.assign(agent, updates)

    if (updates.cronExpression || updates.enabled !== undefined) {
      if (agent.enabled) {
        this.scheduleAgent(agent)
      } else {
        const job = this.cronJobs.get(agentId)
        if (job) {
          job.stop()
          this.cronJobs.delete(agentId)
        }
      }
    }

    this.agents.set(agentId, agent)
    agent.nextRun = agent.enabled ? estimateNextRun(agent.cronExpression) ?? undefined : undefined
    this.emit("agent:updated", agent)
  }

  deleteAgent(agentId: string): void {
    const job = this.cronJobs.get(agentId)
    if (job) {
      job.stop()
      this.cronJobs.delete(agentId)
    }
    this.agents.delete(agentId)
    this.emit("agent:deleted", agentId)
  }

  getExecutionLogs(agentId?: string): ExecutionLog[] {
    if (agentId) {
      return this.executionLogs.filter(log => log.agentId === agentId)
    }
    return this.executionLogs
  }

  async triggerNow(agentId: string): Promise<ExecutionLog> {
    return this.executeAgent(agentId)
  }

  getStats(): SchedulerStats {
    const agents = this.getAgents()
    return {
      totalAgents: agents.length,
      enabledAgents: agents.filter(a => a.enabled).length,
      totalExecutions: agents.reduce((sum, a) => sum + a.executionCount, 0),
      totalSuccesses: agents.reduce((sum, a) => sum + a.successCount, 0),
      totalFailures: agents.reduce((sum, a) => sum + a.failureCount, 0),
    }
  }

  shutdown(): void {
    this.cronJobs.forEach(job => job.stop())
    this.cronJobs.clear()
  }
}

function cleanupScheduler(): void {
  agentScheduler.shutdown()
}

if (typeof process !== "undefined") {
  process.on("SIGINT", cleanupScheduler)
  process.on("SIGTERM", cleanupScheduler)
  process.on("exit", cleanupScheduler)
}

export const agentScheduler = new AgentScheduler()
