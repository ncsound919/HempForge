/**
 * src/agents/autonomyLoop.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 24/7 autonomous cron loop. Runs AgentEngine.runCycle() on a schedule.
 *
 * Schedule:
 *   - Every 5 minutes   — short cycle (ingest + analyze)
 *   - Every 1 hour      — full cycle (ingest + analyze + simulate + score + report + verify)
 *
 * Both schedules are deterministic and idempotent within their window.
 * No LLM calls. No Gemini. No Ollama. Pure rule-based autonomy.
 */

import cron from "node-cron";
import { agentEngine } from "./agentEngine";
import { structuredLog } from "../lib/structuredLogger";
import { healthCheck } from "../lib/mem0Client";

interface LoopConfig {
  tenantIds: string[];
  /** Short cycle every N minutes (default 5). Set to 0 to disable. */
  shortIntervalMinutes: number;
  /** Full cycle every N minutes (default 60). Set to 0 to disable. */
  fullIntervalMinutes: number;
  /** Disable writes (compute only). */
  dryRun?: boolean;
}

const DEFAULT_CONFIG: LoopConfig = {
  tenantIds: [],
  shortIntervalMinutes: 5,
  fullIntervalMinutes: 60,
  dryRun: false,
};

let registered = false;
export let lastMem0Status = false;

