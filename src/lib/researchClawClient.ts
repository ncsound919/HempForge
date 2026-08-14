import type { ResearchClawPipelineStartRequest, ResearchClawPipelineStartResponse, ResearchClawPipelineStatus, ResearchClawPipelineResults, ResearchClawProject, ResearchClawRun, ResearchClawChatMessage } from "../types/researchclaw";

const BASE_URL = process.env.RESEARCHCLAW_URL || "http://localhost:8080";

async function apiCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`ResearchClaw API ${method} ${path}: ${res.status} — ${text}`);
  }
  return res.json();
}

export async function createPipeline(config: ResearchClawPipelineStartRequest): Promise<ResearchClawPipelineStartResponse> {
  return apiCall<ResearchClawPipelineStartResponse>("POST", "/api/pipeline/start", {
    topic: config.topic,
    config_overrides: config.configOverrides,
    auto_approve: config.autoApprove ?? true,
  });
}

export async function getPipelineStatus(pipelineId: string): Promise<ResearchClawPipelineStatus> {
  if (pipelineId === "_active") {
    return apiCall<ResearchClawPipelineStatus>("GET", "/api/pipeline/status");
  }
  return apiCall<ResearchClawPipelineStatus>("GET", `/api/runs/${pipelineId}`);
}

export async function getPipelineResults(pipelineId: string): Promise<ResearchClawPipelineResults> {
  return apiCall<ResearchClawPipelineResults>("GET", `/api/runs/${pipelineId}/metrics`);
}

export async function sendMessage(pipelineId: string, message: string): Promise<ResearchClawChatMessage> {
  return apiCall<ResearchClawChatMessage>("POST", `/api/runs/${pipelineId}/chat`, { message });
}

export async function listProjects(): Promise<ResearchClawProject[]> {
  const data = await apiCall<{ projects: ResearchClawProject[] }>("GET", "/api/projects");
  return data.projects;
}

export async function listRuns(): Promise<ResearchClawRun[]> {
  const data = await apiCall<{ runs: ResearchClawRun[] }>("GET", "/api/runs");
  return data.runs;
}

export async function getRunDetail(runId: string): Promise<ResearchClawRun> {
  return apiCall<ResearchClawRun>("GET", `/api/runs/${runId}`);
}

export async function stopPipeline(): Promise<{ status: string }> {
  return apiCall<{ status: string }>("POST", "/api/pipeline/stop");
}

export async function getPipelineStages(): Promise<{ stages: any[] }> {
  return apiCall<{ stages: any[] }>("GET", "/api/pipeline/stages");
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
