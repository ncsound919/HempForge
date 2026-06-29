# HempForge

Agentic compliance, COA verification, and scientific literature integration
workspace for regulated hemp operations.

This README describes the **actual** layout of the codebase. Marketing
language is not used here.

---

## What this is

A B2B internal-tool platform for hemp testing labs, vertically-integrated
brands, and compliance consultants. The product covers four workflows:

1. **COA intake** — upload PDFs/images, parse via Gemini structured-output
   or local Ollama, fall back to regex, compute Total THC.
2. **Compliance ledger** — ALCOA++ hash-chained audit log of every state
   change, with cryptographic COA signatures (HMAC-SHA256).
3. **5-stage GxP workflow lifecycle** — Intake → LIMS Verification →
   Compliance Review → Auditor Sign-off → Metrc Synced.
4. **Literature intelligence** — PubMed / OpenAlex / Europe PMC ingest,
   Mann-Kendall trend detection, Kleinberg burst detection, cross-source
   agreement scoring, regulatory risk scoring.

There is **no commerce functionality** (no cart, checkout, payments,
shipping). The "compliance platform" framing in earlier README drafts was
marketing language, not a product claim.

---

## Module layout

```
server.ts                          Express app composition (108 lines).
                                    Wires middleware + routers + static.

src/
  config.ts                        Shared constants (DEFAULT_TENANT).

  middleware/
    requestLogger.ts               Correlation IDs + JSON start/finish logs.
    errorHandler.ts                Central error mapper. HttpError class.
    tenantGuard.ts                 Body-vs-claim tenantId mismatch guard.

  routes/                          One file per route domain.
    health.ts          GET  /api/health               (public)
                       GET  /api/security/policy
                       GET  /api/security/permissions-manifest
    verify.ts          GET  /api/coas/verify/:id      (public)
    auth.ts            GET  /api/users/profile
    coa.ts             GET  POST /api/coas
                       GET       /api/coas/:id
    audit.ts           GET  POST /api/audit/logs
                       POST      /api/audit/verify-chain
    compliance.ts      POST /api/compliance/calculate
    metrc.ts           GET  /api/metrc/packages
                       POST /api/metrc/sync
    csa.ts             GET  /api/csa/runs
                       POST /api/csa/verify
    lims.ts            GET  /api/lims/labs
                       POST /api/lims/toggle-handshake
    gemini.ts          POST /api/gemini/chat
                       POST /api/gemini/generate-paper
                       POST /api/gemini/research        (alias)
                       POST /api/gemini/parse-coa
                       POST /api/gemini/extract
    ollama.ts          GET  /api/ollama/health
                       POST /api/ollama/{infer,flyer,classify}
    agents.ts          POST /api/pipeline/{extract-scene,
                                          ocr-document,
                                          enrich-scene,
                                          generate-figures,
                                          run-full}
    workflows.ts       GET  POST /api/workflows
                       POST      /api/workflows/:id/transition
    reports.ts         POST /api/reports/generate
                       GET       /api/reports
    dashboard.ts       GET  /api/dashboard/{summary,activity}
                       POST /api/dashboard/{run-audit,export}
    scheduler.ts       GET  POST   /api/scheduler/jobs
                       PATCH    /api/scheduler/jobs/:id
                       DELETE   /api/scheduler/jobs/:id
    literature.ts      POST /api/literature/{search,ingest-defaults,ingest,
                                             extract,run-autonomous-pipeline,
                                             production/run,local-index/run}
                       GET       /api/literature/{cache,trends-insights,
                                              simulations,production/latest,
                                              trend-snapshot,
                                              local-index/latest,local-docs}
    debug.ts           GET  /api/test-db              (404 in production)

  services/
    backendServices.ts            Firebase Admin init, auth middleware,
                                    audit hash, COA HMAC sign, rate
                                    limiters, dev-token parser.

  lib/                             Domain layer. Pure or near-pure logic.
    complianceEngine.ts            Total THC math, Arrhenius decarb
                                    kinetics, NC 0.3% threshold logic.
    coaParser.ts                   Regex-based COA field extraction.
    ocrPipeline.ts                 Tesseract.js pipeline.
    auditEngine.ts                 Hash-chained audit log + persistence
                                    helpers (ChainStateStore).
    permissionsEngine.ts           RBAC matrix (6 roles x 27 perms).
    provenanceEngine.ts            Five output classifiers (live-ai,
                                    simulated, heuristic, formula,
                                    demo-only). Every AI output is
                                    wrapped in one of these.
    firebaseRepo.ts                TenantRepository<T> wrapper. Every
                                    read filters by tenantId at the
                                    storage layer.
    firebaseService.ts             Firestore + local-fallback adapter.
    geminiService.ts               Three pure Gemini functions. No
                                    simulation branches inside.
    ollamaService.ts /             Local Ollama client + typed inference
    ollamaInference.ts              (status, smartInfer, classify,
                                    parseCOAWithInference, trend
                                    narrative, flyer generation).
    literatureService.ts           PubMed / OpenAlex / Europe PMC
                                    ingestion with dedup.
    paperPipelineServer.ts         Scene extraction + figure generation
                                    endpoints.
    reportEngine.ts                 Compliance + ROI report builder.
                                    Markdown / HTML / JSON formats.
    sceneExtractor.ts,
    sceneBuilder.ts,
    sceneSpecSchema.ts              Scene reconstruction pipeline.
    figureExporter.ts               Publication-quality figure export.
    trendEngine.ts                  Mann-Kendall, Kleinberg bursts,
                                    exponential-decay momentum, Shannon-
                                    entropy cross-source agreement,
                                    regulatory risk scoring, z-score
                                    anomalies.
    structuredLogger.ts             JSON-line logger with env-driven level.

  jobs/
    literatureJobs.ts              Cron: periodic literature ingest +
                                    autonomous trends + simulations.
    localFolderIndexer.ts          Watches local-research/ and vault/
                                    directories for new files.

  components/                      React UI. ~700KB across 29 files.
                                    Routes: /, /intake, /agent,
                                    /agent-workspace, /vault, /lab,
                                    /settings, /workflows, /verify/:id.

tests/
  unit/                            Vitest-runner tests for pure logic.
                                    compliance-pipeline.spec.ts,
                                    audit-chain-persistence.spec.ts,
                                    permissions-engine.matrix.spec.ts.
  api/                             HTTP-level tests against the running
                                    server. health-and-routes.spec.ts,
                                    coa.routes.spec.ts,
                                    tenant-isolation.spec.ts,
                                    rate-limit.spec.ts.
  e2e/                             Browser-level. ui-dashboard.spec.ts.
  fixtures/                        Shared test fixtures (auth tokens,
                                    COA payloads).
```

