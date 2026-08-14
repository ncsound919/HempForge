export type AgentStatus = "idle" | "running" | "completed" | "failed" | "paused"
export type AutonomyPolicy = "conservative" | "balanced" | "aggressive"

export interface AutonomousModeSettings {
  enabled: boolean
  policyLevel: AutonomyPolicy
  autoConfigure: boolean
  autoUpgradeSafe: boolean
  resumeOnRestart: boolean
  lastConfiguredAt?: string
}

export interface ScheduledAgent {
  id: string
  name: string
  description: string
  cronExpression: string
  skills: string[]
  status: AgentStatus
  lastRun?: string
  nextRun?: string
  executionCount: number
  successCount: number
  failureCount: number
  enabled: boolean
  config: Record<string, unknown>
}

export interface ExecutionLog {
  agentId: string
  timestamp: string
  status: "success" | "failed"
  duration: number
  output?: unknown
  error?: string
}

export interface SchedulerStats {
  totalAgents: number
  enabledAgents: number
  totalExecutions: number
  totalSuccesses: number
  totalFailures: number
}

export const DEFAULT_AUTONOMOUS_SETTINGS: AutonomousModeSettings = {
  enabled: false,
  policyLevel: "conservative",
  autoConfigure: true,
  autoUpgradeSafe: true,
  resumeOnRestart: true,
}

function createAgent(partial: Pick<ScheduledAgent, "id" | "name" | "description" | "cronExpression" | "skills" | "config"> & Partial<Pick<ScheduledAgent, "enabled">>): ScheduledAgent {
  return {
    ...partial,
    status: "idle",
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    enabled: partial.enabled ?? true,
  }
}

export const AUTONOMOUS_AGENT_PRESETS: ScheduledAgent[] = [
  createAgent({
    id: "auto-target-tracker",
    name: "Auto Target Tracker",
    description: "Tracks screenshot-based goal progress using image understanding prompts and scheduled check-in windows.",
    cronExpression: "0 8,12,20 * * *",
    skills: ["auto-target-tracker", "VLM", "image-understand"],
    config: {
      goalTypes: ["learning", "fitness", "work", "habits"],
      reminderWindows: ["08:00", "12:00", "20:00"],
      captureKeywords: ["progress", "goal", "task", "workout", "note"],
    },
  }),
  createAgent({
    id: "content-machine",
    name: "Content Machine",
    description: "Builds a daily content package with topic angle, SEO brief, draft structure, and hero image prompt.",
    cronExpression: "0 9 * * *",
    skills: ["content-strategy", "seo-content-writer", "image-generation"],
    config: {
      contentPillars: ["ai browser workflows", "automation ops", "agent strategy"],
      outputTypes: ["seo-brief", "article-outline", "hero-image-prompt"],
      targetWordCount: 1800,
    },
  }),
  createAgent({
    id: "market-intelligence",
    name: "Market Intelligence",
    description: "Runs recurring search and reading workflows to surface market shifts, headlines, and competitor signals.",
    cronExpression: "0 * * * *",
    skills: ["multi-search-engine", "web-reader", "finance"],
    config: {
      watchlist: ["browser automation", "agent browser", "ai tooling"],
      sources: ["Bing INT", "Toutiao", "Jisilu"],
      alertThreshold: "medium",
    },
  }),
  createAgent({
    id: "business-daily",
    name: "Business Daily",
    description: "Executes the daily business routine — budget tracking, revenue analysis, content creation, music promotion checks.",
    cronExpression: "0 7 * * 1-5",
    skills: ["business-routine", "finance", "reporting"],
    config: {
      routines: ["check-budgets", "track-revenue", "generate-content", "check-analytics"],
      autoAlert: true,
    },
  }),
  createAgent({
    id: "business-weekly",
    name: "Business Weekly",
    description: "Runs weekly strategic business skills — market research, competitor analysis, SEO audit, analytics reporting, email campaign prep.",
    cronExpression: "0 9 * * 1",
    skills: ["business-routine", "strategy", "reporting"],
    config: {
      routines: ["scan-trends", "check-competitors", "audit-seo", "generate-report", "prepare-campaign"],
      industry: "music-tech",
    },
  }),
  createAgent({
    id: "self-upgrade-scanner",
    name: "Self-Upgrade Scanner",
    description: "Scans trending repos, evaluates fit against system components, and creates upgrade requests for auto-approved targets.",
    cronExpression: "0 6 * * 0",
    skills: ["upgrade-scan", "trending-analysis"],
    config: {
      maxRecommendations: 3,
      autoCreateJobs: true,
    },
  }),
  createAgent({
    id: "learning-digest",
    name: "Learning Digest",
    description: "Searches indexed coding books daily and produces a learning digest with key passages, code snippets, and reading recommendations.",
    cronExpression: "0 8 * * *",
    skills: ["coding-tools", "knowledge-search"],
    config: {
      tools: ["code-review-assistant", "ts-react-patterns", "python-best-practices", "distributed-systems", "security-patterns"],
      queries: {
        typescript: "TypeScript patterns generics async await error handling",
        react: "React hooks components state management patterns",
        python: "Python algorithms data structures optimization",
        distributed: "distributed systems consensus replication consistency",
        security: "security authentication encryption vulnerability scanning",
      },
      category: "Computers",
      maxResults: 3,
      outputTypes: ["code-snippets", "key-concepts", "reading-list"],
    },
  }),
  createAgent({
    id: "code-review-assistant",
    name: "Code Review Assistant",
    description: "Runs daily code review pattern checks against indexed books, stores findings for pipeline use.",
    cronExpression: "0 9 * * *",
    skills: ["code-review-assistant"],
    config: {
      query: "code review checklist testing best practices",
      category: "Computers",
      maxResults: 5,
      outputTypes: ["review-checklist", "testing-patterns", "quality-metrics"],
    },
  }),
  createAgent({
    id: "business-book-insights",
    name: "Business Book Insights",
    description: "Reviews indexed business books weekly for strategic frameworks, marketing tactics, and growth case studies.",
    cronExpression: "0 10 * * 1",
    skills: ["knowledge-search", "business-strategy"],
    config: {
      queries: {
        strategy: "business strategy competitive advantage market positioning",
        marketing: "marketing growth customer acquisition branding",
        analytics: "business analytics metrics KPIs data-driven decision making",
      },
      category: "Business",
      maxResults: 3,
      outputTypes: ["frameworks", "case-studies", "action-items"],
    },
  }),
  createAgent({
    id: "math-fundamentals-review",
    name: "Math Fundamentals Review",
    description: "Reviews indexed math/statistics books weekly for relevant formulas, probability concepts, and data analysis methods.",
    cronExpression: "0 9 * * 3",
    skills: ["knowledge-search", "math-reference"],
    config: {
      queries: {
        statistics: "statistics probability regression Bayesian hypothesis testing",
        linearAlgebra: "linear algebra matrices vectors eigenvalues decompositions",
        calculus: "calculus derivatives gradients optimization partial derivatives",
      },
      category: "Math",
      maxResults: 2,
      outputTypes: ["formulas", "concepts", "applications"],
    },
  }),
  createAgent({
    id: "finance-book-analysis",
    name: "Finance Book Analysis",
    description: "Reviews indexed financial books daily for investment frameworks, risk analysis methods, and market analysis context.",
    cronExpression: "0 6 * * *",
    skills: ["knowledge-search", "financial-analysis"],
    config: {
      queries: {
        investing: "investing valuation portfolio diversification risk management",
        analysis: "financial analysis ratios statements discounted cash flow",
        markets: "market efficiency behavioral finance trading strategies",
      },
      category: "financial",
      maxResults: 2,
      outputTypes: ["frameworks", "metrics", "risk-factors"],
    },
  }),
]

