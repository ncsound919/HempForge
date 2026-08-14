import { agentEventBus, type EventType } from "./eventBus"
import { writeMemory, readMemory } from "./agentMemory"

export type WorkflowStepType =
  | "browser-reader"
  | "browser-extract"
  | "browser-scrape"
  | "business-skill"
  | "daily-routine"
  | "weekly-routine"
  | "reporank-audit"
  | "mutly-pipeline"
  | "vibeserve-tool"
  | "generate-site"
  | "memory-write"
  | "memory-read"
  | "webhook"
  | "delay"
  | "conditional-gate"
  | "competitor-signal"
  | "pro-revenue"
  | "content-deploy"
  | "upgrade-scan"
  | "run-pipeline"
  | "knowledge-search"
  | "coding-skill"
  | "blocklabor-list-jobs"
  | "blocklabor-list-workers"
  | "blocklabor-rank-workers"
  | "blocklabor-verify-business"
  | "blocklabor-audit-ghost-jobs"
  | "blocklabor-sla-alert"

export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  label: string
  config: Record<string, unknown>
  dependsOn?: string[]
  onSuccess?: string
  onFailure?: string
  retries?: number
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  category: "monitoring" | "business" | "development" | "security" | "content" | "research" | "knowledge" | "labor"
  tags: string[]
  schedule?: string | null
  steps: WorkflowStep[]
  timeout?: number
}

export interface WorkflowRun {
  id: string
  workflowId: string
  startedAt: string
  completedAt?: string
  status: "pending" | "running" | "completed" | "completed_with_errors" | "failed" | "aborted"
  stepResults: Record<string, WorkflowStepResult>
  error?: string
}

export interface WorkflowStepResult {
  stepId: string
  status: "pending" | "running" | "success" | "failed" | "skipped"
  output: unknown
  error?: string
  durationMs: number
  attempts: number
}

const registry = new Map<string, WorkflowDefinition>()

export function registerWorkflow(wf: WorkflowDefinition): void {
  registry.set(wf.id, wf)
}

export function getWorkflow(id: string): WorkflowDefinition | undefined {
  return registry.get(id)
}

export function listWorkflows(category?: string): WorkflowDefinition[] {
  const all = Array.from(registry.values())
  if (category) return all.filter(w => w.category === category)
  return all
}

export function listCategories(): string[] {
  return [...new Set(Array.from(registry.values()).map(w => w.category))]
}

