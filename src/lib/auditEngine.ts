import crypto from 'crypto';

export type AuditEntry = {
  id: string;
  sequenceNumber: number;
  timestamp: string;
  userId: string;
  userRole: string;
  tenantId: string;
  action: string;
  details: string;
  category: 'DATA_CHANGE' | 'AI_INFERENCE' | 'SYSTEM_INTEGRATION' | 'USER_ACTION';
  previousHash: string;
  hash: string;
};

export function computeAuditHash(entry: Omit<AuditEntry, 'hash'>): string {
  const payload = `${entry.id}-${entry.sequenceNumber}-${entry.timestamp}-${entry.userId}-${entry.userRole}-${entry.action}-${entry.details}-${entry.category}-${entry.previousHash}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function computeLegacyAuditHash(log: any): string {
  const payload = `${log.id}-${log.timestamp}-${log.userId}-${log.userRole}-${log.action}-${log.details}-${log.category}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

const chainStates: Record<string, { lastHash: string; lastSequence: number }> = {};

export function initializeChainState(tenantId: string): void {
  chainStates[tenantId] = {
    lastHash: '0000000000000000000000000000000000000000000000000000000000000000',
    lastSequence: 0
  };
}

export function getChainState(tenantId: string): { lastHash: string; lastSequence: number } {
  if (!chainStates[tenantId]) {
    initializeChainState(tenantId);
  }
  return chainStates[tenantId];
}

export function createChainedAuditEntry(params: { userId: string, userRole: string, tenantId: string, action: string, details: string, category: 'DATA_CHANGE' | 'AI_INFERENCE' | 'SYSTEM_INTEGRATION' | 'USER_ACTION' }): AuditEntry {
  const state = getChainState(params.tenantId);
  const sequenceNumber = state.lastSequence + 1;
  const previousHash = state.lastHash;
  
  const entryWithoutHash: Omit<AuditEntry, 'hash'> = {
    id: `audit-${Date.now()}-${sequenceNumber}`,
    sequenceNumber,
    timestamp: new Date().toISOString(),
    userId: params.userId,
    userRole: params.userRole,
    tenantId: params.tenantId,
    action: params.action,
    details: params.details,
    category: params.category,
    previousHash,
  };
  
  const hash = computeAuditHash(entryWithoutHash);
  
  chainStates[params.tenantId] = {
    lastSequence: sequenceNumber,
    lastHash: hash
  };
  
  return {
    ...entryWithoutHash,
    hash
  };
}

export function verifyAuditChain(entries: AuditEntry[]): { valid: boolean, totalEntries: number, verifiedEntries: number, brokenAt?: number } {
  let verifiedEntries = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const { hash, ...rest } = entry;
    const computedHash = computeAuditHash(rest as any);
    if (computedHash !== hash) {
      return { valid: false, totalEntries: entries.length, verifiedEntries, brokenAt: i };
    }
    if (i > 0) {
      if (entry.previousHash !== entries[i - 1].hash) {
        return { valid: false, totalEntries: entries.length, verifiedEntries, brokenAt: i };
      }
    }
    verifiedEntries++;
  }
  return { valid: true, totalEntries: entries.length, verifiedEntries };
}