export function describeCron(cronExpression: string): string {
  switch (cronExpression) {
    case "0 8,12,20 * * *":
      return "Daily at 08:00, 12:00, and 20:00"
    case "0 9 * * *":
      return "Daily at 09:00"
    case "0 * * * *":
      return "Every hour"
    case "0 7 * * 1-5":
      return "Weekdays at 07:00"
    case "0 9 * * 1":
      return "Weekly Monday at 09:00"
    case "0 6 * * 0":
      return "Weekly Sunday at 06:00"
    case "0 8 * * *":
      return "Daily at 08:00"
    case "0 10 * * 1":
      return "Weekly Monday at 10:00"
    case "0 9 * * 3":
      return "Weekly Wednesday at 09:00"
    case "0 6 * * *":
      return "Daily at 06:00"
    default:
      return cronExpression
  }
}

export function sanitizePayload(v: unknown, depth = 0): unknown {
  if (depth > 5) return "[deep]"
  if (v === null || typeof v === "boolean" || typeof v === "number") return v
  if (typeof v === "string") return v.slice(0, 10000)
  if (Array.isArray(v)) return v.map(x => sanitizePayload(x, depth + 1)).slice(0, 100)
  if (typeof v === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k === "string" && k.length <= 256) out[k] = sanitizePayload(val, depth + 1)
    }
    return out
  }
  return String(v).slice(0, 1000)
}

export function isCronExpression(value: string): boolean {
  const parts = value.trim().split(/\s+/)
  if (parts.length !== 5) return false
  for (let i = 0; i < 5; i++) {
    if (parts[i].length > 100) return false
  }
  return true
}

