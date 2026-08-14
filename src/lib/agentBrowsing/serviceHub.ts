export interface ServiceDefinition {
  id: string
  name: string
  type: "mutly" | "vibeserve" | "reporank" | "blocklabor"
  port: number
  healthEndpoint: string
  apiKey?: string
  status: "unknown" | "running" | "stopped" | "error"
  capabilities: string[]
}

function populateApiKey(svc: Omit<ServiceDefinition, "apiKey"> & { apiKey?: string }): ServiceDefinition {
  return { ...svc, apiKey: svc.apiKey ?? undefined }
}

export const SERVICES: ServiceDefinition[] = [
  populateApiKey({
    id: "mutly",
    name: "Mutly Daemon Agent",
    type: "mutly",
    port: 4000,
    healthEndpoint: "/api/health",
    status: "unknown",
    capabilities: ["pipeline", "build", "code-review", "autonomous-loop", "drift-detection", "approval-gates"],
  }),
  populateApiKey({
    id: "vibeserve",
    name: "VibeServe",
    type: "vibeserve",
    port: 8000,
    healthEndpoint: "/api/vibeserve/health",
    status: "unknown",
    capabilities: ["mcp-tools", "llm-routing", "memory", "task-classification", "rate-limiting", "providers"],
  }),
  populateApiKey({
    id: "reporank",
    name: "RepoRank",
    type: "reporank",
    port: 3001,
    healthEndpoint: "/api/reporank/health",
    status: "unknown",
    capabilities: ["project-scoring", "quality-audit", "code-analysis", "task-generation"],
  }),
  populateApiKey({
    id: "blocklabor",
    name: "BlockLabor",
    type: "blocklabor",
    port: 3000,
    healthEndpoint: "/api/labor/health",
    status: "unknown",
    capabilities: [
      "worker-profiles",
      "job-postings",
      "verified-stamp",
      "business-verification",
      "ghost-job-audit",
      "application-sla",
      "trust-tier",
    ],
  }),
]

export interface ServiceStatus {
  id: string
  running: boolean
  version?: string
  error?: string
}

