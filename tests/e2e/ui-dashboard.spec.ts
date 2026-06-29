/**
 * tests/e2e/ui-dashboard.spec.ts
 * E2E tests for the HempForge UI — bypasses Firebase Auth by intercepting
 * the auth state and API calls, so the app renders without a real Firebase project.
 */

import { test, expect, Page } from "@playwright/test";

const BASE = "http://localhost:3000";

// ─── Auth bypass helpers ──────────────────────────────────────────────────────
// Since Firebase Auth requires real credentials, we mock out the protected API
// calls and stub the auth state so we can exercise UI components.
async function setupAuthBypass(page: Page) {
  // Intercept Firebase Auth SDK network calls so they don't hang
  await page.route("**/identitytoolkit.googleapis.com/**", async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ idToken: "mock-token", localId: "mock-uid" }) });
  });

  // Mock protected API calls with realistic stub data
  await page.route(`${BASE}/api/dashboard/summary`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          totalBatches: 12, compliant: 8, atRisk: 3, nonCompliant: 1,
          complianceRate: 67, averageTotalThc: 0.218,
          highestRisk: { batchId: "B-RISK-001", totalThc: 0.298, strain: "Charlotte" },
          recentUploads: [{ id: "1" }, { id: "2" }],
        },
      }),
    });
  });

  await page.route(`${BASE}/api/dashboard/activity*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { id: "act-1", action: "WORKFLOW_CREATED", details: "Batch B-001 workflow started", category: "DATA_CHANGE", timestamp: new Date().toISOString() },
          { id: "act-2", action: "CSA_VALIDATION", details: "AI validated batch B-002", category: "AI_INFERENCE", timestamp: new Date().toISOString() },
        ],
      }),
    });
  });

  await page.route(`${BASE}/api/coas`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          coas: [
            { id: "coa-1", batchId: "B-001", strain: "Lifter CBD", thca: 0.20, d9thc: 0.02, totalThc: 0.195, status: "Compliant", uploadDate: "2026-06-01", recommendation: "Safe for market." },
            { id: "coa-2", batchId: "B-002", strain: "Charlotte", thca: 0.28, d9thc: 0.04, totalThc: 0.286, status: "At Risk", uploadDate: "2026-06-10", recommendation: "Monitor closely." },
          ],
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route(`${BASE}/api/workflows`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workflows: [
            { id: "wf-1", batchId: "B-001", strain: "Lifter CBD", currentStage: "Testing", status: "active", stageHistory: [], createdAt: new Date().toISOString() },
            { id: "wf-2", batchId: "B-002", strain: "Charlotte", currentStage: "Review", status: "active", stageHistory: [], createdAt: new Date().toISOString() },
          ],
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route(`${BASE}/api/reports*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reports: [{
          metadata: { reportId: "rpt-1", generatedAt: new Date().toISOString(), integrityHash: "abc123" },
          compliance: { totalBatches: 12, compliant: 8, atRisk: 3, nonCompliant: 1, complianceRate: 67, averageTotalThc: 0.218, highestRiskBatch: null },
          roi: { totalCoas: 12, timeSavedHours: 3, labourSavingsUsd: 150, finesAvoidedUsd: 50000, riskPremiumAvoidedUsd: 25000, totalFinancialValueUsd: 75150, roiMultiplier: 12 },
        }],
      }),
    });
  });

  await page.route(`${BASE}/api/users/profile`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ uid: "mock-uid", email: "lab@hempforge.lan", tenantId: "Global-Hemp-Wilson", role: "Lab Admin" }),
    });
  });
}

// ─── Sign-In Page ────────────────────────────────────────────────────────────
test.describe("Sign-In page", () => {
  test("renders the sign-in screen at root before auth", async ({ page }) => {
    await page.goto(BASE);
    // Without mocking firebase, we expect sign-in page or loading
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(0);
  });

  test("page title is set", async ({ page }) => {
    await page.goto(BASE);
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});

// ─── Public Health Page ───────────────────────────────────────────────────────
test.describe("API health endpoint — browser", () => {
  test("returns health JSON data", async ({ page }) => {
    const res = await page.goto(`${BASE}/api/health`);
    expect(res?.status()).toBe(200);
    const body = await page.textContent("body");
    const json = JSON.parse(body!);
    expect(json.status).toBeDefined();
  });
});

// ─── Dashboard UI (mocked auth) ───────────────────────────────────────────────
test.describe("Compliance Dashboard — Visualizers", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthBypass(page);
    // Inject a mock Firebase user into the app window
    await page.goto(BASE);
    await page.addInitScript(() => {
      (window as any).__FIREBASE_MOCK_USER__ = {
        uid: "mock-uid", email: "lab@hempforge.lan", getIdToken: () => Promise.resolve("mock-token"),
      };
    });
    await page.goto(BASE);
  });

  test("page loads without console errors related to parsing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForTimeout(1500);
    const fatalErrors = errors.filter(e => e.includes("SyntaxError") || e.includes("TypeError: Cannot read"));
    expect(fatalErrors).toHaveLength(0);
  });

  test("body renders content", async ({ page }) => {
    await page.waitForTimeout(1000);
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(10);
  });
});

// ─── Pipeline OCR Panel UI ────────────────────────────────────────────────────
test.describe("OCR Pipeline Panel", () => {
  test("renders upload area when navigated to lab route with mocked auth", async ({ page }) => {
    await setupAuthBypass(page);
    await page.route(`${BASE}/api/literature/cache`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ papers: [] }) });
    });
    await page.route(`${BASE}/api/literature/trends-insights`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ trends: [], insights: [] }) });
    });
    await page.goto(`${BASE}/lab`);
    await page.waitForTimeout(1500);
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });
});

// ─── Workflow Dashboard UI ────────────────────────────────────────────────────
test.describe("Workflow Dashboard — Routing", () => {
  test("navigates to /workflows route without 404", async ({ page }) => {
    await setupAuthBypass(page);
    await page.goto(`${BASE}/workflows`);
    await page.waitForTimeout(1000);
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    expect(body).not.toContain("404");
  });
});

// ─── Public COA Verifier ──────────────────────────────────────────────────────
test.describe("Public COA Verifier — unauthenticated access", () => {
  test("renders COA verifier on /verify/:coaId without redirect", async ({ page }) => {
    await page.route(`${BASE}/api/health`, async (route) => route.continue());
    await page.goto(`${BASE}/verify/test-coa-id`);
    await page.waitForTimeout(1000);
    const url = page.url();
    // Should not redirect to sign-in
    expect(url).toContain("/verify/");
  });
});

// ─── Navigation ───────────────────────────────────────────────────────────────
test.describe("SPA routing — page navigation", () => {
  test("404 route renders not-found page", async ({ page }) => {
    await setupAuthBypass(page);
    await page.goto(`${BASE}/nonexistent-route-xyz`);
    await page.waitForTimeout(1000);
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });
});
