/**
 * autonomousJobs.ts
 * Five deterministic cron jobs for fully autonomous background processing.
 * Zero LLM dependency. All jobs run on schedule without human trigger.
 *
 * Schedule:
 *   Every 15 min  — syncMetrcPackages
 *   Every 1 hour  — computeAllTrendSnapshots
 *   Every 1 hour  — verifyAllAuditChains
 *   Every 6 hours — sweepComplianceThresholds
 *   Every 24 hours — scoreAllRegulatoryRisk
 *
 * Requires: node-cron (npm i node-cron @types/node-cron)
 * Usage: import and call registerAutonomousJobs(scheduler) in your server bootstrap.
 */

import cron from 'node-cron';
import { TenantRepository } from './firebaseRepo';
import { normalizeMetrcPackage } from './metrcApiClient';
import { computeTrendSnapshot } from './trendEngine';
import { verifyAuditChain } from './auditEngine';
import { calculateCompliance } from './complianceEngine';
import { scoreRegulatoryRisk } from './trendEngine';
import { structuredLog } from './structuredLogger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerConfig {
  /** Firestore collection prefix for tenant data */
  tenantIds: string[];
  /** Metrc API base URL */
  metrcBaseUrl: string;
  /** Metrc API key per tenant */
  metrcApiKeys: Record<string, string>;
  /** Dry-run mode — compute but do not write to Firestore */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Job 1 — Metrc Package Sync (every 15 minutes)
// ---------------------------------------------------------------------------