export async function checkServiceHealth(service: ServiceDefinition): Promise<ServiceStatus> {
  try {
    const mutly = SERVICES.find(s => s.id === "mutly")
    if (mutly && service.id !== "mutly" && mutly.status === "running") {
      const gwUrl = `http://127.0.0.1:${mutly.port}${service.healthEndpoint}`
      const gwRes = await fetch(gwUrl, { signal: AbortSignal.timeout(5000) }).catch(() => null)
      if (gwRes?.ok) {
        const body = await gwRes.json().catch(() => ({}))
        const reachable = body.reachable !== false
        service.status = reachable ? "running" : "stopped"
        return { id: service.id, running: reachable }
      }
    }
    const url = `http://127.0.0.1:${service.port}${service.healthEndpoint}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    service.status = res.ok ? "running" : "error"
    return { id: service.id, running: res.ok }
  } catch {
    service.status = "stopped"
    return { id: service.id, running: false, error: "Connection failed" }
  }
}

export async function checkAllServices(): Promise<ServiceStatus[]> {
  return Promise.all(SERVICES.map(checkServiceHealth))
}

export function requireService(id: string): ServiceDefinition {
  const svc = SERVICES.find(s => s.id === id)
  if (!svc) throw new Error(`Service '${id}' not found in registry`)
  return svc
}

export async function callMutlyApi(endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
  const mutly = requireService("mutly")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (mutly.apiKey) headers["X-Mutly-API-Key"] = mutly.apiKey
  const url = `http://127.0.0.1:${mutly.port}${endpoint}`
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Mutly API error: ${res.status}`)
  return res.json()
}

export async function runMutlyPipeline(projectDir?: string): Promise<unknown> {
  return callMutlyApi("/api/pipeline/start", "POST", { projectDir })
}

export async function getMutlyPipelineStatus(): Promise<unknown> {
  return callMutlyApi("/api/pipeline/status")
}

export async function executeVibeServeTool(tool: string, params: Record<string, unknown>): Promise<unknown> {
  try {
    const mutly = requireService("mutly")
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (mutly.apiKey) headers["X-Mutly-API-Key"] = mutly.apiKey
    const res = await fetch(`http://127.0.0.1:${mutly.port}/api/vibeserve/tools/${tool}`, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30000),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `VibeServe via Mutly: ${res.status}`)
    return body.result ?? body
  } catch {
    const vs = requireService("vibeserve")
    const directRes = await fetch(`http://127.0.0.1:${vs.port}/tools/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000),
    })
    if (!directRes.ok) throw new Error(`VibeServe direct error: ${directRes.status}`)
    return directRes.json()
  }
}

export async function getVibeServeTools(): Promise<unknown> {
  try {
    return await executeVibeServeTool("vs_health", {})
  } catch {
    return { error: "VibeServe not reachable" }
  }
}

export async function rankProject(projectPath: string): Promise<unknown> {
  try {
    const mutly = requireService("mutly")
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (mutly.apiKey) headers["X-Mutly-API-Key"] = mutly.apiKey
    const res = await fetch(`http://127.0.0.1:${mutly.port}/api/reporank/scan`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path: projectPath, repoName: projectPath.split(/[/\\]/).pop() || "project", privateMode: true }),
      signal: AbortSignal.timeout(60000),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `RepoRank via Mutly: ${res.status}`)
    const scanData = body.result?.data || body.result || body
    return {
      score: scanData.result?.overallScore ?? 50,
      quality: scanData.result?.gradeCategory ?? "unknown",
      issues: (scanData.result?.findings as Array<{ title: string }>)?.map((f: any) => f.title) ?? [],
    }
  } catch {
    const rr = requireService("reporank")
    const directRes = await fetch(`http://127.0.0.1:${rr.port}/api/v1/scans/local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath }),
      signal: AbortSignal.timeout(30000),
    })
    if (!directRes.ok) throw new Error(`RepoRank direct error: ${directRes.status}`)
    const directData = await directRes.json()
    return {
      score: directData.result?.overallScore ?? 50,
      quality: directData.result?.gradeCategory ?? "unknown",
      issues: (directData.result?.findings as Array<{ title: string }>)?.map((f: any) => f.title) ?? [],
    }
  }
}

async function callReporank(method: string, endpoint: string, body?: unknown, timeout = 15000): Promise<unknown> {
  try {
    const mutly = requireService("mutly")
    const mutlyPath = `/api/reporank${endpoint}`
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (mutly.apiKey) headers["X-Mutly-API-Key"] = mutly.apiKey
    const res = await fetch(`http://127.0.0.1:${mutly.port}${mutlyPath}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Mutly proxy: ${res.status}`)
    return data.result ?? data
  } catch {
    const rr = requireService("reporank")
    const rrPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`
    const fullPath = `/api/v1${rrPath}`
    const directHeaders: Record<string, string> = { "Content-Type": "application/json" }
    if (rr.apiKey) directHeaders["X-Mutly-Key"] = rr.apiKey
    const directRes = await fetch(`http://127.0.0.1:${rr.port}${fullPath}`, {
      method, headers: directHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
    if (!directRes.ok) throw new Error(`RepoRank direct: ${directRes.status}`)
    return directRes.json()
  }
}

export async function createRepoBrief(data: Record<string, unknown>): Promise<unknown> {
  return callReporank("POST", "/briefs", data, 15000)
}

export async function listRepoBriefs(): Promise<unknown> {
  return callReporank("GET", "/briefs", undefined, 10000)
}

export async function getRepoBrief(id: string): Promise<unknown> {
  return callReporank("GET", `/briefs/${id}`, undefined, 10000)
}

export async function createRepoMilestone(data: Record<string, unknown>): Promise<unknown> {
  return callReporank("POST", "/milestones", data, 15000)
}

export async function listRepoMilestones(projectId: string): Promise<unknown> {
  return callReporank("GET", `/milestones/project/${projectId}`, undefined, 10000)
}

export async function evaluateRepoGate(gateId: string, data: Record<string, unknown>): Promise<unknown> {
  return callReporank("POST", `/gates/${gateId}/evaluate`, data, 15000)
}

export async function runRepoDrift(projectId: string, data?: Record<string, unknown>): Promise<unknown> {
  return callReporank("POST", `/drift/${projectId}`, data, 30000)
}

export async function getFullScanResult(scanId: string): Promise<unknown> {
  return callReporank("GET", `/scan/${scanId}`, undefined, 10000)
}

const BLOCKLABOR_API_PREFIX = "/api/labor"

function buildBlocklaborUrl(port: number, endpoint: string, query?: Record<string, unknown>): string {
  const blPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`
  const url = new URL(`http://127.0.0.1:${port}${BLOCKLABOR_API_PREFIX}${blPath}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url.toString()
}

async function callBlocklabor(
  method: string,
  endpoint: string,
  body?: unknown,
  timeout = 15000,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const queryParams = query ?? (method === "GET" && body && typeof body === "object"
    ? body as Record<string, unknown>
    : undefined)
  try {
    const mutly = requireService("mutly")
    const mutlyPath = `/api/blocklabor${endpoint}`
    const mutlyUrl = new URL(`http://127.0.0.1:${mutly.port}${mutlyPath}`)
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null) mutlyUrl.searchParams.set(key, String(value))
      }
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (mutly.apiKey) headers["X-Mutly-API-Key"] = mutly.apiKey
    const res = await fetch(mutlyUrl.toString(), {
      method, headers,
      body: method !== "GET" && body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Mutly proxy: ${res.status}`)
    return data.result ?? data
  } catch {
    const bl = requireService("blocklabor")
    const directHeaders: Record<string, string> = { "Content-Type": "application/json" }
    if (bl.apiKey) directHeaders["Authorization"] = `Bearer ${bl.apiKey}`
    const directRes = await fetch(buildBlocklaborUrl(bl.port, endpoint, queryParams), {
      method, headers: directHeaders,
      body: method !== "GET" && body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
    if (!directRes.ok) throw new Error(`BlockLabor direct: ${directRes.status}`)
    return directRes.json()
  }
}

export async function getWorkerProfile(workerId: string): Promise<unknown> {
  return callBlocklabor("GET", `/workers/${workerId}`, undefined, 10000)
}

export async function listWorkerProfiles(filters?: Record<string, unknown>): Promise<unknown> {
  return callBlocklabor("GET", "/workers", filters, 10000)
}

export async function getJobPosting(jobId: string): Promise<unknown> {
  return callBlocklabor("GET", `/jobs/${jobId}`, undefined, 10000)
}

export async function listOpenJobs(filters?: Record<string, unknown>): Promise<unknown> {
  return callBlocklabor("GET", "/jobs", filters, 10000)
}

export async function rankWorkersForJob(jobId: string, topK?: number): Promise<unknown> {
  return callBlocklabor("POST", `/jobs/${jobId}/rank`, { topK: topK ?? 5 }, 20000)
}

export async function requestBusinessIdentityVerification(payload: {
  businessName: string
  businessPhone: string
  businessEin: string
  businessState: string
  tenantId: string
}): Promise<unknown> {
  return callBlocklabor("POST", "/verification/business-identity", payload, 15000)
}

export async function requestGhostJobAudit(payload: {
  jobId: string
  businessPhone: string
  jobTitle: string
  tenantId: string
}): Promise<unknown> {
  return callBlocklabor("POST", "/verification/ghost-job-audit", payload, 15000)
}

export async function requestApplicationSlaAlert(payload: {
  jobId: string
  businessPhone: string
  applicantName: string
  slaHoursBreached: number
  tenantId: string
}): Promise<unknown> {
  return callBlocklabor("POST", "/verification/application-sla-breach", payload, 15000)
}