---

## Security model

| Layer | Mechanism |
|---|---|
| Client → Firestore | **Deny-all** (`firestore.rules`). Every read/write flows through the Express API via `firebase-admin` with service-account credentials. |
| Client → API | Bearer token. Production: Firebase Auth JWT with mandatory `tenantId` + `role` custom claims. Non-production: `dev-<uid>:<email>:<tenantId>:<role>` tokens. |
| Tenant isolation | (a) custom claim required at auth; (b) `requireTenantMatch` middleware rejects body-vs-claim mismatch; (c) `TenantRepository<T>` filters at storage layer. |
| Audit chain | ALCOA++ hash-chained entries, persistent via `ChainStateStore` so chain survives restarts. |
| COA signature | HMAC-SHA256 with `COA_SIGNING_SECRET` (≥32 chars). Public `/api/coas/verify/:id` re-validates. |
| Rate limiting | Per-user, per-bucket (`gemini`, `literature`). |
| Startup validation | Production refuses to boot without Firebase `projectId`, `COA_SIGNING_SECRET` ≥ 32 chars, and explicit `CORS_ORIGIN` allow-list. |

---

## Local development

```bash
npm install
npx playwright install chromium   # for the API/e2e suites
cp .env.example .env               # fill in GEMINI_API_KEY etc., or leave
                                  # blank to exercise the heuristic fallback
npm run dev                        # starts Express + Vite on :3000
```

Three test layers:

```bash
npm test                           # vitest — pure logic (compliance,
                                   # audit chain, permissions)
npm run test:unit                  # playwright unit — pure logic via
                                   # the playwright runner
npm run test:api                   # playwright api — HTTP tests against
                                   # the dev server
npm run test:e2e                   # playwright e2e — browser tests
npm run test:all                   # everything
```

CI runs `lint && test && test:unit && test:api` on every push to `main`.

---

## Environment variables

See `.env.example` for the full annotated list. Summary:

| Variable | Required in prod | Purpose |
|---|---|---|
| `NODE_ENV` | yes | Selects dev vs production code paths |
| `GEMINI_API_KEY` | yes | Gemini API key. Format `AIzaSy...` |
| `FIREBASE_PROJECT_ID` | yes | Firebase project |
| `COA_SIGNING_SECRET` | yes | HMAC secret, ≥32 chars |
| `CORS_ORIGIN` | yes | Comma-separated origin allow-list |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | alternative to ADC | Service account inline |
| `USE_LOCAL_DB_FALLBACK` | no | Dev-only. Ignored in production. |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error`. Defaults to `info` in prod, `debug` in dev. |

---

## Output classifications

Every AI output the API emits carries a `provenance.outputClassification`
field, one of:

- `live-ai-inference` — Gemini or Ollama actually invoked.
- `deterministic-formula` — Closed-form computation (e.g. compliance
  threshold, Arrhenius kinetics).
- `heuristic-fallback` — Local rule-based fallback (regex COA parse,
  keyword-scored agent dispatch).
- `simulated` — Templated output generated because the live path was
  unavailable.
- `demo-only` — Data is from the local-fallback seed and must not be
  used for compliance decisions.

The UI renders this field as a colored badge so users cannot mistake
a fallback for a live inference.

---

## Production deployment

`npm run build` produces:
- `dist/` — Vite-bundled React SPA
- `dist/server.cjs` — esbuild-bundled Express server

`npm start` runs `dist/server.cjs`. The server serves both the API and
the SPA static files. Vite middleware is excluded in production.

---

## Known gaps

These are tracked but not yet closed:

1. **No real Metrc integration.** `/api/metrc/*` is a stub that returns
   in-memory arrays. Per-state Metrc API contracts are unbuilt.
2. **Local-DB fallback path in dev only.** Tests that exercise
   authenticated write paths in the API suite return 401 — root cause
   not yet identified. The unit and vitest suites pass cleanly.
3. **No MFA enforcement.** Quality Auditor and Lab Admin roles should
   require Firebase Auth MFA before signing COAs.
4. **No CI yet.** Added in this commit; runs on push.
5. **No architecture diagram image** — the module tree above is the
   closest substitute.