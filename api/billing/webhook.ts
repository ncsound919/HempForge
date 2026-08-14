/**
 * api/billing/webhook.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vercel serverless Stripe webhook handler (self-contained — no Express app
 * import, so the lambda stays small and cold-starts fast).
 *
 * Verifies the Stripe signature against the raw body, then syncs subscription
 * lifecycle events into the Supabase `subscriptions` table.
 *
 * Events handled:
 *   checkout.session.completed      → create subscription row
 *   customer.subscription.created   → create/refresh row
 *   customer.subscription.updated   → refresh status/periods
 *   customer.subscription.deleted   → mark canceled
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { IncomingMessage, ServerResponse } from "http";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

const SUB_STATUS_MAP: Record<string, string> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "incomplete_expired",
  unpaid: "unpaid",
  paused: "paused",
};

async function upsertSubscription(row: Record<string, unknown>): Promise<void> {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    console.error("[webhook] Supabase not configured — cannot persist subscription");
    return;
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await sb
    .from("subscriptions")
    .upsert(row, { onConflict: "id" });
  if (error) {
    console.error("[webhook] supabase upsert failed:", error.message);
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !webhookSecret) {
    return json(res, 503, { error: "Billing not configured" });
  }

  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") return json(res, 400, { error: "Invalid signature" });

  let event: Stripe.Event;
  try {
    const raw = await readRawBody(req);
    event = new Stripe(secret).webhooks.constructEvent(raw, sig, webhookSecret);
  } catch {
    return json(res, 400, { error: "Invalid signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = (session.metadata?.tenant_id as string) || "Global-Hemp-Wilson";
        const planId = (session.metadata?.plan_id as string) || "plan_pilot";
        const subId = session.subscription as string;
        const customerId = session.customer as string;

        let row: Record<string, unknown> = {
          id: subId,
          tenant_id: tenantId,
          customer_id: customerId,
          plan_id: planId,
          status: "incomplete",
        };
        if (subId) {
          const sub = await new Stripe(secret).subscriptions.retrieve(subId, {
            expand: ["items.data"],
          });
          const item = sub.items?.data?.[0];
          row = {
            ...row,
            status: SUB_STATUS_MAP[sub.status] || sub.status,
            current_period_start: item?.current_period_start
              ? new Date(item.current_period_start * 1000).toISOString()
              : null,
            current_period_end: item?.current_period_end
              ? new Date(item.current_period_end * 1000).toISOString()
              : null,
            cancel_at_period_end: sub.cancel_at_period_end,
          };
        }
        await upsertSubscription(row);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId =
          (sub.metadata?.tenant_id as string) || "Global-Hemp-Wilson";
        const planId =
          (sub.metadata?.plan_id as string) ||
          (sub.items.data[0]?.price?.id ? "plan_standard" : "plan_pilot");
        const item = sub.items?.data?.[0];
        await upsertSubscription({
          id: sub.id,
          tenant_id: tenantId,
          customer_id: sub.customer as string,
          plan_id: planId,
          status: SUB_STATUS_MAP[sub.status] || sub.status,
          current_period_start: item?.current_period_start
            ? new Date(item.current_period_start * 1000).toISOString()
            : null,
          current_period_end: item?.current_period_end
            ? new Date(item.current_period_end * 1000).toISOString()
            : null,
          cancel_at_period_end: sub.cancel_at_period_end,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId =
          (sub.metadata?.tenant_id as string) || "Global-Hemp-Wilson";
        await upsertSubscription({
          id: sub.id,
          tenant_id: tenantId,
          customer_id: sub.customer as string,
          status: "canceled",
          cancel_at_period_end: false,
        });
        break;
      }

      default:
        break;
    }
    return json(res, 200, { received: true });
  } catch (e: any) {
    console.error("[webhook] processing error:", e?.message || e);
    return json(res, 500, { error: "Webhook processing failed" });
  }
}
