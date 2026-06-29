/**
 * HempForge Audit Engine
 * 
 * ALCOA+ Compliant Audit Logging with Chain Integrity.
 * Criterion 4: Audit entries are append-only, tamper-evident, consistently hashed,
 *              and reconstructable end-to-end.
 * 
 * Features:
 * - SHA-256 content hashing covering ALL integrity-critical fields
 * - Chain linking: each entry includes hash of the previous entry
 * - Tamper detection: verify chain integrity on demand
 * - Immutability enforcement: entries cannot be silently overwritten
 */

import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  sequenceNumber: number;
  timestamp: string;
  userId: string;
  userRole: string;
  tenantId: string;
  action: string;
  details: string;
  category: AuditCategory;
  /** Hash of this entry's integrity-critical fields */
  hash: string;
  /** Hash of the previous audit entry (chain link) */
  previousHash: string;
  /** Output classification for truthfulness tracking */
  outputClassification?: string;
}

export type AuditCategory =
  | "DATA_CHANGE"
  | "AI_INFERENCE"
  | "SYSTEM_INTEGRATION"
  | "SECURITY_EVENT"
  | "COMPLIANCE_CHECK"
  | "ACCESS_CONTROL";

export interface ChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  brokenAt?: number;
  brokenEntryId?: string;
  details: string;
}

// ─── In-Memory Chain State ────────────────────────────────────────────────────

/** Tracks the last hash per tenant for chain linking */
const lastHashByTenant = new Map<string, string>();
const sequenceByTenant = new Map<string, number>();

/** Genesis hash for the first entry in any tenant's chain */
const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

// ─── Hash Functions ───────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash covering ALL integrity-critical fields.
 * Field order is deterministic and explicitly defined.
 */
export function computeAuditHash(entry: Omit<AuditEntry, "hash">): string {
  const content = [
    entry.id,
    entry.sequenceNumber.toString(),
    entry.timestamp,
    entry.userId,
    entry.userRole,
    entry.tenantId,
    entry.action,
    entry.details,
    entry.category,
    entry.previousHash,
    entry.outputClassification ?? "",
  ].join("|");

  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Legacy hash function for backward compatibility with existing audit logs.
 * Preserves the original field set: id-timestamp-userId-userRole-action-details-category
 */
export function computeLegacyAuditHash(log: {
  id: string;
  timestamp: string;
  userId: string;
  userRole: string;
  action: string;
  details: string;
  category: string;
}): string {
  const content = `${log.id}-${log.timestamp}-${log.userId}-${log.userRole}-${log.action}-${log.details}-${log.category}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ─── Chain Management ─────────────────────────────────────────────────────────

/**
 * Create a new chain-linked audit entry.
 * Automatically links to the previous entry for the same tenant.
 */
export function createChainedAuditEntry(
  params: {
    userId: string;
    userRole: string;
    tenantId: string;
    action: string;
    details: string;
    category: AuditCategory;
    outputClassification?: string;
  }
): AuditEntry {
  const tenantId = params.tenantId;
  const previousHash = lastHashByTenant.get(tenantId) || GENESIS_HASH;
  const sequence = (sequenceByTenant.get(tenantId) || 0) + 1;

  const entry: Omit<AuditEntry, "hash"> = {
    id: `audit-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    sequenceNumber: sequence,
    timestamp: new Date().toISOString(),
    userId: params.userId,
    userRole: params.userRole,
    tenantId: params.tenantId,
    action: params.action,
    details: params.details,
    category: params.category,
    previousHash,
    outputClassification: params.outputClassification,
  };

  const hash = computeAuditHash(entry);
  const fullEntry: AuditEntry = { ...entry, hash };

  // Update chain state
  lastHashByTenant.set(tenantId, hash);
  sequenceByTenant.set(tenantId, sequence);

  return fullEntry;
}

/**
 * Verify the integrity of an audit chain.
 * Detects any tampered, reordered, or missing entries.
 */
export function verifyAuditChain(entries: AuditEntry[]): ChainVerificationResult {
  if (entries.length === 0) {
    return { valid: true, totalEntries: 0, verifiedEntries: 0, details: "Empty chain" };
  }

  // Sort by sequence number
  const sorted = [...entries].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];

    // Verify self-hash
    const expectedHash = computeAuditHash({
      id: entry.id,
      sequenceNumber: entry.sequenceNumber,
      timestamp: entry.timestamp,
      userId: entry.userId,
      userRole: entry.userRole,
      tenantId: entry.tenantId,
      action: entry.action,
      details: entry.details,
      category: entry.category,
      previousHash: entry.previousHash,
      outputClassification: entry.outputClassification,
    });

    if (entry.hash !== expectedHash) {
      return {
        valid: false,
        totalEntries: sorted.length,
        verifiedEntries: i,
        brokenAt: i,
        brokenEntryId: entry.id,
        details: `Entry ${entry.id} (seq ${entry.sequenceNumber}) has corrupted hash. Expected: ${expectedHash}, Got: ${entry.hash}`,
      };
    }

    // Verify chain link (except first entry which links to genesis)
    if (i === 0) {
      if (entry.previousHash !== GENESIS_HASH) {
        return {
          valid: false,
          totalEntries: sorted.length,
          verifiedEntries: 0,
          details: `First entry (seq ${entry.sequenceNumber}) does not link to genesis hash. Expected: ${GENESIS_HASH}, Got: ${entry.previousHash}`,
        };
      }
    } else {
      const previousEntry = sorted[i - 1];
      if (entry.previousHash !== previousEntry.hash) {
        return {
          valid: false,
          totalEntries: sorted.length,
          verifiedEntries: i,
          brokenAt: i,
          brokenEntryId: entry.id,
          details: `Chain broken at entry ${entry.id} (seq ${entry.sequenceNumber}). Expected previousHash: ${previousEntry.hash}, Got: ${entry.previousHash}`,
        };
      }
    }
  }

  return {
    valid: true,
    totalEntries: sorted.length,
    verifiedEntries: sorted.length,
    details: `All ${sorted.length} entries verified. Chain integrity intact.`,
  };
}

/**
 * Initialize chain state from existing entries (for server restart recovery).
 */
export function initializeChainState(tenantId: string, lastEntry?: AuditEntry): void {
  if (lastEntry) {
    lastHashByTenant.set(tenantId, lastEntry.hash);
    sequenceByTenant.set(tenantId, lastEntry.sequenceNumber);
  } else {
    lastHashByTenant.set(tenantId, GENESIS_HASH);
    sequenceByTenant.set(tenantId, 0);
  }
}

/**
 * Get the current chain state for a tenant.
 */
export function getChainState(tenantId: string): { lastHash: string; sequence: number } {
  return {
    lastHash: lastHashByTenant.get(tenantId) || GENESIS_HASH,
    sequence: sequenceByTenant.get(tenantId) || 0,
  };
}
