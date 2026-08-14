import { test, expect } from "@playwright/test";
import { tokens } from "../fixtures/tokens";

const BASE = "http://localhost:3000";

test.describe("System Test Suite", () => {
  
  test("POST /api/compliance/calculate - returns 200 with deterministic result", async ({ request }) => {
    const res = await request.post(`${BASE}/api/compliance/calculate`, {
      headers: { Authorization: tokens.labAdmin(), "Content-Type": "application/json" },
      data: { sampleId: "S-001", results: { thc: 0.1, cbd: 0.5 } }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("alerts");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("processingIntegrity");
  });

  test("POST /api/coas - returns 201 with valid payload", async ({ request }) => {
    const res = await request.post(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.labAdmin(), "Content-Type": "application/json" },
      data: { batchId: "B-TEST-001", strain: "Lifter CBD" }
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("complianceSignature");
  });

  test("GET /api/dashboard/summary - returns 200 with summary fields", async ({ request }) => {
    const res = await request.get(`${BASE}/api/dashboard/summary`, {
      headers: { Authorization: tokens.labAdmin() }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tenantId");
    expect(body).toHaveProperty("generatedAt");
    expect(body).toHaveProperty("summary");
    expect(body.summary).toHaveProperty("totalBatches");
  });

  test("POST /api/reports/generate - returns 200", async ({ request }) => {
    const res = await request.post(`${BASE}/api/reports/generate`, {
      headers: { Authorization: tokens.labAdmin(), "Content-Type": "application/json" },
      data: { reportType: "default" }
    });
    expect(res.status()).toBe(200);
  });

  test("POST /api/workflows/:id/transition - returns 200 for valid forward", async ({ request }) => {
    // First, create a workflow to get an ID
    const createRes = await request.post(`${BASE}/api/workflows`, {
        headers: { Authorization: tokens.labAdmin(), "Content-Type": "application/json" },
        data: { name: "Test Workflow" }
    });
    const workflow = await createRes.json();
    const workflowId = workflow.id;

    // Transition
    const res = await request.post(`${BASE}/api/workflows/${workflowId}/transition`, {
      headers: { Authorization: tokens.labAdmin(), "Content-Type": "application/json" },
      data: { toStage: "Testing" }
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/scheduler/jobs - returns 200", async ({ request }) => {
    const res = await request.get(`${BASE}/api/scheduler/jobs`, {
      headers: { Authorization: tokens.labAdmin() }
    });
    expect(res.status()).toBe(200);
  });

});
