/**
 * tests/api/tenant-isolation.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that Lab A cannot read or write Lab B's data, even though both
 * share the same Firestore project and the same backend code path.
 *
 * The dev-token middleware lets us mint arbitrary tenantIds without
 * provisioning Firebase Auth users — this is what makes the test tractable.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, expect } from "@playwright/test";
import { tokens, TEST_TENANT } from "../fixtures/tokens";
import { compliantCoa } from "../fixtures/coa";

const BASE = "http://localhost:3000";
const OTHER_TENANT = "Other-Tenant-XYZ";

test.describe("Tenant isolation", () => {
  test("Tenant A can read its own COAs", async ({ request }) => {
    const coa = compliantCoa();
    const created = await request.post(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.labAdmin() },
      data: coa,
    });
    expect(created.status()).toBe(201);

    const list = await request.get(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.labAdmin() },
    });
    expect(list.status()).toBe(200);
    const items = await list.json();
    const found = items.find((c: any) => c.batchId === coa.batchId);
    expect(found).toBeTruthy();
  });

  test("Tenant B cannot see Tenant A's COAs via GET /api/coas", async ({ request }) => {
    const coa = compliantCoa();
    await request.post(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.labAdmin() },
      data: coa,
    });

    const list = await request.get(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.otherTenant() },
    });
    expect(list.status()).toBe(200);
    const items = await list.json();
    const leaked = items.find((c: any) => c.batchId === coa.batchId);
    expect(leaked).toBeUndefined();
  });

  test("Tenant B cannot fetch Tenant A's COA by id", async ({ request }) => {
    const coa = compliantCoa();
    const created = await request.post(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.labAdmin() },
      data: coa,
    });
    const createdBody = await created.json();

    const got = await request.get(`${BASE}/api/coas/${createdBody.id}`, {
      headers: { Authorization: tokens.otherTenant() },
    });
    // Tenant B gets 404 (tenant-scoped repo refuses to disclose existence)
    // or 200 with a result that doesn't include Tenant A's batchId.
    if (got.status() === 200) {
      const body = await got.json();
      expect(body.id).not.toBe(createdBody.id);
    } else {
      expect(got.status()).toBe(404);
    }
  });

  test("Dev token with a different tenantId cannot see primary tenant's dashboard", async ({ request }) => {
    const coa = compliantCoa();
    const created = await request.post(`${BASE}/api/coas`, {
      headers: { Authorization: tokens.labAdmin() },
      data: coa,
    });
    const createdBody = await created.json();

    const summary = await request.get(`${BASE}/api/dashboard/summary`, {
      headers: { Authorization: tokens.otherTenant() },
    });
    expect(summary.status()).toBe(200);
    const body = await summary.json();
    // Dashboard must be scoped to the other tenant, not the primary
    expect(body.tenantId).toBe(OTHER_TENANT);
    const leakedSummary = body.summary?.highestRisk;
    if (leakedSummary) {
      expect(leakedSummary.id).not.toBe(createdBody.id);
    }
  });
});
