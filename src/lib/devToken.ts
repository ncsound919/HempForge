/**
 * src/lib/devToken.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure parser for the dev-only authentication tokens used by the local API
 * and the test suite. Extracted from backendServices so it can be unit-tested
 * without spinning up Express, and so its contract is documented in one place.
 *
 * Contract — caller MUST strip the "Bearer " prefix BEFORE calling this
 * function. The dev path is short-circuited in production by checking
 * `IS_PRODUCTION` at the call site; this function does not check NODE_ENV.
 *
 * Token format (after Bearer strip):
 *   dev-<uid>:<email>:<tenantId>:<role>
 *
 * Constraints:
 *  - uid, email, tenantId, role MUST NOT contain ":" — email should use
 *    dot/hyphen form, role may contain spaces (e.g. "Lab Admin").
 *  - The token MUST begin with "dev-" (enforced here as a defensive check
 *    even though the call site checks it too).
 *  - Exactly 4 colon-separated parts are required.
 *
 * Returns null on any deviation. The middleware translates null into a
 * 401 response.
 */
export interface ParsedDevToken {
  uid: string;
  email: string;
  tenantId: string;
  role: string;
}

export function parseDevToken(token: string): ParsedDevToken | null {
  if (!token || typeof token !== "string") return null;
  if (!token.startsWith("dev-")) return null;

  const parts = token.slice(4).split(":");
  if (parts.length !== 4) return null;

  const [uid, email, tenantId, role] = parts;
  if (!uid || !email || !tenantId || !role) return null;

  return { uid, email, tenantId, role };
}
