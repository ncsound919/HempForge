# Changelog

All notable changes to HempForge are documented here.

---

## [v0.2.0] — 2026-06-29

### Auth & Security
- **MFA enforcement** — `Lab Admin` and `Quality Auditor` roles now require
  `firebase.sign_in_second_factor` on production tokens. Missing second factor
  returns `403 Forbidden` with explicit re-auth instructions.
  (`src/services/backendServices.ts`)
- **`MFA_REQUIRED_ROLES` set** defined at module level — trivially extensible
  to additional roles without touching middleware logic.

### Test Infrastructure
- **`tests/fixtures/tokens.ts`** — canonical dev-token fixture replacing
  `fixtures/auth.ts`. Correct `Bearer ` prefix, no `encodeURIComponent`,
  exact `parseDevToken()` format. Exports `tokens`, `authHeaders`, `TEST_TENANT`.
- **`tests/api/coa.routes.spec.ts`** — migrated from `fixtures/auth` →
  `fixtures/tokens`. Tenant assertion updated: `"test-tenant-demo"` →
  `TEST_TENANT` (`"Global-Hemp-Wilson"`).
- **`tests/api/tenant-isolation.spec.ts`** — migrated from `fixtures/auth` →
  `fixtures/tokens`. `tokens.otherLabAdmin()` → `tokens.otherTenant()`.
  Tenant assertion updated: `"test-tenant-other"` → `"Other-Tenant-XYZ"`.
- **`tests/unit/auth-middleware.spec.ts`** — new. 6 unit tests: token format
  contract (4 cases) + MFA enforcement logic (5 cases). Covers blocked/allowed
  paths for Lab Admin, Quality Auditor, and Operator roles.
- **`tests/api/metrc.routes.spec.ts`** — new. 7 cases: status endpoint,
  packages list, sync 401/403/503, Quality Auditor sync path.
- **`tests/fixtures/auth.ts`** — deleted. All references migrated.

### Metrc Integration
- **`src/lib/metrcApiClient.ts`** — live Metrc v2 REST client.
  `fetchMetrcPackages`, `fetchMetrcPackagesOnHold`, `fetchMetrcLabResults`,
  `normalizeMetrcPackage`, `isMetrcConfigured`. Zero side effects.
- **`src/routes/metrc.ts`** — rewritten. `GET /status` declares
  `live` vs `firestore-cache` explicitly. `GET /packages` write-through
  cache. `POST /sync` returns `503` when unconfigured (not `500`).
  New `GET /labresults/:packageLabel` endpoint.

### CI / Coverage
- **`.github/workflows/ci.yml`** — added `NODE_ENV`, `USE_LOCAL_DB_FALLBACK`,
  `COA_SIGNING_SECRET` env vars. Vitest `--coverage --reporter=verbose`.
  Coverage artifact upload (14-day retention).

### Documentation
- **`docs/architecture.md`** — Mermaid module diagram, output classification
  table, auth model, full env vars table, known gaps section.

---

## [v0.1.0] — 2026-06-29

### Architecture
- Monolith decomposed into 18 route modules under `src/routes/`
- Full domain lib layer: `trendEngine`, `provenanceEngine`, `auditEngine`,
  `complianceEngine`, `coaParser`, `ocrPipeline`, `geminiService`,
  `ollamaService`, `literatureService`, `firebaseRepo`, `permissionsEngine`,
  `reportEngine`, `paperPipelineServer`, `sceneBuilder`, `sceneExtractor`,
  `figureExporter`, `structuredLogger`
- `TenantRepository<T>` — constructor-enforced tenant scoping on all reads/writes

### Security
- Deny-all Firestore rules with per-collection overrides
- `validateStartupConfig()` — fail-fast on missing production credentials
- `extractStrictTenantAndRole()` — returns null in production for missing claims
- `parseDevToken()` — blocked in `NODE_ENV=production`
- `useLocalFallback` gate requires `NODE_ENV !== 'production'`

### Data layer
- `AuditLog` extended with `sequenceNumber`, `previousHash`, `outputClassification`
  for chain-linked ALCOA+ audit entries
- DOI + URL deduplication on literature cache saves
- `signCoa()` throws on missing `COA_SIGNING_SECRET` (no silent degradation)

### AI
- `geminiService.ts` — zero simulated fallback branches; throws on API failure
- Ollama as local inference backend (dual AI path: cloud Gemini + local Ollama)
- `provenanceEngine.ts` — 5 output classifications: `live-ai-inference`,
  `heuristic-fallback`, `deterministic-formula`, `simulated`, `demo-only`

### Testing
- Vitest + Playwright test suite: `unit/`, `api/`, `e2e/`, `fixtures/`
- Phase 4 coverage: COA routes, tenant isolation, rate limits
- GitHub Actions CI workflow

### Release
- Tagged `v0.1.0`
- README rewritten as architecture doc (module tree, security model,
  env vars, output classifications, known gaps)
