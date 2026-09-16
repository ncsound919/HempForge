import "dotenv/config";
import express from "express";
import "express-async-errors";
import path from "path";
import cors from "cors";

import { authMiddleware } from "./src/services/backendServices";
import { requestLogger } from "./src/middleware/requestLogger";
import { errorHandler, notFoundHandler } from "./src/middleware/errorHandler";
import { startLiteratureJobs } from "./src/jobs/literatureJobs";
import { startLocalFolderIndexer } from "./src/jobs/localFolderIndexer";
import { registerAutonomousJobs } from "./src/jobs/autonomousJobs";
import { registerAutonomyLoop } from "./src/agents/autonomyLoop";
import { DEFAULT_TENANT } from "./src/config";
import { configureMem0 } from "./src/lib/mem0Client";
import { loadKeywireSecrets } from "./src/lib/keywireClient";

import { healthRouter } from "./src/routes/health";
import { authRouter } from "./src/routes/auth";
import { billingRouter } from "./src/routes/billing";
import { coaRouter } from "./src/routes/coa";
import { verifyRouter } from "./src/routes/verify";
import { auditRouter } from "./src/routes/audit";
import { complianceRouter } from "./src/routes/compliance";
import { metrcRouter } from "./src/routes/metrc";
import { csaRouter } from "./src/routes/csa";
import { limsRouter } from "./src/routes/lims";
import { ollamaRouter } from "./src/routes/ollama";
import { agentsRouter } from "./src/routes/agents";
import { workflowsRouter } from "./src/routes/workflows";
import { reportsRouter } from "./src/routes/reports";
import { dashboardRouter } from "./src/routes/dashboard";
import { schedulerRouter } from "./src/routes/scheduler";
import { literatureRouter } from "./src/routes/literature";
import { debugRouter } from "./src/routes/debug";
import { autonomyRouter } from "./src/routes/autonomy";
import { assistantRouter } from "./src/routes/assistant";
import { notebookRouter } from "./src/routes/notebook";
import { mem0Router } from "./src/routes/mem0";
import { agentBrowsingRouter } from "./src/routes/agentBrowsing";
import { blackmindRouter } from "./src/routes/blackmind";
import { researchclawRouter } from "./src/routes/researchclaw";
import { geminiRouter } from "./src/routes/gemini";
import { researchLabRouter } from "./src/routes/researchLab";

const PORT = Number(process.env.PORT || 3000);

// Vercel serverless runs in a cold-start sandbox: no long-lived timers.
// Long-running crons / folder watchers stay on Docker. In serverless the
// Vercel Cron product (vercel.json crons) or external schedulers can drive
// the /api/* endpoints instead.
const IS_VERCEL = process.env.VERCEL === "1";
const RUN_BACKGROUND_JOBS = !IS_VERCEL;