async function syncMetrcPackages(config: SchedulerConfig): Promise<void> {
  for (const tenantId of config.tenantIds) {
    try {
      const apiKey = config.metrcApiKeys[tenantId];
      if (!apiKey) {
        structuredLog('warn', 'syncMetrcPackages', `No Metrc API key for tenant ${tenantId}`);
        continue;
      }

      // Fetch raw packages from Metrc
      const resp = await fetch(
        `${config.metrcBaseUrl}/packages/v2/active?licenseNumber=${tenantId}`,
        { headers: { Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}` } }
      );
      if (!resp.ok) throw new Error(`Metrc responded ${resp.status}`);

      const raw: unknown[] = await resp.json();
      const normalized = raw.map(normalizeMetrcPackage);

      if (!config.dryRun) {
        const repo = new TenantRepository('metrcPackages', tenantId);
        for (const pkg of normalized) {
          await repo.upsert(pkg.label, pkg);
        }
      }

      structuredLog('info', 'syncMetrcPackages', `Synced ${normalized.length} packages for ${tenantId}`);
    } catch (err) {
      structuredLog('error', 'syncMetrcPackages', `Failed for tenant ${tenantId}`, { error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Job 2 — Trend Snapshot (every hour)
// ---------------------------------------------------------------------------

async function computeAllTrendSnapshots(config: SchedulerConfig): Promise<void> {
  for (const tenantId of config.tenantIds) {
    try {
      const coaRepo = new TenantRepository<{ thca: number; d9thc: number; testDate: string }>('coas', tenantId);
      const coas = await coaRepo.list();

      const snapshot = computeTrendSnapshot(coas);

      if (!config.dryRun) {
        const snapshotRepo = new TenantRepository('trendSnapshots', tenantId);
        await snapshotRepo.upsert(`snapshot_${Date.now()}`, {
          ...snapshot,
          computedAt: new Date().toISOString(),
        });
      }

      structuredLog('info', 'computeAllTrendSnapshots', `Trend snapshot saved for ${tenantId}`);
    } catch (err) {
      structuredLog('error', 'computeAllTrendSnapshots', `Failed for tenant ${tenantId}`, { error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Job 3 — Audit Chain Integrity (every hour)
// ---------------------------------------------------------------------------

async function verifyAllAuditChains(config: SchedulerConfig): Promise<void> {
  for (const tenantId of config.tenantIds) {
    try {
      const auditRepo = new TenantRepository<{ id: string; hash: string; previousHash: string; timestamp: number }>('auditLogs', tenantId);
      const logs = await auditRepo.list();
      // Sort ascending by timestamp for correct chain verification
      logs.sort((a, b) => a.timestamp - b.timestamp);

      const result = verifyAuditChain(logs);

      if (!result.valid && !config.dryRun) {
        const alertRepo = new TenantRepository('auditAlerts', tenantId);
        await alertRepo.upsert(`break_${Date.now()}`, {
          detectedAt: new Date().toISOString(),
          brokenAt: result.brokenAt,
          severity: 'critical',
        });
        structuredLog('warn', 'verifyAllAuditChains', `Audit chain BROKEN for ${tenantId} at ${result.brokenAt}`);
      } else {
        structuredLog('info', 'verifyAllAuditChains', `Audit chain intact for ${tenantId} (${logs.length} entries)`);
      }
    } catch (err) {
      structuredLog('error', 'verifyAllAuditChains', `Failed for tenant ${tenantId}`, { error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Job 4 — Compliance Threshold Sweep (every 6 hours)
// ---------------------------------------------------------------------------

async function sweepComplianceThresholds(config: SchedulerConfig): Promise<void> {
  for (const tenantId of config.tenantIds) {
    try {
      const coaRepo = new TenantRepository<{ batchId: string; thca: number; d9thc: number; flagged?: boolean }>('coas', tenantId);
      const coas = await coaRepo.list();

      const crossed: Array<{ batchId: string; totalThc: number; status: string }> = [];

      for (const coa of coas) {
        const result = calculateCompliance(coa.thca, coa.d9thc);
        if (result.status !== 'compliant' && !coa.flagged) {
          crossed.push({ batchId: coa.batchId, totalThc: result.totalThc, status: result.status });
          if (!config.dryRun) {
            await coaRepo.upsert(coa.batchId, { ...coa, flagged: true });
          }
        }
      }

      if (crossed.length > 0 && !config.dryRun) {
        const alertRepo = new TenantRepository('complianceAlerts', tenantId);
        await alertRepo.upsert(`sweep_${Date.now()}`, {
          detectedAt: new Date().toISOString(),
          newlyFlagged: crossed,
        });
      }

      structuredLog('info', 'sweepComplianceThresholds',
        `Sweep complete for ${tenantId}: ${crossed.length} newly flagged, ${coas.length} total scanned`);
    } catch (err) {
      structuredLog('error', 'sweepComplianceThresholds', `Failed for tenant ${tenantId}`, { error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Job 5 — Regulatory Risk Scoring (every 24 hours)
// ---------------------------------------------------------------------------

async function scoreAllRegulatoryRisk(config: SchedulerConfig): Promise<void> {
  for (const tenantId of config.tenantIds) {
    try {
      const batchRepo = new TenantRepository<{ batchId: string; thca: number; d9thc: number; testDate: string }>('batches', tenantId);
      const batches = await batchRepo.list();

      const scores = batches.map((b) => {
        const risk = scoreRegulatoryRisk([b]);
        return { batchId: b.batchId, riskScore: risk.score, riskLevel: risk.level };
      });

      if (!config.dryRun) {
        const riskRepo = new TenantRepository('riskScores', tenantId);
        await riskRepo.upsert(`risk_${Date.now()}`, {
          scoredAt: new Date().toISOString(),
          scores,
        });
      }

      structuredLog('info', 'scoreAllRegulatoryRisk',
        `Risk scoring complete for ${tenantId}: ${batches.length} batches scored`);
    } catch (err) {
      structuredLog('error', 'scoreAllRegulatoryRisk', `Failed for tenant ${tenantId}`, { error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all 5 autonomous cron jobs.
 * Call once during server bootstrap — typically in server.ts or app.ts.
 *
 * Example:
 *   import { registerAutonomousJobs } from './jobs/autonomousJobs';
 *   registerAutonomousJobs({
 *     tenantIds: ['tenant_abc', 'tenant_xyz'],
 *     metrcBaseUrl: process.env.METRC_BASE_URL!,
 *     metrcApiKeys: { tenant_abc: process.env.METRC_KEY_ABC! },
 *   });
 */
export function registerAutonomousJobs(config: SchedulerConfig): void {
  // Job 1 — Metrc sync every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    void syncMetrcPackages(config);
  }, { name: 'metrc-sync', timezone: 'America/New_York' });

  // Job 2 — Trend snapshots every hour
  cron.schedule('0 * * * *', () => {
    void computeAllTrendSnapshots(config);
  }, { name: 'trend-snapshot', timezone: 'America/New_York' });

  // Job 3 — Audit chain verification every hour (offset by 5 min)
  cron.schedule('5 * * * *', () => {
    void verifyAllAuditChains(config);
  }, { name: 'audit-verify', timezone: 'America/New_York' });

  // Job 4 — Compliance sweep every 6 hours
  cron.schedule('0 */6 * * *', () => {
    void sweepComplianceThresholds(config);
  }, { name: 'compliance-sweep', timezone: 'America/New_York' });

  // Job 5 — Risk scoring every 24 hours at 02:00 ET
  cron.schedule('0 2 * * *', () => {
    void scoreAllRegulatoryRisk(config);
  }, { name: 'risk-scoring', timezone: 'America/New_York' });

  structuredLog('info', 'registerAutonomousJobs',
    `5 autonomous jobs registered for tenants: [${config.tenantIds.join(', ')}]`);
}
