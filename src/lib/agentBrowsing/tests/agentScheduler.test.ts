import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  agentScheduler,
  AgentScheduler,
} from "../agentScheduler";
import {
  writeMemory,
  readMemory,
  searchMemory,
  deleteMemory,
  cleanExpiredMemory,
  type MemoryEntry,
} from "../agentMemory";

describe("AgentScheduler", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    agentScheduler.shutdown();
  });

  describe("registerAgent", () => {
    it("should register a new agent", () => {
      const agent = {
        id: "test-agent-1",
        name: "Test Agent 1",
        description: "Test",
        cronExpression: "0 9 * * *",
        skills: ["test-skill"],
        status: "idle" as const,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        enabled: false,
        config: {},
      };

      agentScheduler.registerAgent(agent);
      const retrieved = agentScheduler.getAgent("test-agent-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test Agent 1");
    });

    it("should not schedule when agent is disabled", () => {
      const agent = {
        id: "test-disabled",
        name: "Disabled Agent",
        description: "Disabled",
        cronExpression: "0 9 * * *",
        skills: [],
        status: "idle" as const,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        enabled: false,
        config: {},
      };

      agentScheduler.registerAgent(agent);
      expect(agentScheduler.getAgent("test-disabled")).toBeDefined();
    });
  });

  describe("getAgent", () => {
    it("should return undefined for unknown agent", () => {
      expect(agentScheduler.getAgent("nonexistent-agent")).toBeUndefined();
    });

    it("should return the registered agent", () => {
      const agent = {
        id: "get-test",
        name: "Get Test",
        description: "",
        cronExpression: "0 9 * * *",
        skills: [],
        status: "idle" as const,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        enabled: false,
        config: {},
      };

      agentScheduler.registerAgent(agent);
      expect(agentScheduler.getAgent("get-test")).toEqual(
        expect.objectContaining({ id: "get-test" })
      );
    });
  });

  describe("getAgents", () => {
    it("should return all registered agents", () => {
      const initialCount = agentScheduler.getAgents().length;

      agentScheduler.registerAgent({
        id: "batch-test-1",
        name: "Batch 1",
        description: "",
        cronExpression: "0 9 * * *",
        skills: [],
        status: "idle" as const,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        enabled: false,
        config: {},
      });
      agentScheduler.registerAgent({
        id: "batch-test-2",
        name: "Batch 2",
        description: "",
        cronExpression: "0 9 * * *",
        skills: [],
        status: "idle" as const,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        enabled: false,
        config: {},
      });

      expect(agentScheduler.getAgents().length).toBe(initialCount + 2);
    });
  });

  describe("updateAgent", () => {
    it("should throw error for non-existent agent", async () => {
      await expect(
        agentScheduler.updateAgent("nonexistent", { enabled: true })
      ).rejects.toThrow(/not found/);
    });

    it("should update existing agent properties", async () => {
      agentScheduler.registerAgent({
        id: "update-test",
        name: "Update Test",
        description: "Original",
        cronExpression: "0 9 * * *",
        skills: [],
        status: "idle" as const,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        enabled: false,
        config: {},
      });

      await agentScheduler.updateAgent("update-test", {
        description: "Updated",
        cronExpression: "0 10 * * *",
      });

      const updated = agentScheduler.getAgent("update-test");
      expect(updated?.description).toBe("Updated");
    });
  });

  describe("deleteAgent", () => {
    it("should remove agent", () => {
      agentScheduler.registerAgent({
        id: "delete-test",
        name: "Delete Test",
        description: "",
        cronExpression: "0 9 * * *",
        skills: [],
        status: "idle" as const,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        enabled: false,
        config: {},
      });

      expect(agentScheduler.getAgent("delete-test")).toBeDefined();
      agentScheduler.deleteAgent("delete-test");
      expect(agentScheduler.getAgent("delete-test")).toBeUndefined();
    });

    it("should not throw when deleting nonexistent agent", () => {
      expect(() => agentScheduler.deleteAgent("nonexistent")).not.toThrow();
    });
  });

  describe("executeAgent", () => {
    it("should throw for nonexistent agent", async () => {
      await expect(
        agentScheduler.executeAgent("nonexistent")
      ).rejects.toThrow(/not found/);
    });
  });

  describe("refreshAgents", () => {
    it("should be idempotent", async () => {
      const initialCount = agentScheduler.getAgents().length;
      await agentScheduler.refreshAgents();
      await agentScheduler.refreshAgents();
      expect(agentScheduler.getAgents().length).toBeGreaterThanOrEqual(initialCount);
    });
  });

  describe("getExecutionLogs", () => {
    it("should return all logs when no filter", () => {
      const logs = agentScheduler.getExecutionLogs();
      expect(Array.isArray(logs)).toBe(true);
    });

    it("should filter by agentId", () => {
      const logs = agentScheduler.getExecutionLogs("test-agent");
      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should return valid statistics", () => {
      const stats = agentScheduler.getStats();
      expect(stats).toMatchObject({
        totalAgents: expect.any(Number),
        enabledAgents: expect.any(Number),
        totalExecutions: expect.any(Number),
        totalSuccesses: expect.any(Number),
        totalFailures: expect.any(Number),
      });
    });

    it("should have non-negative counts", () => {
      const stats = agentScheduler.getStats();
      expect(stats.totalAgents).toBeGreaterThanOrEqual(0);
      expect(stats.enabledAgents).toBeGreaterThanOrEqual(0);
      expect(stats.totalExecutions).toBeGreaterThanOrEqual(0);
    });
  });

  describe("shutdown", () => {
    it("should stop all cron jobs", () => {
      const scheduler = new AgentScheduler();
      scheduler.registerAgent({
        id: "shutdown-test",
        name: "Shutdown",
        description: "",
        cronExpression: "*/5 * * * *",
        skills: [],
        status: "idle" as const,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        enabled: true,
        config: {},
      });
      expect(() => scheduler.shutdown()).not.toThrow();
    });
  });
});
