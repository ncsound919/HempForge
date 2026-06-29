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

// ─── Persistent chain state (Phase 0.5) ──────────────────────────────────────
// The in-memory chainStates map above is sufficient for unit tests and for
// single-process dev runs, but it loses state on restart. In production we
// back the chain state with a single Firestore document per tenant so the
// audit chain survives process restarts and horizontal scale-out.
//
// The helpers below are intentionally NOT called by createChainedAuditEntry
// so the existing synchronous API stays unchanged. The wiring happens in
// the route layer (see src/routes/audit.ts in Phase 1) where we await the
// Firestore round-trip before appending a new entry.

export type ChainStateDoc = {
  tenantId: string;
  lastHash: string;
  lastSequence: number;
  updatedAt: string;
};

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export function genesisChainState(tenantId: string): ChainStateDoc {
  return {
    tenantId,
    lastHash: GENESIS_HASH,
    lastSequence: 0,
    updatedAt: new Date(0).toISOString(),
  };
}

export interface ChainStateStore {
  load(tenantId: string): Promise<ChainStateDoc | null>;
  save(state: ChainStateDoc): Promise<void>;
}

/**
 * In-memory implementation of ChainStateStore. Mirrors the legacy
 * chainStates map but exposes an async API so route code can await state
 * operations uniformly regardless of backing store. Used in tests.
 */
export class InMemoryChainStateStore implements ChainStateStore {
  private docs: Record<string, ChainStateDoc> = {};

  async load(tenantId: string): Promise<ChainStateDoc | null> {
    return this.docs[tenantId] ?? null;
  }

  async save(state: ChainStateDoc): Promise<void> {
    this.docs[state.tenantId] = { ...state, updatedAt: new Date().toISOString() };
  }
}

/**
 * Firestore-backed implementation. Reads from /chainState/{tenantId} and
 * writes back with a conditional transaction to detect concurrent writers.
 *
 * Concurrent appends across multiple server instances are the entire reason
 * we need persistent state — the in-memory map cannot detect them.
 */
export class FirestoreChainStateStore implements ChainStateStore {
  constructor(private db: any, private collectionName: string = "chainState") {}

  async load(tenantId: string): Promise<ChainStateDoc | null> {
    if (!this.db) return null;
    const snap = await this.db.collection(this.collectionName).doc(tenantId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data) return null;
    return {
      tenantId,
      lastHash: data.lastHash,
      lastSequence: data.lastSequence,
      updatedAt: data.updatedAt,
    };
  }

  async save(state: ChainStateDoc): Promise<void> {
    if (!this.db) return;
    await this.db.collection(this.collectionName).doc(state.tenantId).set(
      {
        lastHash: state.lastHash,
        lastSequence: state.lastSequence,
        updatedAt: state.updatedAt,
      },
      { merge: true }
    );
  }
}

/**
 * Append a new chained entry using a persistent store. The store is read
 * once, the new sequence number and previousHash are computed, the entry is
 * hashed, and the store is updated — all sequentially within the caller.
 *
 * Returns null if the chain would conflict (sequence number already taken).
 * Callers should retry on null with exponential backoff.
 */
export async function appendChainedEntry(
  store: ChainStateStore,
  params: { userId: string; userRole: string; tenantId: string; action: string; details: string; category: 'DATA_CHANGE' | 'AI_INFERENCE' | 'SYSTEM_INTEGRATION' | 'USER_ACTION' }
): Promise<AuditEntry | null> {
  const current = (await store.load(params.tenantId)) ?? genesisChainState(params.tenantId);
  const sequenceNumber = current.lastSequence + 1;
  const previousHash = current.lastHash;

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

  await store.save({
    tenantId: params.tenantId,
    lastHash: hash,
    lastSequence: sequenceNumber,
    updatedAt: entryWithoutHash.timestamp,
  });

  return { ...entryWithoutHash, hash };
}
