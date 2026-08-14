# HempForge — Deployment Guide

Covers demo mode (zero credentials, for the anchor-client Loom) and production
(Supabase data + auth, Stripe billing, real COA signing).

---

## Prerequisites

- Docker Engine (this fleet uses the WSL2 Ubuntu engine: `wsl -d Ubuntu -- docker ...`)
- Node 20+ + Supabase CLI (`npm i -g supabase`)
- Port 3000 free

## Demo mode (no credentials — run this first)

```bash
# from HempForge-main/
docker compose --profile demo up -d --build
```

The demo image boots with `NODE_ENV=development`, `USE_LOCAL_DB_FALLBACK=true`,
`SERVE_STATIC=true` (prebuilt SPA, no Vite dev server) and a local
`COA_SIGNING_SECRET`, writing data to the on-disk `local-db-fallback.json`.

**Authenticate** with a dev token:
```
Authorization: Bearer dev-admin:admin@hempforge.lan:Global-Hemp-Wilson:Lab%20Admin
```

Verify: `curl http://localhost:3000/api/health`

## Production mode (Supabase + Stripe)

### 1. Apply the Supabase schema

```bash
cd HempForge-main
supabase db push --db-url "postgresql://postgres:<DB_PASSWORD>@db.exjoyfdbgllkptniywpd.supabase.co:5432/postgres"
```

The migration (`supabase/migrations/0001_hempforge_schema.sql`) creates:
`documents` (generic JSONB store), `plans` (seeded Pilot/Standard/Enterprise),
`subscriptions`, `profiles` + `handle_new_user` trigger, and tenant-scoped RLS.

### 2. Configure Stripe

```bash
STRIPE_SECRET_KEY=sk_... node scripts/setup-stripe.mjs
```

> **Already done for this deployment** — the shared live account (Justice `.env`)
> is wired in. HempForge products/prices exist:
> Pilot `price_1U48YzQrfNRBru0zKvMaVvEL`, Standard `price_1U48Z0QrfNRBru0z7GxBY6QG`,
> Enterprise `prod_V4H7QeDpI3PGNs` (custom quote). Re-run the script only if you
> want fresh prices.

This creates the three products/prices and prints the price ids. Then:

```bash
# local webhook relay (dev)
stripe listen --forward-to http://localhost:3000/api/billing/webhook
# → copy the whsec_... into STRIPE_WEBHOOK_SECRET
```

For production, create the webhook endpoint in the Stripe dashboard pointing to
`https://<host>/api/billing/webhook` with events: `checkout.session.completed`,
`customer.subscription.created/updated/deleted`.

### 3. Set .env

```bash
cp .env.example .env
# Required:
#   NODE_ENV=production
#   SUPABASE_URL=https://exjoyfdbgllkptniywpd.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<from plans/Hempforge.txt or dashboard>
#   STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET + STRIPE_PRICE_*_ID
#   COA_SIGNING_SECRET=<48+ hex chars>
#   CORS_ORIGIN=https://app.yourdomain.com
docker compose up -d --build
```

### 4. Client build env

The SPA must be built with Supabase auth env (baked in at build time):
```
VITE_AUTH_MODE=supabase
VITE_SUPABASE_URL=https://exjoyfdbgllkptniywpd.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```
Pass these via the compose `environment` block (or bake into the Docker build
args) so the sign-in screen offers email/password Supabase auth.

### 5. Provision users

Supabase sign-up creates a `profiles` row (trigger). For tenant + role, either
set `raw_app_meta_data` on the user in the Supabase dashboard, or patch the
`profiles` row directly. Defaults are `Global-Hemp-Wilson` / `Lab Admin`.

## Billing API

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/billing/plans` | public | Pricing list |
| `GET /api/billing/status` | yes | Current subscription + plans |
| `POST /api/billing/checkout` | yes | Create Checkout Session (`{planSlug}`) |
| `POST /api/billing/portal` | yes | Open Stripe Customer Portal |
| `POST /api/billing/webhook` | stripe sig | Subscription lifecycle events |

Pricing: **Pilot $500/mo** · **Standard $2,000/mo** · **Enterprise (custom)**.
Plan definitions live in `src/lib/pricing.ts`; price ids come from env.

## Optional sidecars

| Sidecar | Command | Purpose |
|---|---|---|
| Ollama (local LLM) | `docker compose --profile ollama up -d` | On-prem inference; optional |
| mem0 memory | `docker compose --profile mem0 up -d` | Agent memory (needs OpenAI key) |

## Image layout

- **Builder stage:** `npm ci` → `npm run build` (Vite SPA → `dist/`, esbuild server → `dist/server.mjs` with `--packages=external`).
- **Runner stage:** `npm ci --omit=dev`, copies `dist/`, seeds `local-research/` + `vault/`, runs as non-root user `hempforge` on :3000.
- Healthcheck: `GET /api/health` every 30s.

## Known gaps (from README)

1. `/api/metrc/*` is a stub returning in-memory arrays — per-state Metrc contracts unbuilt.
2. Local-DB fallback writes to `local-db-fallback.json` (dev/demo only; ignored in production).
3. No MFA enforcement on sign-off roles yet.
4. For the anchor-client demo, seed realistic-but-clearly-demo COAs so the Loom shows the hash-chain + verify flow.

## Checklist for the anchor-client demo

- [x] Docker image builds + runs `healthy`; `/api/health` 200; SPA serves; authed demo endpoints 200
- [x] Supabase schema applied to `exjoyfdbgllkptniywpd`; plans seeded; data writes verified (documents table live)
- [x] Billing API responds (`/api/billing/plans` + `/api/billing/status` verified)
- [x] Stripe configured: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` from the shared live account (Justice `.env`); HempForge Pilot/Standard/Enterprise products + prices created (`price_1U48Yz...` / `price_1U48Z0...`); checkout session verified live (`cs_live_...`)
- [ ] Record the 3-min Loom (upload → parse → chain verify → GxP stage transition → checkout)
- [ ] Push image to a registry (`docker tag hempforge:latest ghcr.io/<you>/hempforge && docker push`)
- [ ] Create the production webhook endpoint in the Stripe dashboard (URL → `/api/billing/webhook`, events: `checkout.session.completed`, `customer.subscription.created/updated/deleted`)
