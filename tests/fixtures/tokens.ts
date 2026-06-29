/**
 * tests/fixtures/tokens.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates well-formed dev tokens for API test suites.
 *
 * Format expected by parseDevToken() in backendServices.ts:
 *   Bearer dev-<uid>:<email>:<tenantId>:<role>
 *
 * Rules:
 *  - NO encodeURIComponent — parser uses raw split(":")
 *  - ALWAYS includes "Bearer " prefix — authMiddleware strips it
 *  - Email must not contain ":" — use dots/hyphens only
 */

export const TEST_TENANT = "Global-Hemp-Wilson";
export const TEST_EMAIL = "test@hempforge.lan";
export const TEST_UID = "test-user-001";

export type TestRole = "Lab Admin" | "Quality Auditor" | "Operator";

/**
 * Returns a complete Authorization header value including "Bearer " prefix.
 * Paste directly into supertest .set("Authorization", tokens.labAdmin())
 */
function make(uid: string, email: string, tenantId: string, role: TestRole): string {
  // Role may contain spaces — that is fine, split(":") targets colons only
  return `Bearer dev-${uid}:${email}:${tenantId}:${role}`;
}

export const tokens = {
  labAdmin: (tenantId = TEST_TENANT) =>
    make(TEST_UID, TEST_EMAIL, tenantId, "Lab Admin"),

  qualityAuditor: (tenantId = TEST_TENANT) =>
    make(TEST_UID, TEST_EMAIL, tenantId, "Quality Auditor"),

  operator: (tenantId = TEST_TENANT) =>
    make(TEST_UID, TEST_EMAIL, tenantId, "Operator"),

  /** Cross-tenant token for isolation tests */
  otherTenant: (role: TestRole = "Lab Admin") =>
    make("other-user-002", "other@hempforge.lan", "Other-Tenant-XYZ", role),

  /** Bare malformed token — should always return 401 */
  malformed: () => "Bearer not-a-valid-token",

  /** Missing Bearer prefix — should always return 401 */
  noBearerPrefix: () => `dev-${TEST_UID}:${TEST_EMAIL}:${TEST_TENANT}:Lab Admin`,
};

/** Drop-in default headers for supertest/fetch test calls */
export const authHeaders = (role: TestRole = "Lab Admin", tenantId = TEST_TENANT) => ({
  Authorization: make(TEST_UID, TEST_EMAIL, tenantId, role),
  "Content-Type": "application/json",
});
