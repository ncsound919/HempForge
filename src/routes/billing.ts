/**
 * routes/billing.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe billing endpoints:
 *
 *   GET  /api/billing/plans          → public pricing list
 *   GET  /api/billing/status         → current subscription + plans (auth)
 *   POST /api/billing/checkout       → create Checkout Session (auth)
 *   POST /api/billing/portal         → open Customer Portal (auth)
 *   POST /api/billing/webhook        → Stripe webhook (raw body, no auth)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, RequestHandler } from "express";
import { PLANS, getPlan } from "../lib/pricing";
import {
  createCheckoutSession,
  createBillingPortalSession,
  handleStripeWebhook,
  getBillingStatus,
  STRIPE_ENABLED,
} from "../lib/stripe";

export function billingRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  // Public pricing (mirrors PLANS; hides price ids from the client)
  router.get("/plans", (_req, res) => {
    res.json({
      enabled: STRIPE_ENABLED,
      plans: PLANS.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        monthlyCents: p.monthlyCents,
        monthlyDollars: p.monthlyDollars,
        description: p.description,
        features: p.features,
        maxSeats: p.maxSeats,
        maxFacilities: p.maxFacilities,
        highlight: p.highlight,
        cta: p.cta,
      })),
    });
  });

  // Current subscription + available plans
  router.get("/status", deps.authMiddleware, async (req, res) => {
    try {
      const tenantId = req.authContext?.tenantId || "Global-Hemp-Wilson";
      const status = await getBillingStatus(tenantId);
      res.json({
        enabled: STRIPE_ENABLED,
        subscription: status.subscription,
        plans: status.plans,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load billing status" });
    }
  });

  // Start checkout
  router.post("/checkout", deps.authMiddleware, async (req, res) => {
    try {
      const { planSlug } = req.body || {};
      if (!planSlug || typeof planSlug !== "string") {
        return res.status(400).json({ error: "planSlug is required" });
      }
      const plan = getPlan(planSlug);
      if (!plan) return res.status(400).json({ error: `Unknown plan: ${planSlug}` });
      if (plan.monthlyCents === 0) {
        return res.status(200).json({
          custom: true,
          message: "Enterprise is a custom quote — contact sales.",
        });
      }

      const tenantId = req.authContext?.tenantId || "Global-Hemp-Wilson";
      const userId = req.authContext?.userId;
      const email = req.authContext?.userEmail;
      const base = process.env.APP_URL || "http://localhost:3000";

      const result = await createCheckoutSession({
        planSlug,
        tenantId,
        userId,
        email,
        successUrl: `${base}/settings?checkout=success`,
        cancelUrl: `${base}/settings?checkout=cancelled`,
      });
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({ url: result.url });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Checkout failed" });
    }
  });

  // Open the Customer Portal
  router.post("/portal", deps.authMiddleware, async (req, res) => {
    try {
      const tenantId = req.authContext?.tenantId || "Global-Hemp-Wilson";
      const base = process.env.APP_URL || "http://localhost:3000";
      const result = await createBillingPortalSession({
        tenantId,
        returnUrl: `${base}/settings`,
      });
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({ url: result.url });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to open billing portal" });
    }
  });

  // Stripe webhook — MUST use the raw body (no express.json() parsing here).
  router.post("/webhook", async (req: any, res) => {
    const signature = req.headers["stripe-signature"] as string;
    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const result = await handleStripeWebhook(rawBody, signature);
    if (result.error && !result.received) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ received: true });
  });

  return router;
}
