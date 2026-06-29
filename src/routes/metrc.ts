/**
 * routes/metrc.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Metrc seed-to-sale track & trace.
 *
 * GET  /api/metrc/packages        — list packages (live Metrc if configured,
 *                                    Firestore cache otherwise)
 * POST /api/metrc/sync            — pull fresh data from Metrc API and
 *                                    write-through to Firestore
 * GET  /api/metrc/status          — declares whether live Metrc API is wired
 *
 * When METRC_API_KEY / METRC_BASE_URL / METRC_LICENSE_NUMBER are set, every
 * GET /packages call fetches live data and upserts it into Firestore.
 * When those vars are absent the route falls back to the Firestore cache and
 * clearly labels the response as cached (not simulated).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import {
  saveAuditLog,
  createAuditHash,
} from "../services/backendServices";
import {
  getMetrcPackages,
  saveMetrcPackage,
} from "../lib/firebaseService";
import type { AuditLog } from "../lib/firebaseService";
import {
  fetchMetrcPackages,
  fetchMetrcPackagesOnHold,
  fetchMetrcLabResults,
  normalizeMetrcPackage,
  isMetrcConfigured,
} from "../lib/metrcApiClient";
import { DEFAULT_TENANT } from "../config";

export function metrcRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/metrc/status ──────────────────────────────────────────────────
  // Returns the live/cached classification so the UI can display provenance.
  router.get("/status", deps.authMiddleware, (_req, res) => {
    res.json({
      live: isMetrcConfigured(),
      source: isMetrcConfigured() ? "metrc-api-live" : "firestore-cache",
      message: isMetrcConfigured()
        ? "Live Metrc API is configured. /packages returns real-time data."
        : "Metrc API credentials not set. /packages returns Firestore-cached data. " +
          "Set METRC_API_KEY, METRC_BASE_URL, METRC_LICENSE_NUMBER to enable live sync.",
    });
  });

  // ─── GET /api/metrc/packages ────────────────────────────────────────────────
  router.get("/packages", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    const tenantId = userContext?.tenantId || DEFAULT_TENANT;

    try {
      if (isMetrcConfigured()) {
        // Live path: fetch from Metrc API, write-through to Firestore cache
        const [active, onHold] = await Promise.all([
          fetchMetrcPackages(),
          fetchMetrcPackagesOnHold(),
        ]);
        const all = [...active, ...onHold];
        const normalized = all.map((p) => normalizeMetrcPackage(p, tenantId));

        // Write-through cache
        await Promise.allSettled(
          normalized.map((pkg) =>
            saveMetrcPackage(pkg as any, req.firebaseToken as string, tenantId)
          )
        );

        return res.json({
          source: "metrc-api-live",
          count: normalized.length,
          packages: normalized,
          syncedAt: new Date().toISOString(),
        });
      }

      // Cached path — honest label
      const cached = await getMetrcPackages(
        req.firebaseToken as string,
        tenantId
      );
      return res.json({
        source: "firestore-cache",
        count: cached.length,
        packages: cached,
        note: "Set METRC_API_KEY, METRC_BASE_URL, METRC_LICENSE_NUMBER for live data.",
      });
    } catch (err: any) {
      console.error("Error fetching Metrc packages:", err);
      res.status(500).json({ error: "Failed to fetch Metrc packages", details: err.message });
    }
  });

  // ─── POST /api/metrc/sync ──────────────────────────────────────────────────
  // Force a full pull from Metrc API and upsert into Firestore.
  router.post("/sync", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    if (
      userContext?.userRole !== "Quality Auditor" &&
      userContext?.userRole !== "Lab Admin"
    ) {
      return res.status(403).json({
        error: "Forbidden: Elevated role ('Quality Auditor' or 'Lab Admin') required for Metrc sync.",
      });
    }

    const tenantId = userContext?.tenantId || DEFAULT_TENANT;

    if (!isMetrcConfigured()) {
      return res.status(503).json({
        error: "Service Unavailable",
        details:
          "Metrc API credentials are not configured. " +
          "Set METRC_API_KEY, METRC_BASE_URL, and METRC_LICENSE_NUMBER to enable live sync.",
      });
    }

    try {
      const [active, onHold] = await Promise.all([
        fetchMetrcPackages(),
        fetchMetrcPackagesOnHold(),
      ]);
      const all = [...active, ...onHold];
      const normalized = all.map((p) => normalizeMetrcPackage(p, tenantId));

      await Promise.allSettled(
        normalized.map((pkg) =>
          saveMetrcPackage(pkg as any, req.firebaseToken as string, tenantId)
        )
      );

      const details =
        `Metrc full sync completed. Pulled ${normalized.length} packages ` +
        `(${active.length} active, ${onHold.length} on-hold) from live Metrc API.`;

      const logEntry: Omit<AuditLog, "hash"> = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: userContext?.userId || "unknown-user",
        userRole: userContext?.userRole || "Operator",
        tenantId,
        action: "METRC_FULL_SYNC",
        details,
        category: "SYSTEM_INTEGRATION",
      };
      const hashed: AuditLog = { ...logEntry, hash: createAuditHash(logEntry) };
      await saveAuditLog(hashed, req.firebaseToken as string);

      res.json({
        success: true,
        synced: normalized.length,
        active: active.length,
        onHold: onHold.length,
        syncedAt: new Date().toISOString(),
        auditLog: hashed,
      });
    } catch (err: any) {
      console.error("Metrc sync error:", err);
      res.status(500).json({ error: "Metrc sync failed", details: err.message });
    }
  });

  // ─── GET /api/metrc/labresults/:packageLabel ────────────────────────────────
  router.get("/labresults/:packageLabel", deps.authMiddleware, async (req, res) => {
    const userContext = req.authContext;
    if (
      userContext?.userRole !== "Quality Auditor" &&
      userContext?.userRole !== "Lab Admin"
    ) {
      return res.status(403).json({
        error: "Forbidden: Lab Admin or Quality Auditor required to fetch lab results.",
      });
    }

    if (!isMetrcConfigured()) {
      return res.status(503).json({
        error: "Service Unavailable",
        details: "Metrc API credentials not configured.",
      });
    }

    try {
      const { packageLabel } = req.params;
      const results = await fetchMetrcLabResults(packageLabel);
      res.json({
        source: "metrc-api-live",
        packageLabel,
        count: results.length,
        results,
      });
    } catch (err: any) {
      console.error("Metrc lab results error:", err);
      res.status(500).json({ error: "Failed to fetch lab results", details: err.message });
    }
  });

  return router;
}
