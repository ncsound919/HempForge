/**
 * stripe.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe billing integration.
 *
 *  - createCheckoutSession(plan, tenant, user) → Checkout Session URL
 *  - createBillingPortalSession(tenant, user) → Customer Portal URL
 *  - handleWebhook(rawBody, signature) → processes subscription events
 *  - getActiveSubscription(tenantId) → current plan/status (via Supabase)
 *
 * The server stores the Stripe customer id + subscription id in Supabase's
 * `subscriptions` table (see supabase/migrations/0001).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Stripe from "stripe";
import {
  supabaseGetSubscription,
  supabaseUpsertSubscription,
  supabaseGetPlans,
  USE_SUPABASE,
} from "./supabaseClient";

const secretKey = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

export const stripe = secretKey ? new Stripe(secretKey) : null;

export const STRIPE_ENABLED = Boolean(stripe);

// ─── Checkout ────────────────────────────────────────────────────────────────

export async function createCheckoutSession(opts: {
  planSlug: string;
  tenantId: string;
  userId?: string;
  email?: string;
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string | null; error?: string }> {
  if (!stripe) return { url: null, error: "Stripe is not configured" };

  const { planSlug, tenantId, userId, email, successUrl, cancelUrl } = opts;
  const { getPlan, priceIdFor } = await import("./pricing");
  const plan = getPlan(planSlug);
  if (!plan) return { url: null, error: `Unknown plan: ${planSlug}` };
  if (plan.monthlyCents === 0) {
    return { url: null, error: "Enterprise is a custom quote — contact sales." };
  }
  const priceId = priceIdFor(plan);
  if (!priceId) {
    return { url: null, error: `Missing ${plan.priceIdEnv} env var` };
  }

  // Reuse or create the Stripe customer per tenant.
  let customerId = opts.customerId;
  if (!customerId) {
    const existing = await supabaseGetSubscription(tenantId);
    if (existing?.customer_id) {
      customerId = existing.customer_id;
    }
  }
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { tenant_id: tenantId, user_id: userId || "" },
    });
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { tenant_id: tenantId, plan_id: plan.id },
    subscription_data: {
      metadata: { tenant_id: tenantId, plan_id: plan.id },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    customer_update: { address: "auto" },
  });

  return { url: session.url };
}

// ─── Customer Portal ─────────────────────────────────────────────────────────

export async function createBillingPortalSession(opts: {
  tenantId: string;
  returnUrl: string;
}): Promise<{ url: string | null; error?: string }> {
  if (!stripe) return { url: null, error: "Stripe is not configured" };
  const sub = await supabaseGetSubscription(opts.tenantId);
  if (!sub?.customer_id) {
    return { url: null, error: "No billing customer on record for this tenant" };
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.customer_id,
    return_url: opts.returnUrl,
  });
  return { url: session.url };
}

// ─── Webhook handling ────────────────────────────────────────────────────────

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

export async function handleStripeWebhook(
  rawBody: string | Buffer,
  signature: string
): Promise<{ received: boolean; error?: string }> {
  if (!stripe) return { received: true, error: "Stripe not configured" };
  if (!webhookSecret) {
    return { received: true, error: "STRIPE_WEBHOOK_SECRET not set" };
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error("[stripe] webhook signature verification failed:", err.message);
    return { received: false, error: `Webhook signature verification failed: ${err.message}` };
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId =
          (session.metadata?.tenant_id as string) || "Global-Hemp-Wilson";
        const planId = (session.metadata?.plan_id as string) || "plan_pilot";
        const subId = session.subscription as string;
        const customerId = session.customer as string;

        let subData: any = {
          id: subId,
          tenant_id: tenantId,
          customer_id: customerId,
          plan_id: planId,
          status: "incomplete",
        };
        if (subId && stripe) {
          const sub = await stripe.subscriptions.retrieve(subId, {
            expand: ["items.data"],
          });
          const item = sub.items?.data?.[0];
          subData = {
            ...subData,
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
        await supabaseUpsertSubscription(subData);
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId =
          (sub.metadata?.tenant_id as string) || "Global-Hemp-Wilson";
        const planId =
          (sub.metadata?.plan_id as string) ||
          (sub.items.data[0]?.price?.id ? "plan_standard" : "plan_pilot");
        const item = sub.items?.data?.[0];
        await supabaseUpsertSubscription({
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
        await supabaseUpsertSubscription({
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
  } catch (err: any) {
    console.error(`[stripe] webhook handler error (${event.type}):`, err.message);
    return { received: true, error: err.message };
  }

  return { received: true };
}

// ─── Billing status ──────────────────────────────────────────────────────────

export async function getBillingStatus(tenantId: string) {
  const sub = await supabaseGetSubscription(tenantId);
  const plans = await supabaseGetPlans();
  return { subscription: sub, plans };
}

export { USE_SUPABASE };
