/**
 * routes/auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Authenticated user profile endpoint. Proxies to ensureUserProfile which
 * (a) reads tenantId+role from verified claims (Phase 0) and (b) writes a
 * profile doc to Firestore so we have a denormalized user index.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { ensureUserProfile } from "../services/backendServices";

export function authRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  router.get("/profile", deps.authMiddleware, async (req, res) => {
    try {
      const claims = req.decodedClaims || {};
      const profile = await ensureUserProfile(claims);
      res.json({
        uid: profile.userId,
        email: profile.userEmail,
        role: profile.userRole,
        tenantId: profile.tenantId,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load/provision user profile" });
    }
  });

  return router;
}