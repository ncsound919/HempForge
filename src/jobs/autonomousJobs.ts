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
 */

import cron from 'node-cron';
import { TenantRepository } from '../lib/firebaseRepo';
import { normalizeMetrcPackage } from '../lib/metrcApiClient';
import { computeTrendSnapshot, scoreRegulatoryRisk } from '../lib/trendEngine';
import { verifyAuditChain } from '../lib/auditEngine';
import { calculateCompliance } from '../lib/complianceEngine';
import { structuredLog } from '../lib/structuredLogger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerConfig {
  /** Tenant IDs to run jobs against */
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

      const resp = await fetch(
        `${config.metrcBaseUrl}/packages/v2/active?licenseNumber=${tenantId}`,
        { headers: { Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}` } }
      );
      if (!resp.ok) throw new Error(`Metrc responded ${resp.status}`);

      const raw: unknown[] = await resp.json();
      const normalized = raw.map((pkg: any) => normalizeMetrcPackage(pkg, tenantId));

      if (!config.dryRun) {
        const repo = new TenantRepository<any>('metrcPackages', tenantId);
        for (const pkg of normalized) {
          await repo.save({ id: (pkg as any).packageId, ...pkg });
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
      const snapshot = await computeTrendSnapshot(tenantId);
      if (!snapshot) {
        structuredLog('warn', 'computeAllTrendSnapshots', `No snapshot computed for ${tenantId}`);
        continue;
      }

      if (!config.dryRun) {
        const snapshotRepo = new TenantRepository<any>('trendSnapshots', tenantId);
        await snapshotRepo.save({
          id: `snapshot_${Date.now()}`,
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
// Job 3 — Audit Chain Integrity (every hour, offset 5 min)
// ---------------------------------------------------------------------------

async function verifyAllAuditChains(config: SchedulerConfig): Promise<void> {
  for (const tenantId of config.tenantIds) {
    try {
      const auditRepo = new TenantRepository<any>('auditLogs', tenantId);
      const logs = await auditRepo.list();
      logs.sort((a: any, b: any) => a.timestamp - b.timestamp);

      const result = verifyAuditChain(logs);

      if (!result.valid && !config.dryRun) {
        const alertRepo = new TenantRepository<any>('auditAlerts', tenantId);
        await alertRepo.save({
          id: `break_${Date.now()}`,
          detectedAt: new Date().toISOString(),
          brokenAt: (result as any).brokenAt,
          severity: 'critical',
        });
        structuredLog('warn', 'verifyAllAuditChains', `Audit chain BROKEN for ${tenantId}`);
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
      const coaRepo = new TenantRepository<any>('coas', tenantId);
      const coas = await coaRepo.list();

      const crossed: Array<{ batchId: string; totalThc: number; status: string }> = [];

      for (const coa of coas) {
        const result = calculateCompliance({
          thca: Number(coa.thca) || 0,
          d9thc: Number(coa.d9thc) || 0,
        });
        if ((result as any).status !== 'Compliant' && !coa.flagged) {
          crossed.push({ batchId: coa.batchId, totalThc: (result as any).calculatedTotal, status: (result as any).status });
          if (!config.dryRun) {
            await coaRepo.save({ ...coa, flagged: true });
          }
        }
      }

      if (crossed.length > 0 && !config.dryRun) {
        const alertRepo = new TenantRepository<any>('complianceAlerts', tenantId);
        await alertRepo.save({
          id: `sweep_${Date.now()}`,
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
// Job 5 — Regulatory Risk Scoring (every 24 hours at 02:00 ET)
// ---------------------------------------------------------------------------

async function scoreAllRegulatoryRisk(config: SchedulerConfig): Promise<void> {
  for (const tenantId of config.tenantIds) {
    try {
      const batchRepo = new TenantRepository<any>('batches', tenantId);
      const batches = await batchRepo.list();

      const scores = batches.map((b: any) => {
        const compoundName = b.strain || b.compound || 'unknown';
        const paperLike = {
          normalizedTitle: b.strain || '',
          normalizedAbstract: b.notes || b.recommendation || '',
          compoundTags: b.compounds || [compoundName],
        };
        const compoundCount = new Map<string, number>([[compoundName, 1]]);
        const topCompounds = [{ name: compoundName, count: 1 }];
        const [risk] = scoreRegulatoryRisk([paperLike], compoundCount, topCompounds);
        const riskScore = risk?.riskScore ?? 0;
        const riskLevel = riskScore >= 60 ? 'high' : riskScore >= 30 ? 'medium' : 'low';
        return { batchId: b.batchId, riskScore, riskLevel };
      });

      if (!config.dryRun) {
        const riskRepo = new TenantRepository<any>('riskScores', tenantId);
        await riskRepo.save({
          id: `risk_${Date.now()}`,
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
 * Call once during server bootstrap in server.ts.
 *
 * Example:
 *   registerAutonomousJobs({
 *     tenantIds: [DEFAULT_TENANT],
 *     metrcBaseUrl: process.env.METRC_BASE_URL!,
 *     metrcApiKeys: { [DEFAULT_TENANT]: process.env.METRC_API_KEY! },
 *     dryRun: !process.env.METRC_API_KEY,
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
    `5 autonomous jobs registered for tenants: [${config.tenantIds.join(', ')}]. dryRun=${config.dryRun ?? false}`);
}
