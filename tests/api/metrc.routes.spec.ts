/**
 * tests/api/metrc.routes.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * API tests for the Metrc routes.
 *
 * In CI (no Metrc credentials), all live-path routes return 503 or
 * firestore-cache responses. Tests assert correct status codes and
 * response shapes in both configured and unconfigured states.
 *
 * Cases covered:
 *  1. GET /api/metrc/status — returns source classification
 *  2. GET /api/metrc/status — returns 401 without auth
 *  3. GET /api/metrc/packages — returns packages array (cached path in CI)
 *  4. GET /api/metrc/packages — returns 401 without auth
 *  5. POST /api/metrc/sync — returns 403 for Operator role
 *  6. POST /api/metrc/sync — returns 503 when Metrc not configured (CI)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, expect } from "@playwright/test";
import { tokens } from "../fixtures/tokens";

const BASE = "http://localhost:3000";

test.describe("GET /api/metrc/status", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.get(`${BASE}/api/metrc/status`);
    expect(res.status()).toBe(401);
  });

  test("returns source classification for authenticated user", async ({ request }) => {
    const res = await request.get(`${BASE}/api/metrc/status`, {
      headers: { Authorization: tokens.labAdmin() },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("live");
    expect(body).toHaveProperty("source");
    expect(["metrc-api-live", "firestore-cache"]).toContain(body.source);
    expect(body).toHaveProperty("message");
  });
});

test.describe("GET /api/metrc/packages", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.get(`${BASE}/api/metrc/packages`);
    expect(res.status()).toBe(401);
  });

  test("returns packages array with source label", async ({ request }) => {
    const res = await request.get(`${BASE}/api/metrc/packages`, {
      headers: { Authorization: tokens.labAdmin() },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("source");
    expect(["metrc-api-live", "firestore-cache"]).toContain(body.source);
    expect(body).toHaveProperty("count");
    expect(Array.isArray(body.packages)).toBe(true);
  });
});

test.describe("POST /api/metrc/sync", () => {
  test("returns 401 without auth token", async ({ request }) => {
    const res = await request.post(`${BASE}/api/metrc/sync`);
    expect(res.status()).toBe(401);
  });

  test("returns 403 for Operator role (insufficient privileges)", async ({ request }) => {
    const res = await request.post(`${BASE}/api/metrc/sync`, {
      headers: { Authorization: tokens.operator() },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Forbidden");
  });

  test("returns 503 when Metrc API credentials are not configured (CI)", async ({ request }) => {
    // In CI, METRC_API_KEY is not set — sync must return 503 not 500
    const res = await request.post(`${BASE}/api/metrc/sync`, {
      headers: { Authorization: tokens.labAdmin() },
    });
    // Either 503 (not configured) or 200 (live credentials set) — both valid
    expect([200, 503]).toContain(res.status());
    if (res.status() === 503) {
      const body = await res.json();
      expect(body.error).toBe("Service Unavailable");
      expect(body.details).toContain("METRC_API_KEY");
    }
  });

  test("Quality Auditor can trigger sync when Metrc is configured", async ({ request }) => {
    const res = await request.post(`${BASE}/api/metrc/sync`, {
      headers: { Authorization: tokens.qualityAuditor() },
    });
    // 200 = live sync succeeded, 503 = not configured in this env
    expect([200, 503]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(typeof body.synced).toBe("number");
    }
  });
});
