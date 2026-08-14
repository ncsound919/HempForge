# Plan — HempForge Phase 5+ (test parity, Metrc tests, MFA activation, v0.2.0)

## Current state (verified against `7b6b761` on `main`)

**Merged:**
- `b6f805e` — `tests/fixtures/tokens.ts` (correct Bearer + raw colon format)
- `36ee552` — `src/lib/metrcApiClient.ts`, `src/routes/metrc.ts` rewrite, `docs/architecture.md`, CI coverage + env vars
- `7b6b761` — MFA enforcement in `authMiddleware` (line 316, `MFA_REQUIRED_ROLES`)

**Verified gaps:**
1. **3 API test files still import the broken `tests/fixtures/auth.ts`** (17 sites across `coa.routes.spec.ts`, `tenant-isolation.spec.ts`, `rate-limit.spec.ts`). The new `tokens.ts` is unused. CI will still fail 401s.
2. **No Metrc route tests** — the new `/api/metrc/status`, `/packages`, `/sync`, `/labresults/:packageLabel` endpoints have no coverage. They exercise the live path (mocked) and the `503 not-configured` path.
3. **MFA gate is live but vacuous** — code is correct, but the unit test never sets `sign_in_second_factor` and there's no test for the 403 path.
4. **No test for `parseDevToken`** — the round-trip between `tokens.ts` `make()` and `backendServices.ts` `parseDevToken()` is what broke last time. Needs an explicit unit test guarding format.
5. **No v0.2.0 tag** — the merged work is materially a release, but no tag exists.
6. **Single-tenant `firestore.rules`** — already deny-all, but no test asserts a client SDK call from one tenant cannot see another. Out of scope for v0.2.0 unless the user wants it.

## What we will NOT do
- Real Metrc credentials provisioning (console action, documented in `architecture.md`)
- Firestore client-side test (requires emulator setup)
- Architecture diagram regeneration (already merged)

## Plan — 5 sequential steps, ~1 PR

### Step 1 — Migrate API tests to `tests/fixtures/tokens.ts`

**Files touched:**
- `tests/api/coa.routes.spec.ts` (5 sites)
- `tests/api/tenant-isolation.spec.ts` (5 sites)
- `tests/api/rate-limit.spec.ts` (2 sites)

**What:**
- Replace `import { tokens } from "../fixtures/auth"` with `import { tokens } from "../fixtures/tokens"`.
- Replace `tokens.demoLabAdmin()` → `tokens.labAdmin()` (returns full `Bearer dev-...` string).
- Replace `tokens.demoAuditor()` → `tokens.qualityAuditor()`.
- Replace `tokens.demoOperator()` → `tokens.operator()`.
- Replace `tokens.otherLabAdmin()` → `tokens.otherTenant()`.
- Keep `DEMO_TENANT` semantics: the old fixture used `test-tenant-demo` and `test-tenant-other`; the new fixture uses `Global-Hemp-Wilson` and `Other-Tenant-XYZ`. **Update tenant assertions in `tenant-isolation.spec.ts` accordingly** (currently asserts `body.tenantId === "test-tenant-demo"` — must change to `Global-Hemp-Wilson`, or pass `tenantId` to `labAdmin()`).

**Verification:**
```bash
npm run test:api
```
All 3 specs green; no 401s. Local DB fallback is on (env: `USE_LOCAL_DB_FALLBACK=true`).

**Exit criteria:** `npm run test:api` reports `0 failed`.

---

### Step 2 — Add unit tests for `parseDevToken` + MFA 403 path

**New files:**
- `tests/unit/auth-middleware.spec.ts`

**What:**
- Direct invocation test: import `parseDevToken` indirectly via a `getRequestHandler()` helper, OR move `parseDevToken` to a new `src/lib/devToken.ts` and re-export from `backendServices.ts` for back-compat. The latter is cleaner and keeps the parser unit-testable without spinning up Express.
- Cases:
  - `dev-uid:email:tenant:role` → parsed correctly
  - `Bearer dev-...` (with prefix) → rejected as not starting with `dev-` (test that stripping happens before parse)
  - `dev-uid:email` (only 3 parts) → null
  - `dev-:::` (empty parts) → null