function parseNumberList(field: string, min: number, max: number): number[] | null {
  if (field === "*") {
    return Array.from({ length: max - min + 1 }, (_, index) => min + index)
  }
  const values = field.split(",").map(value => Number.parseInt(value.trim(), 10))
  if (values.some(value => Number.isNaN(value) || value < min || value > max)) {
    return null
  }
  return [...new Set(values)].sort((a, b) => a - b)
}

export function estimateNextRun(cronExpression: string, from = new Date()): string | undefined {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return undefined
  }
  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts
  const minutes = parseNumberList(minuteField, 0, 59)
  const hours = parseNumberList(hourField, 0, 23)
  if (!minutes || !hours) {
    return undefined
  }
  const dayOfWeekSet = dayOfWeekField === "*"
    ? new Set([0, 1, 2, 3, 4, 5, 6])
    : new Set(
        dayOfWeekField.split(",").flatMap(v => {
          const range = v.split("-").map(Number)
          if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
            return Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i)
          }
          const n = Number(v)
          return isNaN(n) ? [] : [n]
        })
      )
  const dayOfMonthSet = dayOfMonthField === "*"
    ? new Set(Array.from({ length: 31 }, (_, i) => i + 1))
    : new Set(dayOfMonthField.split(",").map(Number))
  const monthSet = monthField === "*"
    ? new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    : new Set(monthField.split(",").map(Number))
  const next = new Date(from)
  next.setSeconds(0, 0)
  for (let dayOffset = 0; dayOffset < 60; dayOffset++) {
    const base = new Date(next)
    base.setDate(base.getDate() + dayOffset)
    const dom = base.getDate()
    if (dayOfMonthField !== "*") {
      const allowedDom = new Set(dayOfMonthField.split(",").map(Number))
      if (!allowedDom.has(dom)) continue
    }
    const dow = base.getDay()
    if (!dayOfWeekSet.has(dow)) continue
    const m = base.getMonth() + 1
    if (!monthSet.has(m)) continue
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = new Date(base)
        candidate.setHours(hour, minute, 0, 0)
        if (candidate.getTime() > from.getTime()) {
          return candidate.toISOString()
        }
      }
    }
  }
  return undefined
}

export function runPresetAgent(agent: ScheduledAgent): Record<string, unknown> | null {
  switch (agent.id) {
    case "auto-target-tracker":
      return {
        summary: "Prepared screenshot ingestion prompts for the next goal check-in window.",
        reminderWindows: agent.config.reminderWindows,
        captureKeywords: agent.config.captureKeywords,
        nextAction: "Inspect uploaded screenshots, extract progress metrics, and append a daily check-in summary.",
      }
    case "content-machine":
      return {
        summary: "Prepared a new content package for the next publishing cycle.",
        pillar: (Array.isArray(agent.config.contentPillars) ? agent.config.contentPillars : [])[0] ?? "ai browser workflows",
        topic: "How agent browsing turns into a repeatable autonomous workflow",
        seoBrief: {
          primaryKeyword: "agent browser workflow",
          secondaryKeywords: ["autonomous browsing", "ai browser automation", "agent ops"],
          targetWordCount: agent.config.targetWordCount ?? 1800,
        },
        imagePrompt: "Futuristic browser cockpit dashboard with AI agents coordinating tasks, cinematic lighting, editorial illustration",
      }
    case "market-intelligence":
      return {
        summary: "Prepared a fresh market scan across configured search and reading sources.",
        watchlist: agent.config.watchlist,
        sources: agent.config.sources,
        alerts: [
          "Monitor browser automation competitors for new feature drops.",
          "Track agent-browser infrastructure mentions for distribution opportunities.",
          "Review finance-linked market headlines for AI tooling spending shifts.",
        ],
      }
    case "business-daily":
      return { summary: "Daily business routine queued", routines: agent.config.routines, autoAlert: agent.config.autoAlert }
    case "business-weekly":
      return { summary: "Weekly strategic routine queued", routines: agent.config.routines, industry: agent.config.industry }
    case "self-upgrade-scanner":
      return { summary: "Trending repo scan triggered", maxRecommendations: agent.config.maxRecommendations, autoCreate: agent.config.autoCreateJobs }
    case "learning-digest":
    case "business-book-insights":
    case "math-fundamentals-review":
    case "finance-book-analysis":
    case "code-review-assistant":
      return null
    default:
      return null
  }
}

export async function runPresetAgentAsync(agent: ScheduledAgent): Promise<Record<string, unknown> | null> {
  const queries = agent.config.queries as Record<string, string> | undefined
  if (!queries || Object.keys(queries).length === 0) {
    return null
  }
  const results: Record<string, unknown> = {}
  for (const [topic, query] of Object.entries(queries)) {
    results[topic] = { note: `Query queued: ${query}`, topic }
  }
  return {
    dynamic: true,
    totalQueries: Object.keys(queries).length,
    results,
    summary: `Prepared ${Object.keys(queries).length} search queries`,
  }
}