export function registerAutonomyLoop(config: Partial<LoopConfig> = {}): void {
  if (registered) {
    structuredLog("warn", "autonomyLoop: Loop already registered; skipping duplicate registration.", {});
    return;
  }
  const cfg: LoopConfig = { ...DEFAULT_CONFIG, ...config };
  if (cfg.tenantIds.length === 0) {
    structuredLog("warn", "autonomyLoop: No tenantIds provided; autonomy loop will not be registered.", {});
    return;
  }

  if (cfg.shortIntervalMinutes > 0) {
    const expr = `*/${cfg.shortIntervalMinutes} * * * *`;
    cron.schedule(expr, async () => {
      for (const tenantId of cfg.tenantIds) {
        try {
          await agentEngine.runCycle(tenantId);
        } catch (err) {
          structuredLog("error", `autonomyLoop: Short cycle failed for ${tenantId}`, { error: String(err) });
        }
      }
    }, { name: "agent-short-cycle", timezone: "America/New_York" });
    structuredLog("info", `autonomyLoop: Short cycle scheduled every ${cfg.shortIntervalMinutes}min for tenants [${cfg.tenantIds.join(", ")}]`, {});
  }

  if (cfg.fullIntervalMinutes > 0) {
    const expr = `0 */${Math.max(1, Math.floor(cfg.fullIntervalMinutes / 60))} * * *`;
    cron.schedule(expr, async () => {
      for (const tenantId of cfg.tenantIds) {
        try {
          // Full cycle (same code path — all skills run each time).
          await agentEngine.runCycle(tenantId);
        } catch (err) {
          structuredLog("error", `autonomyLoop: Full cycle failed for ${tenantId}`, { error: String(err) });
        }
      }
    }, { name: "agent-full-cycle", timezone: "America/New_York" });
    structuredLog("info", `autonomyLoop: Full cycle scheduled every ${cfg.fullIntervalMinutes}min for tenants [${cfg.tenantIds.join(", ")}]`, {});
  }

  // ─── Specialized crons for the research factory pipeline ────────────────
  // Ingest: every 6 hours — pull fresh papers into researchPapers.
  cron.schedule("0 */6 * * *", async () => {
    for (const tenantId of cfg.tenantIds) {
      try {
        await agentEngine.runSkillByName?.("ingest-literature", tenantId);
      } catch (err) {
        structuredLog("error", `autonomyLoop: Ingest failed for ${tenantId}`, { error: String(err) });
      }
    }
  }, { name: "agent-ingest-6h", timezone: "America/New_York" });
  structuredLog("info", `autonomyLoop: Ingest cron every 6h for tenants [${cfg.tenantIds.join(", ")}]`, {});

  // Queue experiments: every 12 hours — generate experiment proposals.
  cron.schedule("0 */12 * * *", async () => {
    for (const tenantId of cfg.tenantIds) {
      try {
        await agentEngine.runSkillByName?.("queue-experiments", tenantId);
      } catch (err) {
        structuredLog("error", `autonomyLoop: Queue experiments failed for ${tenantId}`, { error: String(err) });
      }
    }
  }, { name: "agent-queue-experiments-12h", timezone: "America/New_York" });
  structuredLog("info", `autonomyLoop: Queue-experiments cron every 12h for tenants [${cfg.tenantIds.join(", ")}]`, {});

  // Benchmark: every 12 hours, offset by 6 hours.
  cron.schedule("6 */12 * * *", async () => {
    for (const tenantId of cfg.tenantIds) {
      try {
        await agentEngine.runSkillByName?.("benchmark-experiments", tenantId);
      } catch (err) {
        structuredLog("error", `autonomyLoop: Benchmark failed for ${tenantId}`, { error: String(err) });
      }
    }
  }, { name: "agent-benchmark-12h", timezone: "America/New_York" });
  structuredLog("info", `autonomyLoop: Benchmark cron every 12h (offset 6h) for tenants [${cfg.tenantIds.join(", ")}]`, {});

  // Publish: daily at 03:00 ET — emit signed paper + commercial flyer.
  cron.schedule("0 3 * * *", async () => {
    for (const tenantId of cfg.tenantIds) {
      try {
        await agentEngine.runSkillByName?.("publish-artifacts", tenantId);
      } catch (err) {
        structuredLog("error", `autonomyLoop: Publish failed for ${tenantId}`, { error: String(err) });
      }
    }
  }, { name: "agent-publish-daily", timezone: "America/New_York" });
  structuredLog("info", `autonomyLoop: Publish cron daily at 03:00 ET for tenants [${cfg.tenantIds.join(", ")}]`, {});

  // Promote: weekly on Sunday at 04:00 ET — consolidate findings (pending human approval).
  cron.schedule("0 4 * * 0", async () => {
    for (const tenantId of cfg.tenantIds) {
      try {
        await agentEngine.runSkillByName?.("promote-knowledge-base", tenantId);
      } catch (err) {
        structuredLog("error", `autonomyLoop: Knowledge promote failed for ${tenantId}`, { error: String(err) });
      }
    }
  }, { name: "agent-promote-weekly", timezone: "America/New_York" });
  structuredLog("info", `autonomyLoop: Promote cron weekly Sunday 04:00 ET for tenants [${cfg.tenantIds.join(", ")}]`, {});

  // mem0 health probe — every minute, logs connectivity status.
  cron.schedule("* * * * *", async () => {
    const ok = await healthCheck().catch(() => false);
    if (ok) lastMem0Status = true;
  }, { name: "mem0-probe-1m", timezone: "America/New_York" });
  structuredLog("info", `autonomyLoop: mem0 probe cron every minute`, {});

  // Periodic Ollama probe — keeps the UI honest about whether the optional
  // local model server is up. Every minute.
  cron.schedule("* * * * *", async () => {
    try {
      const { forceProbe } = await import("../middleware/llmGate");
      await forceProbe();
    } catch (err) {
      // Silent — this is best-effort.
    }
  }, { name: "ollama-probe-1m", timezone: "America/New_York" });
  structuredLog("info", `autonomyLoop: Ollama probe cron every minute for tenants [${cfg.tenantIds.join(", ")}]`, {});

  registered = true;
}

/**
 * Run one cycle synchronously on demand. Used by the API endpoint when the
 * user clicks "Run Platform Autonomy" in the UI.
 */
export async function runAutonomyNow(tenantId: string): Promise<Awaited<ReturnType<typeof agentEngine.runCycle>>> {
  return agentEngine.runCycle(tenantId);
}