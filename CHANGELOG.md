# Changelog

All notable changes to HempForge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-06-29

The first tag. Marks the codebase as a coherent B2B compliance platform
rather than an AI Studio prototype. Every commit below is part of this
release.

### Security (Phase 0)

- **`firestore.rules`**: world-readable/world-writable replaced with
  deny-all. All client SDK access blocked. Every read/write flows through
  the Express API via `firebase-admin` with service-account credentials.
- **`backendServices.ts`** — fail-fast startup validation. Production
  refuses to boot without a Firebase `projectId`, `COA_SIGNING_SECRET`
  ≥ 32 chars, or `CORS_ORIGIN` allow-list.
- **`backendServices.ts`** — strict tenant extraction. `tenantId` and
  `role` are now required custom claims. Legacy email-based tenant
  inference retained only for non-production environments.
- **`backendServices.ts`** — `parseDevToken()` accepts
  `dev-<uid>:<email>:<tenantId>:<role>` bearer tokens when
  `NODE_ENV !== "production"`. Tests and local dev get authenticated
  access without provisioning real Firebase Auth users.
- **`auditEngine.ts`** — `ChainStateStore` interface and
  `InMemoryChainStateStore` / `FirestoreChainStateStore`
  implementations. The audit chain now survives process restarts
  instead of resetting from the in-memory `chainStates` map.

### Refactor (Phase 1)

- `server.ts` shrunk from **2,421 lines to 108 lines**. Each route
  domain lives in its own file under `src/routes/`. Middleware lives
  in `src/middleware/`. Shared constants in `src/config.ts`.
- 18 route modules: `agents`, `audit`, `auth`, `coa`, `compliance`,
  `csa`, `dashboard`, `debug`, `gemini`, `health`, `lims`, `literature`,
  `metrc`, `ollama`, `reports`, `scheduler`, `verify`, `workflows`.
- Routes are factories that accept `{ authMiddleware }` via dependency
  injection to avoid circular imports.
- `verify.ts` exposes the public `/api/coas/verify/:id` endpoint
  (HMAC signature re-verification, no auth required).

### Tenant repository (Phase 2)

- **`firebaseRepo.ts`** — `TenantRepository<T>` wraps every Firestore
  read/write with a constructor-bound `tenantId`. Reads filter
  server-side (when Firestore is the backing store) and in-memory
  (when the local fallback is in use). Writes stamp `tenantId`. The
  constructor throws if `tenantId` is empty.
- `src/routes/coa.ts` and `src/routes/dashboard.ts` migrated to use
  the repo. Other routes retain their existing per-route filtering
  pending follow-up migration.

### Observability (Phase 3)

- **`structuredLogger.ts`** — JSON-line logger with env-driven
  `LOG_LEVEL`. Writes to stdout (`info`/`debug`) or stderr
  (`warn`/`error`).
- **`requestLogger.ts`** middleware — assigns correlation IDs, emits
  start/finish logs with duration in milliseconds, echoes
  `x-request-id` back in the response header.
- **`errorHandler.ts`** — central error mapper. `HttpError` class for
  typed errors from handlers. Maps JSON-parse and payload-too-large
  errors to 400/413. Logs unknown errors with full stack server-side
  and a sanitized body to the client.

### Test coverage (Phase 4)

- `tests/fixtures/auth.ts` — dev-token builder and demo-tenant
  constants.
- `tests/fixtures/coa.ts` — compliant / at-risk / non-compliant COA
  payloads with deterministic compliance math.
- `tests/api/coa.routes.spec.ts` — happy-path CRUD.
- `tests/api/tenant-isolation.spec.ts` — Tenant A cannot read Tenant
  B's COAs via GET, list, or dashboard summary.
- `tests/api/rate-limit.spec.ts` — 12th Gemini call in a minute returns
  429 with reset metadata.
- `tests/unit/permissions-engine.matrix.spec.ts` — full role ×
  permission truth table.
- `tests/unit/audit-chain-persistence.spec.ts` — genesis state, link
  integrity, persistence round-trip, tenant isolation.

### Operational

- **`.github/workflows/ci.yml`** — runs `lint && test && test:unit &&
  test:api` on every push to `main`.
- **`firebaseService.ts`** — production-gated local fallback. The
  fallback path is now impossible to enable in production, even if
  `USE_LOCAL_DB_FALLBACK=true` is set.
- **`README.md`** rewritten to describe the actual layout rather than
  marketing claims. Includes module tree, security model, environment
  variables, output classifications, and known gaps.

### Test status at tag time

| Suite | Result |
|---|---|
| vitest (`npm test`) | 127 passed, 4 skipped |
| playwright unit (`npm run test:unit`) | 62 passed, 1 pre-existing failure (`VIEW_AUDIT_LOGS` permission key never defined in the engine — tracked for follow-up) |
| playwright api (`npm run test:api`) | 15 of 15 legacy tests pass. New coa / tenant-isolation / rate-limit tests currently fail with 401 — root cause investigation continues |

### Known gaps carried forward

- Real Metrc integration (per-state API contracts).
- 401 on new authenticated API tests — dev-token short-circuit is not
  being reached; root cause unidentified.
- MFA enforcement for Quality Auditor / Lab Admin roles.
- Architecture diagram image (the README module tree is the
  substitute).