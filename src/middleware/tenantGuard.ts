/**
 * tenantGuard.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforces that any tenantId appearing in the request body matches the
 * caller's authenticated tenantId. Prevents a Lab A user from spoofing a
 * Lab B tenantId in a write payload.
 *
 * Phase 0 already requires tenantId to come from the verified token claim.
 * This is a second line of defense for endpoints that echo the tenant back
 * in the request body (e.g. onboarding flows).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Request, Response, NextFunction } from "express";

export function requireTenantMatch(req: Request, res: Response, next: NextFunction): void {
  const callerTenant = req.authContext?.tenantId;
  if (!callerTenant) {
    res.status(401).json({ error: "Unauthorized: missing tenant context" });
    return;
  }

  const bodyTenant =
    typeof req.body === "object" && req.body !== null && "tenantId" in req.body
      ? (req.body as { tenantId?: unknown }).tenantId
      : undefined;

  if (bodyTenant !== undefined && bodyTenant !== callerTenant) {
    res.status(403).json({
      error: "Forbidden: tenantId in body does not match authenticated tenant",
    });
    return;
  }

  next();
}