- Add MFA 403 test: simulate `req.headers.authorization` with a valid non-dev token, mock `getAdminAuth().verifyIdToken` to return `{ uid, email, role: 'Lab Admin', tenantId: 'X' }` with no `firebase.sign_in_second_factor`, set `NODE_ENV=production` for the test, expect 403. This needs a vitest spec that can stub `firebase-admin/auth`. Use `vi.mock('firebase-admin/auth', ...)`.

**Files touched:**
- `src/services/backendServices.ts` — export `parseDevToken` (move logic to a small helper if needed)
- `tests/unit/auth-middleware.spec.ts` — new

**Verification:**
```bash
npm test
```
**Exit criteria:** `parseDevToken` has 4 cases, MFA 403 case passes.

---

### Step 3 — Add Metrc route tests (live mock + 503 path)

**New file:** `tests/api/metrc.routes.spec.ts`

**What:**
- `GET /api/metrc/status` with no `METRC_API_KEY` set → `{ live: false, source: "firestore-cache", ... }`.
- `GET /api/metrc/status` with all 3 env vars set → `{ live: true, source: "metrc-api-live", ... }`. Use `vi.stubEnv` to set/unset env vars for the test.
- `GET /api/metrc/packages` cached path → returns `{ source: "firestore-cache", count, packages }` with empty local DB.
- `POST /api/metrc/sync` without `METRC_API_KEY` → 503 with the documented message.
- `POST /api/metrc/sync` as Operator → 403 (role gate).
- Live path requires mocking `metrcApiClient`. Use `vi.mock('../lib/metrcApiClient', ...)` to return canned data and assert write-through to local DB.

**Files touched:**
- `tests/api/metrc.routes.spec.ts` — new (~120 lines)

**Verification:**
```bash
npm run test:api
```

**Exit criteria:** 6+ cases pass; one confirms `source: "metrc-api-live"` mock flow.

---

### Step 4 — Wire the new `tokens.ts` fixture into the unit suite, drop the old fixture

**Files touched:**
- Delete `tests/fixtures/auth.ts` once Step 1 + 2 confirm zero references.
- Any unit test that imported `auth` fixture (grep first).

**Verification:**
```bash
rg "fixtures/auth" tests
```
Should return zero matches.

**Exit criteria:** `tests/fixtures/auth.ts` removed; no dangling imports.

---

### Step 5 — Tag v0.2.0, update CHANGELOG, push

**What:**
- `CHANGELOG.md` — add a `## [0.2.0]` section listing: live Metrc client, MFA enforcement, architecture diagram, CI coverage, token fixture, 401 fix.
- `git tag -a v0.2.0 -m "v0.2.0 — live Metrc client, MFA, architecture diagram"`.
- `git push origin main --tags`.

**Files touched:**
- `CHANGELOG.md`

**Verification:**
```bash
git tag -l "v0.2*" && git log v0.2.0 --oneline -10
```

**Exit criteria:** tag visible on `origin/main`, CHANGELOG dated entry present.

---

## Dependency graph

```
Step 1 (fixture migration) ──┐
                             ├─► Step 4 (delete old fixture) ──► Step 5 (tag)
Step 2 (parseDevToken + MFA) ┘
Step 3 (Metrc tests) ─────────────────────────────────────────► Step 5
```

Steps 1, 2, 3 are independent and can run in parallel branches. Step 4 depends on 1+2. Step 5 depends on 4.

## Branch / PR strategy

- One branch: `chore/phase5-test-parity-and-v0.2.0`
- One PR, one squash-merge
- CI runs lint + vitest + playwright unit + playwright API — all must be green

## Anti-patterns to avoid
- Do not "fix" the 401 by removing auth checks — the bug was always a fixture mismatch.
- Do not add Metrc credentials to git history — they belong in a secret store.
- Do not weaken the MFA 403 to a warning — production must reject.

## Estimated effort
- Step 1: 15 min (mechanical find-replace + 1 assertion update)
- Step 2: 45 min (refactor `parseDevToken`, write 5 cases, mock `firebase-admin/auth`)
- Step 3: 60 min (6 cases, env stubbing, live-path mock)
- Step 4: 5 min
- Step 5: 10 min

Total: ~2.5 hours. Single PR.
