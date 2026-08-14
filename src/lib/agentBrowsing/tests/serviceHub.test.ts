import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  SERVICES,
  checkServiceHealth,
  checkAllServices,
  requireService,
  callMutlyApi,
  runMutlyPipeline,
  getMutlyPipelineStatus,
  executeVibeServeTool,
  getVibeServeTools,
  rankProject,
  getWorkerProfile,
  listWorkerProfiles,
  getJobPosting,
  listOpenJobs,
  rankWorkersForJob,
  requestBusinessIdentityVerification,
  requestGhostJobAudit,
  requestApplicationSlaAlert,
  createRepoBrief,
  listRepoBriefs,
  getRepoBrief,
  createRepoMilestone,
  listRepoMilestones,
  evaluateRepoGate,
  runRepoDrift,
  getFullScanResult,
  type ServiceDefinition,
} from "../serviceHub";

vi.mock("./node-fetch-native", () => ({
  fetch: vi.fn(),
}));

const mockFetch = global.fetch as any;

describe("ServiceHub", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("SERVICES registry", () => {
    it("should contain all expected default services", () => {
      const ids = SERVICES.map((s) => s.id);
      expect(ids).toContain("mutly");
      expect(ids).toContain("vibeserve");
      expect(ids).toContain("reporank");
      expect(ids).toContain("blocklabor");
    });

    it("should have unique service IDs", () => {
      const ids = SERVICES.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should have non-empty capabilities for each service", () => {
      for (const svc of SERVICES) {
        expect(svc.capabilities.length).toBeGreaterThan(0);
      }
    });

    it("should have valid ports", () => {
      for (const svc of SERVICES) {
        expect(svc.port).toBeGreaterThan(0);
        expect(svc.port).toBeLessThan(65536);
      }
    });
  });

  describe("requireService", () => {
    it("should return the service for a known ID", () => {
      const svc = requireService("mutly");
      expect(svc.id).toBe("mutly");
    });

    it("should throw for an unknown ID", () => {
      expect(() => requireService("nonexistent")).toThrow(/not found/);
    });
  });

  describe("checkServiceHealth", () => {
    it("should return running=true when service responds OK", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reachable: true }),
      });
      const svc = SERVICES.find((s) => s.id === "vibeserve")!;
      const result = await checkServiceHealth(svc);
      expect(result.running).toBe(true);
      expect(svc.status).toBe("running");
    });

    it("should return running=false on fetch error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      const svc = SERVICES.find((s) => s.id === "vibeserve")!;
      const result = await checkServiceHealth(svc);
      expect(result.running).toBe(false);
      expect(svc.status).toBe("stopped");
    });

    it("should return running=true when reachable is true via Mutly", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reachable: true }),
      });
      const reporank = SERVICES.find((s) => s.id === "reporank")!;
      const result = await checkServiceHealth(reporank);
      expect(result.running).toBe(true);
    });

    it("should fall back to direct service when Mutly proxy fails", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      // First fetch (Mutly) fails
      mockFetch.mockRejectedValueOnce(new Error("Mutly timeout"));
      // Second fetch (direct service) succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok" }),
      });

      const blocklabor = SERVICES.find((s) => s.id === "blocklabor")!;
      const result = await checkServiceHealth(blocklabor);
      expect(result.running).toBe(true);
    });

    it("should handle non-OK response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });
      const svc = SERVICES.find((s) => s.id === "mutly")!;
      const result = await checkServiceHealth(svc);
      expect(result.running).toBe(false);
    });
  });

  describe("checkAllServices", () => {
    it("should check all services in parallel", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ reachable: true }),
      });

      const results = await checkAllServices();
      expect(results).toHaveLength(SERVICES.length);
    });

    it("should return one status per service", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ reachable: true }),
      });

      const results = await checkAllServices();
      const ids = results.map((r) => r.id).sort();
      const serviceIds = SERVICES.map((s) => s.id).sort();
      expect(ids).toEqual(serviceIds);
    });

    it("should handle when some services are down", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("mutly")) {
          return {
            ok: true,
            json: async () => ({ reachable: true }),
          };
        }
        throw new Error("Service down");
      });

      const results = await checkAllServices();
      const downCount = results.filter((r) => !r.running).length;
      expect(downCount).toBeGreaterThan(0);
    });
  });

  describe("callMutlyApi", () => {
    beforeEach(() => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";
      mutly.apiKey = undefined;
    });

    it("should make a successful GET request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: "test" }),
      });

      const result = await callMutlyApi("/api/test");
      expect(result).toEqual({ data: "test" });
    });

    it("should send JSON body for POST", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await callMutlyApi("/api/test", "POST", { key: "value" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ key: "value" }),
        })
      );
    });

    it("should throw on non-OK response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Server error" }),
      });

      await expect(callMutlyApi("/api/test")).rejects.toThrow(/Mutly API error/);
    });

    it("should include API key header when configured", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.apiKey = "test-api-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await callMutlyApi("/api/test");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Mutly-API-Key": "test-api-key",
          }),
        })
      );

      mutly.apiKey = undefined;
    });
  });

  describe("runMutlyPipeline", () => {
    it("should call POST /api/pipeline/start", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: "r-1" }),
      });

      const result = await runMutlyPipeline("/some/dir");
      expect(result).toEqual({ runId: "r-1" });
    });

    it("should pass projectDir in body", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await runMutlyPipeline("/my/project");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ projectDir: "/my/project" }),
        })
      );
    });
  });

  describe("getMutlyPipelineStatus", () => {
    it("should call GET /api/pipeline/status", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "running", progress: 50 }),
      });

      const result = await getMutlyPipelineStatus();
      expect(result).toEqual({ status: "running", progress: 50 });
    });
  });

  describe("executeVibeServeTool", () => {
    it("should call Mutly proxy when available", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "tool-output" }),
      });

      const result = await executeVibeServeTool("vs_health", {});
      expect(result).toEqual("tool-output");
    });

    it("should fall back to direct VibeServe when Mutly fails", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      // Mutly fetch fails
      mockFetch.mockRejectedValueOnce(new Error("Mutly down"));

      // Direct VibeServe fetch succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ direct: true }),
      });

      const result = await executeVibeServeTool("vs_health", {});
      expect(result).toEqual({ direct: true });
    });

    it("should throw when both Mutly and direct fail", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      mockFetch.mockRejectedValue(new Error("All connections failed"));

      await expect(executeVibeServeTool("vs_health", {})).rejects.toThrow();
    });
  });

  describe("getVibeServeTools", () => {
    it("should return error object when VibeServe is unreachable", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "stopped";

      mockFetch.mockRejectedValue(new Error("Connection failed"));

      const result = await getVibeServeTools();
      expect(result).toHaveProperty("error");
    });
  });

  describe("rankProject", () => {
    it("should return score data on successful Mutly response", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              result: {
                overallScore: 85,
                gradeCategory: "A",
                findings: [{ title: "Issue 1" }, { title: "Issue 2" }],
              },
            },
          },
        }),
      });

      const result = await rankProject("/path/to/repo");
      expect(result).toEqual({
        score: 85,
        quality: "A",
        issues: ["Issue 1", "Issue 2"],
      });
    });

    it("should fall back to direct RepoRank when Mutly fails", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      // Mutly fetch fails
      mockFetch.mockRejectedValueOnce(new Error("Mutly failed"));

      // Direct RepoRank fetch succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            overallScore: 70,
            gradeCategory: "B",
            findings: [{ title: "Direct Issue" }],
          },
        }),
      });

      const result = await rankProject("/path/to/repo");
      expect(result).toMatchObject({
        score: 70,
        quality: "B",
      });
    });

    it("should use default score 50 when no score is returned", async () => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await rankProject("/path/to/repo");
      expect(result).toMatchObject({ score: 50, quality: "unknown" });
    });
  });

  describe("BlockLabor API functions", () => {
    beforeEach(() => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";
    });

    it("getWorkerProfile should call Mutly with correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ worker: { id: "w-1" } }),
      });

      const result = await getWorkerProfile("w-1");
      expect(result).toEqual({ worker: { id: "w-1" } });
    });

    it("listWorkerProfiles should pass filters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workers: [] }),
      });

      await listWorkerProfiles({ skill: "plumbing", location: "NYC" });

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain("skill=plumbing");
      expect(callUrl).toContain("location=NYC");
    });

    it("listOpenJobs should call correct endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobs: [] }),
      });

      const result = await listOpenJobs();
      expect(result).toEqual({ jobs: [] });
    });

    it("rankWorkersForJob should pass topK parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ranks: [{ workerId: "w-1", score: 95 }] }),
      });

      const result = await rankWorkersForJob("j-1", 3);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody).toEqual({ topK: 3 });
      expect(result).toBeDefined();
    });

    it("requestBusinessIdentityVerification should send all fields", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verified: true }),
      });

      await requestBusinessIdentityVerification({
        businessName: "Test Co",
        businessPhone: "555-1234",
        businessEin: "12-3456789",
        businessState: "NY",
        tenantId: "tenant-1",
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.businessName).toBe("Test Co");
      expect(callBody.businessEin).toBe("12-3456789");
    });

    it("requestGhostJobAudit should format payload correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auditId: "audit-1" }),
      });

      await requestGhostJobAudit({
        jobId: "j-1",
        businessPhone: "555-1234",
        jobTitle: "Test Job",
        tenantId: "tenant-1",
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.jobId).toBe("j-1");
      expect(callBody.jobTitle).toBe("Test Job");
    });

    it("requestApplicationSlaAlert should include slaHoursBreached", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ alerted: true }),
      });

      await requestApplicationSlaAlert({
        jobId: "j-1",
        businessPhone: "555-1234",
        applicantName: "John Doe",
        slaHoursBreached: 48,
        tenantId: "tenant-1",
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.slaHoursBreached).toBe(48);
      expect(callBody.applicantName).toBe("John Doe");
    });

    it("getJobPosting should fetch job by ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ job: { id: "j-1", title: "Plumber" } }),
      });

      const result = await getJobPosting("j-1");
      expect(result).toEqual({ job: { id: "j-1", title: "Plumber" } });
    });
  });

  describe("RepoRank API functions", () => {
    beforeEach(() => {
      const mutly = SERVICES.find((s) => s.id === "mutly")!;
      mutly.status = "running";
    });

    it("createRepoBrief should POST brief data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ briefId: "b-1" }),
      });

      const result = await createRepoBrief({ repoName: "test-repo" });
      expect(result).toBeDefined();
    });

    it("listRepoBriefs should fetch all briefs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ briefs: [] }),
      });

      const result = await listRepoBriefs();
      expect(result).toBeDefined();
    });

    it("getRepoBrief should fetch specific brief", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ brief: { id: "b-1" } }),
      });

      const result = await getRepoBrief("b-1");
      expect(result).toBeDefined();
    });

    it("createRepoMilestone should POST milestone data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ milestoneId: "m-1" }),
      });

      const result = await createRepoMilestone({ title: "v1.0" });
      expect(result).toBeDefined();
    });

    it("listRepoMilestones should fetch project milestones", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ milestones: [] }),
      });

      const result = await listRepoMilestones("project-1");
      expect(result).toBeDefined();
    });

    it("evaluateRepoGate should POST evaluation data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ passed: true }),
      });

      const result = await evaluateRepoGate("gate-1", { score: 85 });
      expect(result).toBeDefined();
    });

    it("runRepoDrift should POST drift data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ driftScore: 0.05 }),
      });

      const result = await runRepoDrift("project-1");
      expect(result).toBeDefined();
    });

    it("getFullScanResult should fetch scan by ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ scan: { id: "s-1" } }),
      });

      const result = await getFullScanResult("s-1");
      expect(result).toBeDefined();
    });
  });

  describe("ServiceDefinition type", () => {
    it("should have valid status field", () => {
      const validStatuses = ["unknown", "running", "stopped", "error"];
      for (const svc of SERVICES) {
        expect(validStatuses).toContain(svc.status);
      }
    });

    it("should have valid type field", () => {
      const validTypes = ["mutly", "vibeserve", "reporank", "blocklabor"];
      for (const svc of SERVICES) {
        expect(validTypes).toContain(svc.type);
      }
    });
  });
});