export async function buildApp() {
  const app = express();

  // Capture raw body for Stripe webhook signature verification (before the
  // JSON parser rewrites req.body).
  app.use(
    express.json({
      limit: "2mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(",")
        : true,
      credentials: true,
    })
  );
  app.use(requestLogger);

  // Public endpoints (no auth)
  app.use("/api/health", healthRouter({ authMiddleware }));
  app.use("/api/coas", verifyRouter());

  // Authenticated endpoints
  app.use("/api/users", authRouter({ authMiddleware }));
  app.use("/api/billing", billingRouter({ authMiddleware }));
  app.use("/api/coas", coaRouter({ authMiddleware }));
  app.use("/api/audit", auditRouter({ authMiddleware }));
  app.use("/api/compliance", complianceRouter({ authMiddleware }));
  app.use("/api/metrc", metrcRouter({ authMiddleware }));
  app.use("/api/csa", csaRouter({ authMiddleware }));
  app.use("/api/lims", limsRouter({ authMiddleware }));
  app.use("/api/ollama", ollamaRouter({ authMiddleware }));
  app.use("/api/pipeline", agentsRouter({ authMiddleware }));
  app.use("/api/workflows", workflowsRouter({ authMiddleware }));
  app.use("/api/reports", reportsRouter({ authMiddleware }));
  app.use("/api/dashboard", dashboardRouter({ authMiddleware }));
  app.use("/api/scheduler", schedulerRouter({ authMiddleware }));
  app.use("/api/literature", literatureRouter({ authMiddleware }));
  app.use("/api/autonomy", autonomyRouter({ authMiddleware }));
  app.use("/api/assistant", assistantRouter({ authMiddleware }));
  app.use("/api/notebook", notebookRouter({ authMiddleware }));
  app.use("/api/mem0", mem0Router());
  app.use("/api/agents-browser", agentBrowsingRouter({ authMiddleware }));
  app.use("/api/blackmind", blackmindRouter({ authMiddleware }));
  app.use("/api/researchclaw", researchclawRouter());
  // Deprecated-but-preserved deterministic adapter the Swarm harness calls.
  app.use("/api/gemini", geminiRouter({ authMiddleware }));
  // Research Lab: /api/ocr/extract + /api/scene/generate.
  app.use("/api", researchLabRouter({ authMiddleware }));

  // Security policy endpoint reuses the health router
  app.use("/api/security", (req, res, next) => {
    if (req.path === "/policy" || req.path === "/permissions-manifest") {
      return healthRouter({ authMiddleware })(req, res, next);
    }
    next();
  });

  // Debug-only (404 in production)
  app.use("/api", debugRouter({ authMiddleware }));

  // Static / SPA — mounted BEFORE the 404 handler so dev Vite can serve the
  // SPA shell (index.html) for any unmatched non-/api route.
  // - production: always serve the built dist/ statically.
  // - development + SERVE_STATIC=true (e.g. demo containers): serve dist/
  //   too, but keep dev-token auth + local-DB fallback semantics.
  // - development (default): Vite dev middleware with HMR.
  const useStatic = process.env.NODE_ENV === "production" || process.env.SERVE_STATIC === "true";
  if (process.env.NODE_ENV !== "production" && !process.env.SERVE_STATIC && !IS_VERCEL) {
    // Lazy import: vite pulls rollup's platform-native binary, which must never
    // load in production/serverless (its optional dep is absent on Vercel).
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (useStatic) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 404 + error handler — last resort, after SPA serving.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// ─── Background jobs (cron) — Docker only ────────────────────────────────────
function startBackgroundJobs() {
  configureMem0({ apiUrl: process.env.MEM0_API_URL || "http://localhost:8888" });
  startLiteratureJobs();
  startLocalFolderIndexer({
    tenantId: DEFAULT_TENANT,
    folders: [
      path.resolve(process.cwd(), "local-research"),
      path.resolve(process.cwd(), "vault"),
    ],
    watch: true,
    enabled: true,
    autoPromoteToResearchPapers: true,
  });
  registerAutonomousJobs({
    tenantIds: [DEFAULT_TENANT],
    metrcBaseUrl: process.env.METRC_BASE_URL || "https://api.metrc.com",
    metrcApiKeys: DEFAULT_TENANT
      ? { [DEFAULT_TENANT]: process.env.METRC_API_KEY || "" }
      : {},
    dryRun: !process.env.METRC_API_KEY,
  });
  registerAutonomyLoop({
    tenantIds: [DEFAULT_TENANT],
    shortIntervalMinutes: Number(process.env.AUTONOMY_SHORT_CYCLE_MIN || 5),
    fullIntervalMinutes: Number(process.env.AUTONOMY_FULL_CYCLE_MIN || 60),
  });
}

// ─── Server bootstrap (Docker / local) ───────────────────────────────────────
async function startServer() {
  // Pull secrets from the Keywire vault FIRST so module-level reads of
  // STRIPE_*/COA_* env vars see the vault values. Honest degrade: when
  // Keywire is unconfigured/unreachable, .env values are used.
  await loadKeywireSecrets();

  const app = await buildApp();
  if (RUN_BACKGROUND_JOBS) startBackgroundJobs();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!IS_VERCEL) {
  startServer().catch((err) => {
    console.error("[server] Fatal startup error:", err);
    process.exit(1);
  });
}
