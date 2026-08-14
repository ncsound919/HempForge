/**
 * supabaseClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side Supabase access. Uses the service-role key (bypasses RLS) so the
 * app's existing repository layer — which already enforces tenant scoping in
 * code (TenantRepository, fetchFromFirestore/writeToFirestore) — keeps working
 * unchanged. The `documents` table mirrors the old Firestore collection model:
 *
 *   documents(collection, id, tenant_id, data jsonb)
 *
 * All helpers here are thin Postgres wrappers over that one table.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const USE_SUPABASE =
  url.startsWith("https://") &&
  url.includes(".supabase.co") &&
  serviceKey.length > 40;

export let supabase: SupabaseClient | null = null;

if (USE_SUPABASE) {
  supabase = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  console.log("[supabaseClient] Connected to Supabase:", url);
} else {
  console.warn(
    "[supabaseClient] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — running with local/Firebase fallback."
  );
}

/** Convert a jsonb row to the { id, ...data } shape the app expects. */
function rowToRecord<T>(row: {
  id: string;
  data: unknown;
  tenant_id?: string;
}): T {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return { id: row.id, tenant_id: row.tenant_id, ...data } as T;
}

/** List every document in a collection (tenant scoping happens in callers). */
export async function supabaseFetchCollection<T = any>(
  collection: string
): Promise<T[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("documents")
    .select("id, data, tenant_id")
    .eq("collection", collection);
  if (error) {
    console.error(`[supabase] read ${collection}:`, error.message);
    return [];
  }
  return (data ?? []).map(rowToRecord<T>);
}

/** Upsert a document. PK is (collection, id, tenant_id). */
export async function supabaseSetDoc(
  collection: string,
  docId: string,
  data: any,
  tenantId: string
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("documents").upsert(
    {
      collection,
      id: docId,
      tenant_id: tenantId,
      data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,id,tenant_id" }
  );
  if (error) {
    console.error(`[supabase] write ${collection}/${docId}:`, error.message);
  }
}

/** Delete a document. */
export async function supabaseDeleteDoc(
  collection: string,
  docId: string,
  tenantId: string
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("collection", collection)
    .eq("id", docId)
    .eq("tenant_id", tenantId);
  if (error) {
    console.error(`[supabase] delete ${collection}/${docId}:`, error.message);
  }
}

// ─── Billing (plans + subscriptions) ─────────────────────────────────────────

export async function supabaseGetPlans(): Promise<any[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[supabase] plans:", error.message);
    return [];
  }
  return data ?? [];
}

export async function supabaseGetSubscription(
  tenantId: string
): Promise<any | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[supabase] subscription:", error.message);
    return null;
  }
  return data;
}

export async function supabaseUpsertSubscription(sub: any): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("subscriptions").upsert(sub, {
    onConflict: "id",
  });
  if (error) {
    console.error("[supabase] upsert subscription:", error.message);
  }
}
