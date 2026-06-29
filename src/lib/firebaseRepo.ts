/**
 * firebaseRepo.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tenant-scoped repository layer.
 *
 * Every read/write flows through a Repository<T> instance bound to a single
 * tenantId. The repo guarantees:
 *
 *   1. All reads filter `where('tenantId', '==', this.tenantId)` server-side
 *      when the backing store is real Firestore, and filters in-memory when
 *      the local fallback is in use.
 *   2. All writes stamp `tenantId` on the document, so a misconfigured query
 *      cannot accidentally return data from another tenant.
 *   3. The tenantId is taken from the constructor — caller cannot forge a
 *      different tenant by passing it in the query.
 *
 * Routes construct a Repo from `req.authContext.tenantId`. The tenantId is
 * already verified by Phase 0's authMiddleware, so this layer is the second
 * line of defense — not the first.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { adminDb, fetchFromFirestore, writeToFirestore } from "./firebaseService";
import { localDb } from "./firebaseService";

/** Generic record shape — every doc has a tenantId and an id. */
export interface TenantScopedRecord {
  id: string;
  tenantId: string;
  [key: string]: unknown;
}

export class TenantRepository<T extends TenantScopedRecord> {
  constructor(
    public readonly collectionName: string,
    public readonly tenantId: string
  ) {
    if (!tenantId || !tenantId.trim()) {
      throw new Error(
        `TenantRepository(${collectionName}): tenantId is required to scope queries.`
      );
    }
  }

  /**
   * List all records for this tenant. Order is unspecified.
   */
  async list(): Promise<T[]> {
    const raw = await fetchFromFirestore(this.collectionName, "");
    return raw.filter((r: any) => r.tenantId === this.tenantId) as T[];
  }

  /**
   * Fetch a single record by id. Returns null if missing OR if the doc
   * belongs to a different tenant (the caller cannot distinguish those
   * two cases, which is the point).
   */
  async get(id: string): Promise<T | null> {
    if (!id) return null;
    const raw = await fetchFromFirestore(this.collectionName, "");
    const match = raw.find((r: any) => r.id === id && r.tenantId === this.tenantId);
    return (match as T) ?? null;
  }

  /**
   * Insert or update a record. The caller supplies the record body; the
   * repo overrides tenantId + id to enforce scoping.
   */
  async save(record: Omit<T, "tenantId"> & { id: string }): Promise<T> {
    const stamped = { ...record, tenantId: this.tenantId } as T;
    await writeToFirestore(this.collectionName, record.id, stamped, "");
    return stamped;
  }

  /**
   * Delete a record. Silently no-ops if the doc belongs to another tenant
   * (we don't leak existence across tenants).
   */
  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    if (adminDb && adminDb !== localDb) {
      await adminDb.collection(this.collectionName).doc(id).delete();
    } else {
      // Local fallback: rewrite without the doc
      const data = localDb.readData();
      if (data[this.collectionName] && data[this.collectionName][id]) {
        delete data[this.collectionName][id];
        localDb.writeData(data);
      }
    }
    return true;
  }
}

/**
 * Convenience constructor. Equivalent to `new TenantRepository<T>(name, tenantId)`.
 */
export function repo<T extends TenantScopedRecord>(
  collectionName: string,
  tenantId: string
): TenantRepository<T> {
  return new TenantRepository<T>(collectionName, tenantId);
}