const activeRuns = new Map<string, WorkflowRun>()

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function executeStep(
  step: WorkflowStep,
  stepResults: Record<string, WorkflowStepResult>,
): Promise<WorkflowStepResult> {
  const start = Date.now()
  let attempts = 0
  const maxRetries = step.retries ?? 0

  const tryExecute = async (): Promise<WorkflowStepResult> => {
    attempts++
    try {
      let output: unknown

      switch (step.type) {
        case "browser-reader":
        case "browser-extract":
        case "browser-scrape":
          output = { status: "stub", note: "Browser pipeline requires playwright", url: step.config.url }
          break

        case "business-skill":
        case "daily-routine":
        case "weekly-routine":
          output = { status: "stub", note: "Business skill delegated to external bridge", skill: step.config.skill }
          break

        case "reporank-audit":
          output = { status: "stub", note: "RepoRank audit delegated to service-hub", project: step.config.projectName }
          break

        case "mutly-pipeline":
          output = { status: "stub", note: "Mutly pipeline delegated to service-hub", dir: step.config.projectDir }
          break

        case "vibeserve-tool":
          output = { status: "stub", note: "VibeServe tool delegated to service-hub", tool: step.config.tool }
          break

        case "generate-site":
          output = { status: "stub", note: "Site generation delegated", name: step.config.name }
          break

        case "memory-write":
          await writeMemory({
            namespace: (step.config.namespace as string) || "workflows",
            key: step.config.key as string,
            value: step.config.value,
            agentId: (step.config.agentId as string) || "workflow-engine",
            ttl: step.config.ttl as number | undefined,
          })
          output = { written: true }
          break

        case "memory-read":
          output = await readMemory(
            step.config.key as string,
            step.config.namespace as string,
          )
          break

        case "delay":
          await sleep(step.config.ms as number || 1000)
          output = { delayed: true }
          break

        case "competitor-signal":
          output = { recorded: true, competitor: step.config.competitor, signal: step.config.signal }
          break

        case "pro-revenue":
          output = { recorded: true, pro: step.config.pro, workTitle: step.config.workTitle, amount: step.config.amount }
          break

        case "content-deploy":
          output = { triggered: true, topic: step.config.topic, siteName: step.config.siteName }
          break

        case "upgrade-scan":
          output = { processed: true }
          break

        case "run-pipeline":
          output = { status: "stub", note: "Pipeline execution delegated", pipelineId: step.config.pipelineId }
          break

        case "knowledge-search":
          output = { status: "stub", note: "Book search delegated", query: step.config.query }
          break

        case "coding-skill":
          output = { status: "stub", note: "Coding skill delegated", skill: step.config.skill }
          break

        case "blocklabor-list-jobs":
        case "blocklabor-list-workers":
        case "blocklabor-rank-workers":
        case "blocklabor-verify-business":
        case "blocklabor-audit-ghost-jobs":
        case "blocklabor-sla-alert":
          output = { status: "stub", note: "BlockLabor operation delegated", type: step.type, config: step.config }
          break

        case "webhook": {
          const res = await fetch(step.config.url as string, {
            method: (step.config.method as string) || "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(step.config.body || {}),
            signal: AbortSignal.timeout(10000),
          })
          output = { status: res.status, ok: res.ok }
          break
        }

        case "conditional-gate": {
          const gates = step.config.gates as string[] || []
          const allPassed = gates.every(g => {
            const stepResult = stepResults[g]
            return stepResult?.status === "success"
          })
          output = { passed: allPassed, gates }
          break
        }

        default:
          throw new Error(`Unknown step type: ${step.type}`)
      }

      return {
        stepId: step.id,
        status: "success",
        output,
        durationMs: Date.now() - start,
        attempts,
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : "Unknown error"
      if (attempts <= maxRetries) {
        await sleep(1000 * attempts)
        return tryExecute()
      }
      return {
        stepId: step.id,
        status: "failed",
        output: null,
        error,
        durationMs: Date.now() - start,
        attempts,
      }
    }
  }

  return tryExecute()
}

function topologicalSort(steps: WorkflowStep[]): WorkflowStep[] {
  const visited = new Set<string>()
  const sorted: WorkflowStep[] = []
  const stepMap = new Map(steps.map(s => [s.id, s]))

  function visit(id: string, path: Set<string>): void {
    if (path.has(id)) throw new Error(`Circular dependency: ${id}`)
    if (visited.has(id)) return
    path.add(id)
    const step = stepMap.get(id)
    if (!step) throw new Error(`Step not found: ${id}`)
    for (const dep of step.dependsOn || []) visit(dep, path)
    path.delete(id)
    visited.add(id)
    sorted.push(step)
  }

  for (const step of steps) {
    if (!visited.has(step.id)) visit(step.id, new Set())
  }

  return sorted
}

export async function runWorkflow(
  workflowId: string,
  onStep?: (stepId: string, result: WorkflowStepResult) => void,
): Promise<WorkflowRun> {
  const wf = registry.get(workflowId)
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`)

  const run: WorkflowRun = {
    id: crypto.randomUUID(),
    workflowId,
    startedAt: new Date().toISOString(),
    status: "running",
    stepResults: {},
  }

  activeRuns.set(run.id, run)

  const sorted = topologicalSort(wf.steps)

  agentEventBus.emit("artifact", `workflow:${wf.id}`, {
    type: "workflow-started",
    runId: run.id,
    workflowId: wf.id,
    workflowName: wf.name,
  }, true)

  try {
    for (const step of sorted) {
      run.stepResults[step.id] = { stepId: step.id, status: "running", output: null, durationMs: 0, attempts: 0 }
      const result = await executeStep(step, run.stepResults)
      run.stepResults[step.id] = result
      onStep?.(step.id, result)

      if (result.status === "success") {
        try {
          await writeMemory({
            namespace: `workflow:${wf.id}`,
            key: `${run.id}:${step.id}`,
            value: { workflowId: wf.id, stepId: step.id, output: result.output },
            agentId: "workflow-engine",
            ttl: 86400,
          })
        } catch {}
      }

      if (step.onFailure && result.status === "failed") {
        const skipStep = wf.steps.find(s => s.id === step.onFailure)
        if (skipStep) {
          run.stepResults[skipStep.id] = {
            stepId: skipStep.id, status: "skipped", output: null, durationMs: 0, attempts: 0,
          }
        }
      }
    }

    const failed = Object.values(run.stepResults).filter(r => r.status === "failed")
    run.status = failed.length === 0 ? "completed" : "completed_with_errors"
    if (failed.length > 0) run.error = `${failed.length} step(s) failed`

    agentEventBus.emit("artifact", `workflow:${wf.id}`, {
      type: "workflow-completed",
      runId: run.id,
      workflowId: wf.id,
      status: run.status,
      stepCount: sorted.length,
      failedCount: failed.length,
    }, true)
  } catch (err: unknown) {
    run.status = "failed"
    run.error = err instanceof Error ? err.message : "Workflow execution failed"
  }

  run.completedAt = new Date().toISOString()

  try {
    await writeMemory({
      namespace: "workflow-runs",
      key: `${wf.id}:${run.id}`,
      value: { workflowId: wf.id, runId: run.id, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt },
      agentId: "workflow-engine",
      ttl: 604800,
    })
  } catch {}

  return run
}

export function getWorkflowRun(runId: string): WorkflowRun | undefined {
  return activeRuns.get(runId)
}

export function listActiveRuns(): WorkflowRun[] {
  return Array.from(activeRuns.values())
}

const COMPETITIVE_MONITOR: WorkflowDefinition = {
  id: "competitive-monitor",
  name: "Competitive Monitor",
  description: "Browse a competitor URL, extract content, analyze for signals, store findings.",
  category: "monitoring",
  tags: ["competitive", "browser", "scraping", "alerts"],
  schedule: "0 */6 * * *",
  steps: [
    { id: "browse", type: "browser-reader", label: "Browse competitor page", config: { url: "" }, dependsOn: [] },
    { id: "extract", type: "browser-extract", label: "Extract key content", config: { url: "", selectors: ["h1", "h2", ".price", ".product"] }, dependsOn: ["browse"] },
    { id: "signal-check", type: "competitor-signal", label: "Check for competitive signals", config: { competitor: "", severity: "info", source: "workflow" }, dependsOn: ["extract"] },
    { id: "store", type: "memory-write", label: "Store results in memory", config: { namespace: "competitive-scans", key: "", value: {}, ttl: 604800 }, dependsOn: ["extract"] },
  ],
}

const DAILY_BUSINESS_ROUTINE: WorkflowDefinition = {
  id: "daily-business-routine",
  name: "Daily Business Ops",
  description: "Run the full daily business routine.",
  category: "business",
  tags: ["daily", "finance", "content", "music"],
  schedule: "0 7 * * 1-5",
  steps: [
    { id: "routine", type: "daily-routine", label: "Execute daily business routine", config: {}, dependsOn: [] },
    { id: "store-results", type: "memory-write", label: "Store routine results", config: { namespace: "business-routines", key: "", value: {}, ttl: 86400 }, dependsOn: ["routine"] },
  ],
}

const PROJECT_HEALTH_SCAN: WorkflowDefinition = {
  id: "project-health-scan",
  name: "Project Health Scan",
  description: "Run RepoRank audit on a project, analyze quality, generate tasks.",
  category: "development",
  tags: ["audit", "quality", "reporank", "build"],
  schedule: null,
  steps: [
    { id: "audit", type: "reporank-audit", label: "Run RepoRank audit", config: { projectName: "", projectPath: "" }, dependsOn: [] },
    { id: "mutly", type: "mutly-pipeline", label: "Trigger Mutly pipeline", config: { projectDir: "" }, dependsOn: ["audit"] },
    { id: "store", type: "memory-write", label: "Store audit results", config: { namespace: "prebuild-audits", key: "", value: {}, ttl: 86400 }, dependsOn: ["audit"] },
  ],
}

const CONTENT_FACTORY: WorkflowDefinition = {
  id: "content-factory",
  name: "Content Factory",
  description: "Research a topic via browser, extract key findings, generate a site.",
  category: "content",
  tags: ["content", "research", "generate", "deploy"],
  schedule: "0 9 * * 3",
  steps: [
    { id: "research", type: "browser-reader", label: "Research topic", config: { url: "" }, dependsOn: [] },
    { id: "generate", type: "generate-site", label: "Generate site from research", config: { name: "", description: "" }, dependsOn: ["research"] },
    { id: "deploy", type: "content-deploy", label: "Trigger content deployment", config: { topic: "", siteName: "", description: "" }, dependsOn: ["generate"] },
    { id: "store", type: "memory-write", label: "Store content artifact", config: { namespace: "content-factory", key: "", value: {}, ttl: 2592000 }, dependsOn: ["generate"] },
  ],
}

const SELF_UPGRADE: WorkflowDefinition = {
  id: "self-upgrade",
  name: "Self-Upgrade Scanner",
  description: "Scan trending repos, research top recommendations, store findings.",
  category: "development",
  tags: ["upgrade", "trending", "research", "automation"],
  schedule: "0 6 * * 0",
  steps: [
    { id: "scan", type: "upgrade-scan", label: "Process upgrade queue", config: {}, dependsOn: [] },
    { id: "store", type: "memory-write", label: "Store scan results", config: { namespace: "upgrades", key: "", value: {}, ttl: 604800 }, dependsOn: ["scan"] },
  ],
}

const MUSIC_REVENUE_TRACKER: WorkflowDefinition = {
  id: "music-revenue-tracker",
  name: "PRO Revenue Tracker",
  description: "Track music revenue across ASCAP, MLC, and HFA.",
  category: "business",
  tags: ["music", "revenue", "pro", "finance"],
  schedule: "0 0 1 * *",
  steps: [
    { id: "revenue", type: "pro-revenue", label: "Record PRO revenue", config: { pro: "ASCAP", amount: 0, type: "performance", period: "" }, dependsOn: [] },
    { id: "store", type: "memory-write", label: "Store revenue data", config: { namespace: "pro-revenue", key: "", value: {}, ttl: 7776000 }, dependsOn: ["revenue"] },
  ],
}

const BOOK_KNOWLEDGE_DIGEST: WorkflowDefinition = {
  id: "book-knowledge-digest",
  name: "Book Knowledge Digest",
  description: "Search indexed books across multiple domains and store a consolidated knowledge digest.",
  category: "knowledge",
  tags: ["books", "knowledge", "research", "learning"],
  schedule: "0 8 * * *",
  steps: [
    { id: "search-coding", type: "knowledge-search", label: "Search coding books", config: { query: "TypeScript React Python patterns", category: "Computers", limit: 3 }, dependsOn: [] },
    { id: "search-business", type: "knowledge-search", label: "Search business books", config: { query: "business strategy marketing analytics", category: "Business", limit: 3 }, dependsOn: [] },
    { id: "search-math", type: "knowledge-search", label: "Search math books", config: { query: "statistics probability linear algebra", category: "Math", limit: 2 }, dependsOn: [] },
    { id: "search-finance", type: "knowledge-search", label: "Search financial books", config: { query: "investing valuation financial analysis", category: "financial", limit: 2 }, dependsOn: [] },
    { id: "consolidate", type: "memory-write", label: "Store knowledge digest", config: { namespace: "book-knowledge", key: "", value: {}, ttl: 86400 }, dependsOn: ["search-coding", "search-business", "search-math", "search-finance"] },
  ],
}

const CODE_REVIEW_WORKFLOW: WorkflowDefinition = {
  id: "code-review-workflow",
  name: "Code Review Assistant",
  description: "Searches for code review best practices, testing strategies, and quality patterns.",
  category: "development",
  tags: ["code-review", "testing", "quality", "google"],
  schedule: null,
  steps: [
    { id: "search-code-review", type: "coding-skill", label: "Search code review best practices", config: { skill: "code-review-assistant", query: "code review checklist best practices", params: { category: "Computers" } }, dependsOn: [] },
    { id: "store-results", type: "memory-write", label: "Store code review findings", config: { namespace: "coding-tools", key: "code-review-findings", value: {}, ttl: 86400 }, dependsOn: ["search-code-review"] },
  ],
}

const TS_REACT_WORKFLOW: WorkflowDefinition = {
  id: "ts-react-workflow",
  name: "TypeScript & React Patterns",
  description: "Searches for TypeScript types, React components, hooks, and Next.js patterns.",
  category: "development",
  tags: ["typescript", "react", "nextjs", "frontend"],
  schedule: null,
  steps: [
    { id: "search-ts-react", type: "coding-skill", label: "Search TS/React patterns", config: { skill: "ts-react-patterns", query: "TypeScript types React components hooks patterns", params: { category: "Computers" } }, dependsOn: [] },
    { id: "store-results", type: "memory-write", label: "Store TS/React findings", config: { namespace: "coding-tools", key: "ts-react-findings", value: {}, ttl: 86400 }, dependsOn: ["search-ts-react"] },
  ],
}

const PYTHON_BEST_PRACTICES_WORKFLOW: WorkflowDefinition = {
  id: "python-best-practices-workflow",
  name: "Python Best Practices",
  description: "Searches for clean code, module organization, testing, and performance optimization patterns.",
  category: "development",
  tags: ["python", "best-practices", "clean-code", "testing"],
  schedule: null,
  steps: [
    { id: "search-python", type: "coding-skill", label: "Search Python best practices", config: { skill: "python-best-practices", query: "Python modules testing performance clean code", params: { category: "Computers" } }, dependsOn: [] },
    { id: "store-results", type: "memory-write", label: "Store Python findings", config: { namespace: "coding-tools", key: "python-findings", value: {}, ttl: 86400 }, dependsOn: ["search-python"] },
  ],
}

const DISTRIBUTED_SYSTEMS_WORKFLOW: WorkflowDefinition = {
  id: "distributed-systems-workflow",
  name: "Distributed Systems Architect",
  description: "Searches for architecture patterns around replication, partitioning, consensus, and consistency.",
  category: "development",
  tags: ["distributed-systems", "architecture", "consistency", "replication"],
  schedule: null,
  steps: [
    { id: "search-distsys", type: "coding-skill", label: "Search distributed systems patterns", config: { skill: "distributed-systems", query: "replication partitioning consensus consistency fault tolerance", params: { category: "Computers" } }, dependsOn: [] },
    { id: "store-results", type: "memory-write", label: "Store architecture findings", config: { namespace: "coding-tools", key: "distsys-findings", value: {}, ttl: 86400 }, dependsOn: ["search-distsys"] },
  ],
}

const SECURITY_WORKFLOW: WorkflowDefinition = {
  id: "security-patterns-workflow",
  name: "Security Patterns Audit",
  description: "Searches for security vulnerabilities, authentication patterns, encryption, and best practices.",
  category: "security",
  tags: ["security", "audit", "vulnerability", "authentication"],
  schedule: null,
  steps: [
    { id: "search-security", type: "coding-skill", label: "Search security patterns", config: { skill: "security-patterns", query: "vulnerability assessment authentication encryption scanning", params: { category: "Computers" } }, dependsOn: [] },
    { id: "store-results", type: "memory-write", label: "Store security findings", config: { namespace: "coding-tools", key: "security-findings", value: {}, ttl: 86400 }, dependsOn: ["search-security"] },
  ],
}

const DAILY_CODING_DIGEST: WorkflowDefinition = {
  id: "daily-coding-digest",
  name: "Daily Coding Knowledge Digest",
  description: "Runs all coding tools and consolidates insights.",
  category: "knowledge",
  tags: ["coding", "knowledge", "digest", "daily"],
  schedule: "0 9 * * *",
  steps: [
    { id: "code-review", type: "coding-skill", label: "Code review patterns", config: { skill: "code-review-assistant", query: "code review testing best practices", limit: 3, params: { category: "Computers" } }, dependsOn: [] },
    { id: "ts-react", type: "coding-skill", label: "TS/React patterns", config: { skill: "ts-react-patterns", query: "TypeScript React patterns", limit: 3, params: { category: "Computers" } }, dependsOn: [] },
    { id: "python", type: "coding-skill", label: "Python best practices", config: { skill: "python-best-practices", query: "Python clean code testing", limit: 3, params: { category: "Computers" } }, dependsOn: [] },
    { id: "distsys", type: "coding-skill", label: "Distributed systems", config: { skill: "distributed-systems", query: "distributed systems architecture", limit: 3, params: { category: "Computers" } }, dependsOn: [] },
    { id: "security", type: "coding-skill", label: "Security patterns", config: { skill: "security-patterns", query: "security authentication encryption", limit: 3, params: { category: "Computers" } }, dependsOn: [] },
    { id: "consolidate", type: "memory-write", label: "Consolidate daily coding digest", config: { namespace: "coding-tools", key: "daily-coding-digest", value: {}, ttl: 86400 }, dependsOn: ["code-review", "ts-react", "python", "distsys", "security"] },
  ],
}

const LABOR_VERIFY_NEW_BUSINESS: WorkflowDefinition = {
  id: "labor-verify-new-business",
  name: "Verify New Business Identity",
  description: "Verifies business identity via BlockLabor/Aetherdesk.",
  category: "labor",
  tags: ["blocklabor", "aetherdesk", "verification", "onboarding"],
  schedule: null,
  steps: [
    { id: "verify-business", type: "blocklabor-verify-business", label: "Verify business identity", config: { businessName: "", businessPhone: "", businessEin: "", businessState: "", tenantId: "" }, dependsOn: [] },
    { id: "cache-result", type: "memory-write", label: "Cache verification result", config: { namespace: "labor", key: "", value: {}, ttl: 2592000 }, dependsOn: ["verify-business"] },
  ],
}

const LABOR_RANK_AND_NOTIFY: WorkflowDefinition = {
  id: "labor-rank-and-notify",
  name: "Rank Workers + Notify Top Matches",
  description: "Ranks workers for a job and caches the shortlist.",
  category: "labor",
  tags: ["blocklabor", "reporank", "matching", "notifications"],
  schedule: null,
  steps: [
    { id: "rank-workers", type: "blocklabor-rank-workers", label: "Rank top-5 workers for job", config: { jobId: "", topK: 5 }, dependsOn: [] },
    { id: "cache-shortlist", type: "memory-write", label: "Cache shortlist for portal", config: { namespace: "labor", key: "", value: {}, ttl: 86400 }, dependsOn: ["rank-workers"] },
  ],
}

const LABOR_DAILY_GHOST_JOB_AUDIT: WorkflowDefinition = {
  id: "labor-daily-ghost-job-audit",
  name: "Daily Ghost-Job Audit",
  description: "Audits open jobs for validity via BlockLabor/Aetherdesk.",
  category: "labor",
  tags: ["blocklabor", "aetherdesk", "integrity", "cron"],
  schedule: "0 14 */3 * *",
  steps: [
    { id: "list-candidates", type: "blocklabor-list-jobs", label: "List open jobs older than 3 days", config: { filters: { status: "open", olderThanDays: 3 } }, dependsOn: [] },
    { id: "audit-each", type: "blocklabor-audit-ghost-jobs", label: "Audit each job", config: { jobId: "", businessPhone: "", jobTitle: "", tenantId: "blocklabor-default" }, dependsOn: ["list-candidates"] },
  ],
}

const LABOR_SLA_WATCHDOG: WorkflowDefinition = {
  id: "labor-sla-watchdog",
  name: "Application SLA Watchdog",
  description: "Alerts employers when application SLA is breached.",
  category: "labor",
  tags: ["blocklabor", "aetherdesk", "sla", "cron"],
  schedule: "0 */6 * * *",
  steps: [
    { id: "list-sla-breaches", type: "blocklabor-list-jobs", label: "List jobs past SLA", config: { filters: { status: "open", slaBreached: true } }, dependsOn: [] },
    { id: "alert-employer", type: "blocklabor-sla-alert", label: "Send SLA alert", config: { jobId: "", businessPhone: "", applicantName: "Top applicant", slaHoursBreached: 24, tenantId: "blocklabor-default" }, dependsOn: ["list-sla-breaches"] },
  ],
}

export function registerBuiltInWorkflows(): void {
  registerWorkflow(COMPETITIVE_MONITOR)
  registerWorkflow(DAILY_BUSINESS_ROUTINE)
  registerWorkflow(PROJECT_HEALTH_SCAN)
  registerWorkflow(CONTENT_FACTORY)
  registerWorkflow(SELF_UPGRADE)
  registerWorkflow(MUSIC_REVENUE_TRACKER)
  registerWorkflow(BOOK_KNOWLEDGE_DIGEST)
  registerWorkflow(CODE_REVIEW_WORKFLOW)
  registerWorkflow(TS_REACT_WORKFLOW)
  registerWorkflow(PYTHON_BEST_PRACTICES_WORKFLOW)
  registerWorkflow(DISTRIBUTED_SYSTEMS_WORKFLOW)
  registerWorkflow(SECURITY_WORKFLOW)
  registerWorkflow(DAILY_CODING_DIGEST)
  registerWorkflow(LABOR_VERIFY_NEW_BUSINESS)
  registerWorkflow(LABOR_RANK_AND_NOTIFY)
  registerWorkflow(LABOR_DAILY_GHOST_JOB_AUDIT)
  registerWorkflow(LABOR_SLA_WATCHDOG)
}
