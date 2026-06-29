/**
 * tests/fixtures/auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds dev-mode bearer tokens that the local API accepts without
 * provisioning a real Firebase Auth user. See Phase 0's authMiddleware
 * for the parsing contract.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type DevTokenParts = {
  uid: string;
  email: string;
  tenantId: string;
  role: string;
};

/**
 * Encodes a dev-mode bearer token. Format:
 *   dev-<uid>:<email>:<tenantId>:<role>
 * email and tenantId are percent-encoded so colons inside them don't
 * confuse the parser.
 */
export function devToken({ uid, email, tenantId, role }: DevTokenParts): string {
  return `dev-${uid}:${encodeURIComponent(email)}:${encodeURIComponent(tenantId)}:${encodeURIComponent(role)}`;
}

/** A baseline token for the demo tenant used by the rest of the test suite. */
export const DEMO_TENANT = "test-tenant-demo";
export const OTHER_TENANT = "test-tenant-other";

export const tokens = {
  demoLabAdmin: () => devToken({ uid: "u-demo", email: "demo@example.test", tenantId: DEMO_TENANT, role: "Lab Admin" }),
  demoAuditor: () => devToken({ uid: "u-demo-aud", email: "demo-aud@example.test", tenantId: DEMO_TENANT, role: "Quality Auditor" }),
  demoOperator: () => devToken({ uid: "u-demo-op", email: "demo-op@example.test", tenantId: DEMO_TENANT, role: "Operator" }),
  otherLabAdmin: () => devToken({ uid: "u-other", email: "other@example.test", tenantId: OTHER_TENANT, role: "Lab Admin" }),
  otherOperator: () => devToken({ uid: "u-other-op", email: "other-op@example.test", tenantId: OTHER_TENANT, role: "Operator" }),
};