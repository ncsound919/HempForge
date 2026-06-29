/**
 * routes/health.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Public health endpoint + security policy endpoint. No auth required on
 * /api/health — it's used by uptime probes. /policy requires auth.
 *
 * The route is a factory that accepts middleware so server.ts can wire
 * authMiddleware without circular imports.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { adminDb, isValidGeminiKey } from "../services/backendServices";
import { ollamaHealthCheck } from "../lib/ollamaInference";
import { exportPermissionsManifest } from "../lib/permissionsEngine";

export function healthRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // ─── GET /api/health ───────────────────────────────────────────────────────
  router.get("/", async (_req, res) => {
    const geminiConfigured = isValidGeminiKey(process.env.GEMINI_API_KEY?.trim());
    const firestoreAvailable = adminDb !== null;
    const coaSigningConfigured =
      !!process.env.COA_SIGNING_SECRET && process.env.COA_SIGNING_SECRET.length >= 32;

    let ollamaAvailable = false;
    try {
      const ollamaStatus = await ollamaHealthCheck();
      ollamaAvailable = ollamaStatus.available;
    } catch {
      /* ignore */
    }

    const degradedServices: string[] = [];
    if (!geminiConfigured) degradedServices.push("gemini-ai (chat, paper generation, COA parsing will use heuristic fallback)");
    if (!firestoreAvailable) degradedServices.push("firestore (using local fallback DB — data is NOT persistent)");
    if (!coaSigningConfigured) degradedServices.push("coa-signing (COA cryptographic signatures unavailable)");
    if (!ollamaAvailable) degradedServices.push("ollama (local AI inference unavailable)");

    const status = degradedServices.length === 0 ? "healthy" : "degraded";

    res.json({
      status,
      timestamp: new Date().toISOString(),
      services: {
        gemini: { available: geminiConfigured, classification: geminiConfigured ? "live-ai-inference" : "heuristic-fallback" },
        ollama: { available: ollamaAvailable, classification: ollamaAvailable ? "live-ai-inference" : "unavailable" },
        firestore: { available: firestoreAvailable, classification: firestoreAvailable ? "production-real" : "demo-only" },
        coaSigning: { available: coaSigningConfigured, classification: coaSigningConfigured ? "production-real" : "unavailable" },
      },
      degradedServices,
      disclaimer: degradedServices.length > 0
        ? "Some services are unavailable. Outputs from degraded services will be clearly labeled as simulated/heuristic and MUST NOT be used for compliance decisions."
        : "All services operational. Outputs are live and verified.",
    });
  });

  // ─── GET /api/security/policy ──────────────────────────────────────────────
  router.get("/policy", deps.authMiddleware, (req, res) => {
    const geminiConfigured = isValidGeminiKey(process.env.GEMINI_API_KEY?.trim());
    const firestoreAvailable = adminDb !== null;

    res.json({
      _outputClassification: "production-real",
      _disclaimer:
        "This policy document describes the current security posture. Items marked 'IMPLEMENTED' are active; items marked 'PLANNED' are design targets not yet verified.",
      governanceModel: {
        framework: "GxP / SOC-2 Framework Compliance Plan",
        status: "PARTIAL — Controls are implemented but formal SOC 2 Type II audit has not been completed.",
      },
      implementedControls: {
        authentication: "Firebase Auth with JWT token verification (IMPLEMENTED)",
        authorization: "Role-based access control with tenant isolation (IMPLEMENTED)",
        auditLogging: "ALCOA+ compliant hash-signed audit entries (IMPLEMENTED)",
        inputValidation: "express-validator on critical endpoints (IMPLEMENTED)",
        rateLimiting: "Per-user rate limiting on AI endpoints (IMPLEMENTED)",
        tenantIsolation: "Tenant-scoped data access on all CRUD operations (IMPLEMENTED)",
        coaSigning: process.env.COA_SIGNING_SECRET
          ? "HMAC-SHA256 cryptographic COA signatures (IMPLEMENTED)"
          : "COA signing configured but secret not set (DEGRADED)",
      },
      infrastructureControls: {
        encryptionAtRest: "AES-256 via GCP Cloud Storage and Firestore (GCP-MANAGED)",
        encryptionInTransit: "TLS 1.3 / HTTPS (INFRASTRUCTURE-LEVEL)",
        dataResidence: "US region (GCP default)",
      },
      plannedControls: {
        mfa: "Multi-factor authentication (PLANNED — not yet enforced)",
        keyRotation: "Automated secret rotation (PLANNED)",
        penetrationTesting: "Annual third-party pen test (PLANNED)",
        socAudit: "SOC 2 Type II engagement (PLANNED)",
        disasterRecovery: "Formal DR testing (PLANNED — RTO target 2h, RPO target 15m)",
      },
      privacyPosture: {
        dataTypes: ["User Profile metadata", "COA analytical outputs", "Instrument calibration metrics", "Metrc package tracking indices"],
        retentionPolicy: "PLANNED — formal retention schedule not yet implemented",
        deletionWorkflow: "PLANNED — manual deletion available, automated workflow pending",
        dataMinimization: "Principle applied but formal classification not completed",
      },
      currentServiceStatus: {
        firestore: firestoreAvailable ? "ACTIVE" : "FALLBACK (local-db)",
        aiInference: geminiConfigured ? "ACTIVE (Gemini)" : "DEGRADED (heuristic fallback)",
      },
    });
  });

  // ─── GET /api/security/permissions-manifest ────────────────────────────────
  router.get("/permissions-manifest", deps.authMiddleware, (req, res) => {
    const role = req.authContext?.userRole;
    if (role !== "System Admin" && role !== "Admin" && role !== "Quality Auditor") {
      return res.status(403).json({
        error: "Forbidden: Elevated role required to view permissions manifest.",
      });
    }
    res.json({
      _outputClassification: "production-real",
      manifest: exportPermissionsManifest(),
      generatedAt: new Date().toISOString(),
    });
  });

  return router;
}