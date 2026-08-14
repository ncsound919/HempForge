/**
 * pricing.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * HempForge pricing model. Amounts in cents (Stripe convention).
 *
 * The three tiers mirror the anchor-client package:
 *   Pilot     $500/mo  — 1 facility, COA import, audit chain, Metrc sync
 *   Standard  $2,000/mo — multi-facility, GxP workflows, literature intel
 *   Enterprise          — custom (quote)
 *
 * stripe_price_id is filled in from env (STRIPE_PRICE_*_ID) at build time so
 * the codebase never hardcodes a price id; the seed SQL + Stripe CLI create
 * the matching prices.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface PricingPlan {
  id: string;
  slug: string;
  name: string;
  monthlyCents: number;
  monthlyDollars: number;
  description: string;
  features: string[];
  maxSeats: number;
  maxFacilities: number;
  priceIdEnv: string;
  highlight?: boolean;
  cta: string;
}

export const PLANS: PricingPlan[] = [
  {
    id: "plan_pilot",
    slug: "pilot",
    name: "Pilot",
    monthlyCents: 50000,
    monthlyDollars: 500,
    description: "Single facility, COA import, audit chain, Metrc sync, email support.",
    features: [
      "1 facility",
      "COA import + parsing",
      "ALCOA++ hash-chained audit ledger",
      "Metrc track-and-trace sync",
      "Email support",
    ],
    maxSeats: 1,
    maxFacilities: 1,
    priceIdEnv: "STRIPE_PRICE_PILOT_ID",
    cta: "Start Pilot",
  },
  {
    id: "plan_standard",
    slug: "standard",
    name: "Standard",
    monthlyCents: 200000,
    monthlyDollars: 2000,
    description: "Multi-facility, GxP workflows, literature intelligence, SLA.",
    features: [
      "5 facilities",
      "Everything in Pilot",
      "GxP 5-stage workflow lifecycle",
      "Literature intelligence (PubMed/OpenAlex)",
      "Priority SLA",
    ],
    maxSeats: 5,
    maxFacilities: 5,
    priceIdEnv: "STRIPE_PRICE_STANDARD_ID",
    highlight: true,
    cta: "Go Standard",
  },
  {
    id: "plan_enterprise",
    slug: "enterprise",
    name: "Enterprise",
    monthlyCents: 0, // custom quote
    monthlyDollars: 0,
    description: "Unlimited facilities, SSO, on-prem, full API access.",
    features: [
      "Unlimited facilities",
      "SSO + MFA enforcement",
      "On-prem / VPC deployment",
      "Full API access",
      "Dedicated support + SLAs",
    ],
    maxSeats: 999,
    maxFacilities: 999,
    priceIdEnv: "STRIPE_PRICE_ENTERPRISE_ID",
    cta: "Contact Sales",
  },
];

export function getPlan(slugOrId: string): PricingPlan | undefined {
  return PLANS.find(
    (p) => p.slug === slugOrId || p.id === slugOrId
  );
}

/** Resolve a plan's Stripe price id from env. */
export function priceIdFor(plan: PricingPlan): string | undefined {
  return process.env[plan.priceIdEnv];
}

/** Format cents as USD. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
