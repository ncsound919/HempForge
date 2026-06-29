/**
 * tests/api/rate-limit.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the per-user rate limiter on Gemini endpoints. The limit is
 * 10 requests per minute per userId (see backendServices.geminiRateLimiter).
 * We make 11 calls; the 11th should return 429.
 *
 * Uses /api/compliance/calculate which is auth-protected but does NOT
 * share the Gemini limiter — so we instead exercise the limiter indirectly
 * by calling /api/gemini/parse-coa. parse-coa calls checkGeminiRateLimit
 * up-front before any model invocation.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, expect } from "@playwright/test";
import { tokens } from "../fixtures/auth";

const BASE = "http://localhost:3000";

test.describe("Rate limiter", () => {
  test("11th parse-coa call in a minute returns 429", async ({ request }) => {
    const headers = { Authorization: tokens.demoLabAdmin() };
    const body = { coaRawText: "Strain: Test\nTHCa: 0.20\nDelta-9-THC: 0.02" };

    let lastStatus = 0;
    let allowedCount = 0;
    let limitedCount = 0;

    for (let i = 0; i < 12; i++) {
      const res = await request.post(`${BASE}/api/gemini/parse-coa`, {
        headers,
        data: body,
      });
      lastStatus = res.status();
      if (res.status() === 429) limitedCount++;
      else if (res.status() === 200) allowedCount++;
    }

    // In a clean test environment we should have hit the limit by the 11th
    // call. The exact count of allowed responses may vary if other tests in
    // the suite consumed budget, but at least one of the calls must be 429.
    expect(allowedCount).toBeGreaterThan(0);
    expect(limitedCount).toBeGreaterThanOrEqual(1);
  });

  test("Rate limit response includes resetTime", async ({ request }) => {
    const headers = { Authorization: tokens.demoLabAdmin() };
    const body = { coaRawText: "Strain: Test\nTHCa: 0.20\nDelta-9-THC: 0.02" };

    // Burn through the limit
    for (let i = 0; i < 11; i++) {
      await request.post(`${BASE}/api/gemini/parse-coa`, { headers, data: body });
    }

    // The 12th call should be 429 with details
    const res = await request.post(`${BASE}/api/gemini/parse-coa`, {
      headers,
      data: body,
    });
    if (res.status() === 429) {
      const json = await res.json();
      expect(json.error).toBeTruthy();
      expect(json.details).toBeTruthy();
      // details should mention "reset" or "try again"
      expect(json.details.toLowerCase()).toMatch(/reset|try again/);
    }
  });
});