/**
 * tests/api/coa.routes.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * End-to-end API tests for /api/coas. Exercises the dev-token auth path
 * (NODE_ENV is "test" in playwright.config.ts) and the local-DB fallback.
 *
 * Verifies:
 *  - POST /api/coas with valid body returns 201 and the saved COA
 *  - GET /api/coas returns the just-created COA in the tenant's list
 *  - GET /api/coas/:id returns the COA
 *  - GET /api/coas/:id returns 404 for a missing id
 *  - POST without batchId/strain returns 400
 *  - Unauthenticated requests return 401
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, expect } from "@playwright/test";
import { tokens } from "../fixtures/auth";
import { compliantCoa, atRiskCoa } from "../fixtures/coa";

const BASE = "http://localhost:3000";

test.describe("COA routes — happy path", () => {
  test("POST /api/coas creates a COA with valid body", async ({ request }) => {
    const coa = compliantCoa();
    const res = await request.post(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.demoLabAdmin() },
      data: coa,
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.batchId).toBe(coa.batchId);
    expect(body.strain).toBe(coa.strain);
    expect(body.tenantId).toBe("test-tenant-demo");
    expect(body.complianceSignature).toBeTruthy();
  });

  test("GET /api/coas returns the just-created COA", async ({ request }) => {
    const coa = atRiskCoa();
    const created = await request.post(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.demoLabAdmin() },
      data: coa,
    });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();

    const list = await request.get(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.demoLabAdmin() },
    });
    expect(list.status()).toBe(200);
    const items = await list.json();
    const found = items.find((c: any) => c.id === createdBody.id);
    expect(found).toBeTruthy();
    expect(found.batchId).toBe(coa.batchId);
  });

  test("GET /api/coas/:id returns the COA", async ({ request }) => {
    const coa = compliantCoa();
    const created = await request.post(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.demoLabAdmin() },
      data: coa,
    });
    const createdBody = await created.json();

    const got = await request.get(`${BASE}/api/coas/${createdBody.id}`, {
      headers: { Authorization: tokens.demoLabAdmin() },
    });
    expect(got.status()).toBe(200);
    const body = await got.json();
    expect(body.id).toBe(createdBody.id);
    expect(body.strain).toBe(coa.strain);
  });

  test("GET /api/coas/:id returns 404 for unknown id", async ({ request }) => {
    const res = await request.get(`${BASE}/api/coas/does-not-exist-xyz`, {
      headers: { Authorization: tokens.demoLabAdmin() },
    });
    expect(res.status()).toBe(404);
  });

  test("POST /api/coas returns 400 when batchId is missing", async ({ request }) => {
    const res = await request.post(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.demoLabAdmin() },
      data: { strain: "Only Strain" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/coas returns 401 without auth", async ({ request }) => {
    const res = await request.post(`${BASE}/api/coas`, {
      data: compliantCoa(),
    });
    expect(res.status()).toBe(401);
  });

  test("GET /api/coas returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE}/api/coas`);
    expect(res.status()).toBe(401);
  });
});