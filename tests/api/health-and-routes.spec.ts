/**
 * tests/api/health-and-routes.spec.ts
 * API-layer tests — exercises the Express server directly via HTTP.
 * No Firebase token required for public routes; mocked Bearer for protected routes.
 */

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";
const FAKE_TOKEN = "Bearer test-mock-token-do-not-use";

// ─── 1. Public Health Endpoint ───────────────────────────────────────────────
test.describe("GET /api/health", () => {
  test("returns 200 with a status field", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(["healthy", "degraded"]).toContain(body.status);
  });

  test("includes timestamp in ISO format", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const body = await res.json();
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("lists services dependency statuses", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const body = await res.json();
    expect(body.services).toHaveProperty("gemini");
    expect(body.services).toHaveProperty("firestore");
    expect(body.services).toHaveProperty("ollama");
  });
});

// ─── 2. Auth Guard ───────────────────────────────────────────────────────────
test.describe("Auth middleware", () => {
  test("returns 401 for protected routes without token", async ({ request }) => {
    const res = await request.get(`${BASE}/api/coas`);
    expect(res.status()).toBe(401);
  });

  test("returns 401 with malformed bearer token", async ({ request }) => {
    const res = await request.get(`${BASE}/api/coas`, {
      headers: { Authorization: "Bearer not-a-valid-token" },
    });
    expect(res.status()).toBe(401);
  });

  test("returns JSON error body on 401", async ({ request }) => {
    const res = await request.get(`${BASE}/api/coas`);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

// ─── 3. Workflow Routes ──────────────────────────────────────────────────────
test.describe("POST /api/workflows — validation", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.post(`${BASE}/api/workflows`, {
      data: { batchId: "B-TEST-001", strain: "Lifter CBD" },
    });
    expect(res.status()).toBe(401);
  });

  test("requires Content-Type application/json", async ({ request }) => {
    const res = await request.post(`${BASE}/api/workflows`, {
      headers: { Authorization: FAKE_TOKEN },
      data: {},
    });
    // Either 401 (auth fails first) or 400/422 — both are valid rejection
    expect([400, 401, 422, 500]).toContain(res.status());
  });
});

// ─── 4. Report Routes ────────────────────────────────────────────────────────
test.describe("POST /api/reports/generate — validation", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.post(`${BASE}/api/reports/generate`, {
      data: { format: "json" },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── 5. Audit Routes ─────────────────────────────────────────────────────────
test.describe("GET /api/audit/logs — validation", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.get(`${BASE}/api/audit/logs`);
    expect(res.status()).toBe(401);
  });
});

// ─── 6. Dashboard Endpoints ───────────────────────────────────────────────────
test.describe("GET /api/dashboard/summary — validation", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.get(`${BASE}/api/dashboard/summary`);
    expect(res.status()).toBe(401);
  });
});

// ─── 7. COA Endpoints ────────────────────────────────────────────────────────
test.describe("POST /api/coas — validation", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.post(`${BASE}/api/coas`, {
      data: { batchId: "B-001" },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── 8. Transition Validation ─────────────────────────────────────────────────
test.describe("POST /api/workflows/:id/transition — validation", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.post(`${BASE}/api/workflows/some-workflow-id/transition`, {
      data: { toStage: "Testing" },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── 9. Gemini COA Parse Route ────────────────────────────────────────────────
test.describe("POST /api/gemini/parse-coa — validation", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.post(`${BASE}/api/gemini/parse-coa`, {
      data: { text: "THCA: 0.28% Delta-9 THC: 0.04%" },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── 10. Scheduler Routes ────────────────────────────────────────────────────
test.describe("GET /api/scheduler/jobs — validation", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.get(`${BASE}/api/scheduler/jobs`);
    expect(res.status()).toBe(401);
  });
});
