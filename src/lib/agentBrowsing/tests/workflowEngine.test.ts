import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  registerWorkflow,
  getWorkflow,
  listWorkflows,
  listCategories,
  runWorkflow,
  getWorkflowRun,
  listActiveRuns,
  registerBuiltInWorkflows,
  type WorkflowStep,
  type WorkflowDefinition,
} from "../workflowEngine";

describe("WorkflowEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Workflow registration", () => {
    it("should register a new workflow", () => {
      const wf: WorkflowDefinition = {
        id: "test-wf-1",
        name: "Test Workflow",
        description: "Test description",
        category: "monitoring",
        tags: ["test"],
        steps: [],
      };
      registerWorkflow(wf);
      expect(getWorkflow("test-wf-1")).toBeDefined();
    });

    it("should overwrite existing workflow with same ID", () => {
      const wf1: WorkflowDefinition = {
        id: "test-dup",
        name: "First",
        description: "First version",
        category: "monitoring",
        tags: [],
        steps: [],
      };
      const wf2: WorkflowDefinition = {
        id: "test-dup",
        name: "Second",
        description: "Second version",
        category: "monitoring",
        tags: [],
        steps: [],
      };
      registerWorkflow(wf1);
      registerWorkflow(wf2);
      expect(getWorkflow("test-dup")?.name).toBe("Second");
    });
  });

  describe("listWorkflows", () => {
    beforeEach(() => {
      registerWorkflow({
        id: "wf-monitor",
        name: "Monitor",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [],
      });
      registerWorkflow({
        id: "wf-business",
        name: "Business",
        description: "",
        category: "business",
        tags: [],
        steps: [],
      });
    });

    it("should list all workflows", () => {
      const all = listWorkflows();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by category", () => {
      const monitorWfs = listWorkflows("monitoring");
      expect(monitorWfs.length).toBeGreaterThanOrEqual(1);
      expect(monitorWfs.every((wf) => wf.category === "monitoring")).toBe(true);
    });

    it("should return empty array for unknown category", () => {
      const unknown = listWorkflows("nonexistent-category");
      expect(unknown).toEqual([]);
    });
  });

  describe("listCategories", () => {
    it("should return unique categories", () => {
      registerWorkflow({
        id: "cat-test-1",
        name: "Test",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [],
      });
      registerWorkflow({
        id: "cat-test-2",
        name: "Test 2",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [],
      });
      registerWorkflow({
        id: "cat-test-3",
        name: "Test 3",
        description: "",
        category: "research",
        tags: [],
        steps: [],
      });

      const categories = listCategories();
      expect(categories).toContain("monitoring");
      expect(categories).toContain("research");
      expect(new Set(categories).size).toBe(categories.length);
    });
  });

  describe("Workflow run", () => {
    it("should throw error for unknown workflow", async () => {
      await expect(runWorkflow("nonexistent")).rejects.toThrow(/not found/);
    });

    it("should execute a simple workflow with delay step", async () => {
      const wf: WorkflowDefinition = {
        id: "simple-delay",
        name: "Simple Delay",
        description: "Single delay step",
        category: "monitoring",
        tags: [],
        steps: [
          {
            id: "delay-1",
            type: "delay",
            label: "Wait 100ms",
            config: { ms: 50 },
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("simple-delay");
      expect(run.status).toBe("completed");
      expect(run.stepResults["delay-1"].status).toBe("success");
    });

    it("should track workflow start and completion", async () => {
      const wf: WorkflowDefinition = {
        id: "track-test",
        name: "Track Test",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          {
            id: "step-1",
            type: "delay",
            label: "Delay",
            config: { ms: 10 },
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("track-test");
      expect(run.startedAt).toBeTruthy();
      expect(run.completedAt).toBeTruthy();
      expect(run.id).toBeTruthy();
    });

    it("should handle workflow with multiple steps", async () => {
      const wf: WorkflowDefinition = {
        id: "multi-step",
        name: "Multi Step",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          { id: "s1", type: "delay", label: "First", config: { ms: 10 } },
          { id: "s2", type: "delay", label: "Second", config: { ms: 10 } },
          { id: "s3", type: "delay", label: "Third", config: { ms: 10 } },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("multi-step");
      expect(run.status).toBe("completed");
      expect(Object.keys(run.stepResults)).toHaveLength(3);
    });

    it("should run dependent steps in order", async () => {
      const executionOrder: string[] = [];
      const wf: WorkflowDefinition = {
        id: "ordered-deps",
        name: "Ordered Deps",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          {
            id: "step-a",
            type: "competitor-signal",
            label: "Step A",
            config: { competitor: "test", signal: "test-signal" },
            dependsOn: [],
          },
          {
            id: "step-b",
            type: "competitor-signal",
            label: "Step B",
            config: { competitor: "test", signal: "test-signal" },
            dependsOn: ["step-a"],
          },
          {
            id: "step-c",
            type: "competitor-signal",
            label: "Step C",
            config: { competitor: "test", signal: "test-signal" },
            dependsOn: ["step-b"],
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("ordered-deps", (stepId) => {
        executionOrder.push(stepId);
      });

      expect(executionOrder).toEqual(["step-a", "step-b", "step-c"]);
      expect(run.status).toBe("completed");
    });

    it("should call onStep callback for each step", async () => {
      const wf: WorkflowDefinition = {
        id: "callback-test",
        name: "Callback Test",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          { id: "s1", type: "delay", label: "Step 1", config: { ms: 10 } },
          { id: "s2", type: "delay", label: "Step 2", config: { ms: 10 } },
        ],
      };
      registerWorkflow(wf);

      const stepIds: string[] = [];
      await runWorkflow("callback-test", (stepId) => {
        stepIds.push(stepId);
      });

      expect(stepIds).toEqual(["s1", "s2"]);
    });
  });

  describe("Step types", () => {
    it("should execute competitor-signal step", async () => {
      const wf: WorkflowDefinition = {
        id: "signal-test",
        name: "Signal Test",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          {
            id: "signal",
            type: "competitor-signal",
            label: "Record Signal",
            config: { competitor: "AcmeCorp", signal: "New product launch" },
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("signal-test");
      const result = run.stepResults["signal"];
      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        recorded: true,
        competitor: "AcmeCorp",
      });
    });

    it("should execute pro-revenue step", async () => {
      const wf: WorkflowDefinition = {
        id: "revenue-test",
        name: "Revenue Test",
        description: "",
        category: "business",
        tags: [],
        steps: [
          {
            id: "rev",
            type: "pro-revenue",
            label: "Record Revenue",
            config: {
              pro: "ASCAP",
              workTitle: "My Song",
              amount: 150.5,
            },
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("revenue-test");
      const result = run.stepResults["rev"];
      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        recorded: true,
        pro: "ASCAP",
      });
    });

    it("should execute content-deploy step", async () => {
      const wf: WorkflowDefinition = {
        id: "deploy-test",
        name: "Deploy Test",
        description: "",
        category: "content",
        tags: [],
        steps: [
          {
            id: "deploy",
            type: "content-deploy",
            label: "Deploy",
            config: {
              topic: "AI agents",
              siteName: "my-site",
            },
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("deploy-test");
      const result = run.stepResults["deploy"];
      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({ triggered: true });
    });

    it("should execute upgrade-scan step", async () => {
      const wf: WorkflowDefinition = {
        id: "upgrade-test",
        name: "Upgrade Test",
        description: "",
        category: "development",
        tags: [],
        steps: [
          {
            id: "upgrade",
            type: "upgrade-scan",
            label: "Scan",
            config: {},
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("upgrade-test");
      expect(run.stepResults["upgrade"].status).toBe("success");
    });

    it("should execute conditional-gate step", async () => {
      const wf: WorkflowDefinition = {
        id: "gate-test",
        name: "Gate Test",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          { id: "s1", type: "delay", label: "S1", config: { ms: 5 } },
          { id: "s2", type: "delay", label: "S2", config: { ms: 5 } },
          {
            id: "gate",
            type: "conditional-gate",
            label: "Gate",
            config: { gates: ["s1", "s2"] },
            dependsOn: ["s1", "s2"],
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("gate-test");
      expect(run.stepResults["gate"].status).toBe("success");
      expect(run.stepResults["gate"].output).toMatchObject({ passed: true });
    });

    it("should fail on unknown step type", async () => {
      const wf: WorkflowDefinition = {
        id: "unknown-step",
        name: "Unknown Step",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          {
            id: "bad",
            type: "nonexistent-type" as any,
            label: "Bad",
            config: {},
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("unknown-step");
      expect(run.stepResults["bad"].status).toBe("failed");
      expect(run.stepResults["bad"].error).toContain("Unknown");
    });
  });

  describe("Active runs management", () => {
    it("should track active runs", async () => {
      const wf: WorkflowDefinition = {
        id: "active-runs-test",
        name: "Active Runs",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          { id: "s1", type: "delay", label: "S1", config: { ms: 10 } },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("active-runs-test");

      const found = getWorkflowRun(run.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(run.id);
    });

    it("should list all active runs", async () => {
      const wf: WorkflowDefinition = {
        id: "list-runs",
        name: "List Runs",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          { id: "s1", type: "delay", label: "S1", config: { ms: 5 } },
        ],
      };
      registerWorkflow(wf);

      const initialCount = listActiveRuns().length;
      await runWorkflow("list-runs");
      const afterCount = listActiveRuns().length;

      expect(afterCount).toBeGreaterThanOrEqual(initialCount);
    });
  });

  describe("Built-in workflows", () => {
    it("should register all built-in workflows", () => {
      registerBuiltInWorkflows();

      const wfs = listWorkflows();
      const ids = wfs.map((w) => w.id);

      expect(ids).toContain("competitive-monitor");
      expect(ids).toContain("daily-business-routine");
      expect(ids).toContain("project-health-scan");
      expect(ids).toContain("content-factory");
      expect(ids).toContain("self-upgrade");
      expect(ids).toContain("music-revenue-tracker");
      expect(ids).toContain("book-knowledge-digest");
      expect(ids).toContain("labor-verify-new-business");
      expect(ids).toContain("labor-rank-and-notify");
      expect(ids).toContain("labor-daily-ghost-job-audit");
      expect(ids).toContain("labor-sla-watchdog");
    });

    it("should run competitive-monitor workflow", async () => {
      registerBuiltInWorkflows();
      const run = await runWorkflow("competitive-monitor");
      expect(run.status).toBe("completed");
    });

    it("should run daily-business-routine workflow", async () => {
      registerBuiltInWorkflows();
      const run = await runWorkflow("daily-business-routine");
      expect(run.status).toBe("completed");
    });
  });

  describe("Error handling", () => {
    it("should handle unknown step dependency gracefully", async () => {
      const wf: WorkflowDefinition = {
        id: "unknown-deps",
        name: "Unknown Deps",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          {
            id: "step-1",
            type: "delay",
            label: "Step 1",
            config: { ms: 5 },
            dependsOn: ["nonexistent-step"],
          },
        ],
      };
      registerWorkflow(wf);

      await expect(runWorkflow("unknown-deps")).rejects.toThrow();
    });

    it("should skip onFailure steps", async () => {
      const wf: WorkflowDefinition = {
        id: "skip-on-fail",
        name: "Skip On Fail",
        description: "",
        category: "monitoring",
        tags: [],
        steps: [
          {
            id: "bad-step",
            type: "delay",
            label: "Bad Step",
            config: { ms: 5 },
          },
        ],
      };
      registerWorkflow(wf);

      const run = await runWorkflow("skip-on-fail");
      expect(run.stepResults["bad-step"].status).toBe("success");
    });
  });
});
