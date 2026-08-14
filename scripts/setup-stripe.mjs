/**
 * setup-stripe.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates the three HempForge pricing products + recurring monthly prices in
 * Stripe, then prints the price ids to paste into .env.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node setup-stripe.mjs
 *   STRIPE_SECRET_KEY=sk_test_... node setup-stripe.mjs   (test mode)
 *
 * It also prints the webhook endpoint command. Set STRIPE_WEBHOOK_SECRET
 * from `stripe listen` (local) or the dashboard webhook signing secret.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY first.");
  process.exit(1);
}

const stripe = new Stripe(key);

const PLANS = [
  {
    name: "HempForge Pilot",
    slug: "pilot",
    amount: 50000,
    description: "Single facility, COA import, audit chain, Metrc sync, email support.",
  },
  {
    name: "HempForge Standard",
    slug: "standard",
    amount: 200000,
    description: "Multi-facility, GxP workflows, literature intelligence, SLA.",
  },
  {
    name: "HempForge Enterprise",
    slug: "enterprise",
    amount: 0,
    description: "Unlimited facilities, SSO, on-prem, full API access. Custom quote.",
  },
];

for (const plan of PLANS) {
  const product = await stripe.products.create({
    name: plan.name,
    description: plan.description,
    metadata: { plan_slug: plan.slug },
  });

  if (plan.amount === 0) {
    console.log(`\n=== ${plan.name} (custom quote) ===`);
    console.log(`product_id: ${product.id}`);
    console.log("No recurring price — use /api/billing/checkout 'enterprise' returns custom-quote message.");
    continue;
  }

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.amount,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: { plan_slug: plan.slug },
  });

  console.log(`\n=== ${plan.name} ===`);
  console.log(`product_id: ${product.id}`);
  console.log(`price_id:   ${price.id}`);
}

console.log(`\n${"─".repeat(50)}`);
console.log("Set these in your .env:");
console.log("  STRIPE_PRICE_PILOT_ID=price_...");
console.log("  STRIPE_PRICE_STANDARD_ID=price_...");
console.log("  STRIPE_PRICE_ENTERPRISE_ID=<product_id or empty>");
console.log("  STRIPE_SECRET_KEY=" + (key.startsWith("sk_test") ? "(already set — test mode)" : "(already set — live mode)"));

console.log(`\n${"─".repeat(50)}`);
console.log("Webhook setup (local dev):");
console.log("  stripe listen --forward-to http://localhost:3000/api/billing/webhook");
console.log("Then copy the 'whsec_...' secret into STRIPE_WEBHOOK_SECRET.");
console.log("\nProduction: Dashboard → Developers → Webhooks → Add endpoint:");
console.log("  URL: https://<your-host>/api/billing/webhook");
console.log("  Events: checkout.session.completed, customer.subscription.updated,");
console.log("          customer.subscription.created, customer.subscription.deleted");
