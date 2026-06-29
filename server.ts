import express from "express";
import "express-async-errors";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";

import { authMiddleware } from "./src/services/backendServices";
import { requestLogger } from "./src/middleware/requestLogger";
import { errorHandler, notFoundHandler } from "./src/middleware/errorHandler";
import { startLiteratureJobs } from "./src/jobs/literatureJobs";
import { startLocalFolderIndexer } from "./src/jobs/localFolderIndexer";
import { registerAutonomousJobs } from "./src/jobs/autonomousJobs";
import { DEFAULT_TENANT } from "./src/config";

import { healthRouter } from "./src/routes/health";
import { authRouter } from "./src/routes/auth";
import { coaRouter } from "./src/routes/coa";
import { verifyRouter } from "./src/routes/verify";
import { auditRouter } from "./src/routes/audit";
import { complianceRouter } from "./src/routes/compliance";
import { metrcRouter } from "./src/routes/metrc";
import { csaRouter } from "./src/routes/csa";
import { limsRouter } from "./src/routes/lims";
import { geminiRouter } from "./src/routes/gemini";
import { ollamaRouter } from "./src/routes/ollama";
import { agentsRouter } from "./src/routes/agents";
import { workflowsRouter } from "./src/routes/workflows";
import { reportsRouter } from "./src/routes/reports";
import { dashboardRouter } from "./src/routes/dashboard";
import { schedulerRouter } from "./src/routes/scheduler";
import { literatureRouter } from "./src/routes/literature";
import { debugRouter } from "./src/routes/debug";

const PORT = Number(process.env.PORT || 3000);

// ─── Background jobs (cron) ─────────────────────────────────────────────────
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

// Autonomous deterministic cron jobs — zero LLM dependency.
// Metrc sync (15 min), trend snapshots (1 hr), audit chain verify (1 hr),
// compliance sweep (6 hr), risk scoring (24 hr).
registerAutonomousJobs({
  tenantIds: [DEFAULT_TENANT],
  metrcBaseUrl: process.env.METRC_BASE_URL || "https://api.metrc.com",
  metrcApiKeys: DEFAULT_TENANT
    ? { [DEFAULT_TENANT]: process.env.METRC_API_KEY || "" }
    : {},
  dryRun: !process.env.METRC_API_KEY, // safe no-op when key is not configured
});

// ─── Server ─────────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();

  app.use(express.json({ limit: "2mb" }));
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
  app.use("/api/coas", coaRouter({ authMiddleware }));
  app.use("/api/audit", auditRouter({ authMiddleware }));
  app.use("/api/compliance", complianceRouter({ authMiddleware }));
  app.use("/api/metrc", metrcRouter({ authMiddleware }));
  app.use("/api/csa", csaRouter({ authMiddleware }));
  app.use("/api/lims", limsRouter({ authMiddleware }));
  app.use("/api/gemini", geminiRouter({ authMiddleware }));
  app.use("/api/ollama", ollamaRouter({ authMiddleware }));
  app.use("/api/pipeline", agentsRouter({ authMiddleware }));
  app.use("/api/workflows", workflowsRouter({ authMiddleware }));
  app.use("/api/reports", reportsRouter({ authMiddleware }));
  app.use("/api/dashboard", dashboardRouter({ authMiddleware }));
  app.use("/api/scheduler", schedulerRouter({ authMiddleware }));
  app.use("/api/literature", literatureRouter({ authMiddleware }));

  // Security policy endpoint reuses the health router
  app.use("/api/security", (req, res, next) => {
    if (req.path === "/policy" || req.path === "/permissions-manifest") {
      return healthRouter({ authMiddleware })(req, res, next);
    }
    next();
  });

  // Debug-only (404 in production)
  app.use("/api", debugRouter({ authMiddleware }));

  // 404 + error handler
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Static / SPA
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
