# HempForge — Architecture

## Module map

```mermaid
graph TD
  subgraph Client
    UI[React Frontend]
  end

  subgraph Server
    SRV[server.ts — Express boot]

    subgraph Routes [src/routes — 18 modules]
      R1[auth.ts]
      R2[coa.ts]
      R3[compliance.ts]
      R4[gemini.ts]
      R5[ollama.ts]
      R6[literature.ts]
      R7[metrc.ts]
      R8[audit.ts]
      R9[reports.ts]
      R10[workflows.ts]
      R11[dashboard.ts]
      R12[scheduler.ts]
      R13[csa.ts]
      R14[lims.ts]
      R15[agents.ts]
      R16[verify.ts]
      R17[health.ts]
      R18[debug.ts — dev/test only]
    end

    subgraph Middleware
      MW1[authMiddleware — Bearer + dev token]
      MW2[rateLimiter — Gemini + literature]
      MW3[validateStartupConfig — fail-fast]
    end

    subgraph Lib [src/lib — domain logic]
      L1[trendEngine.ts — Mann-Kendall, burst detection, clustering]
      L2[provenanceEngine.ts — live / heuristic / simulated / formula / demo]
      L3[auditEngine.ts — chain-linked ALCOA+ entries]
      L4[complianceEngine.ts — THC threshold, Arrhenius kinetics]
      L5[coaParser.ts — Gemini structured-output OCR]
      L6[ocrPipeline.ts — Tesseract + Gemini NLP]
      L7[geminiService.ts — live inference only, no simulation branches]
      L8[ollamaService.ts — local LLM inference]
      L9[literatureService.ts — PubMed / arXiv ingest]
      L10[metrcApiClient.ts — live Metrc v2 REST client]
      L11[firebaseRepo.ts — TenantRepository scoped reads/writes]
      L12[firebaseService.ts — Firestore + local fallback]
      L13[permissionsEngine.ts — role-based access matrix]
      L14[reportEngine.ts — document assembly]
      L15[paperPipelineServer.ts — academic paper pipeline]
    end

    subgraph Jobs [src/jobs]
      J1[literatureJobs.ts — scheduled ingest cron]
      J2[folderIndexer.ts — local document watcher]
    end
  end

  subgraph Storage
    FS[Firestore — multi-tenant, deny-all rules]
    LDB[local-db-fallback.json — dev/test only]
  end

  subgraph AI
    GM[Gemini API — cloud inference]
    OL[Ollama — local inference]
  end

  subgraph External
    MT[Metrc API — seed-to-sale]
    PB[PubMed / arXiv / CORE]
  end

  UI --> SRV
  SRV --> Routes
  Routes --> Middleware
  Routes --> Lib
  Routes --> Jobs
  Lib --> Storage
  Lib --> AI
  Lib --> External
```

## Output classification

Every AI or computed output carries an explicit `outputClassification` field:

| Value | Meaning |
|---|---|
| `live-ai-inference` | Real model call completed successfully |
| `heuristic-fallback` | Rule-based computation, no live model |
| `deterministic-formula` | Pure math (Arrhenius, THC threshold) |
| `simulated` | Explicitly mocked — dev/test only |
| `demo-only` | Seeded fixture data — never production |

## Auth model

- All protected routes require `Authorization: Bearer <token>`
- Production: Firebase ID token with `tenantId` + `role` custom claims required
- Dev/test: `Bearer dev-<uid>:<email>:<tenantId>:<role>` — blocked in `NODE_ENV=production`
- Elevated roles for privileged operations: `Lab Admin`, `Quality Auditor`
- MFA: required for `Lab Admin` and `Quality Auditor` in production (Firebase MFA policy)

## Environment variables

| Variable | Required in prod | Purpose |
|---|---|---|
| `FIREBASE_PROJECT_ID` | ✅ | Firebase project |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | ✅ | Admin SDK credentials |
| `COA_SIGNING_SECRET` | ✅ | HMAC key for COA signatures (min 32 chars) |
| `CORS_ORIGIN` | ✅ | Comma-separated allowed origins |
| `GEMINI_API_KEY` | Recommended | Gemini live inference |
| `METRC_API_KEY` | For live Metrc | Metrc vendor+user key (base64) |
| `METRC_BASE_URL` | For live Metrc | e.g. `https://api-nc.metrc.com` |
| `METRC_LICENSE_NUMBER` | For live Metrc | NC hemp license number |
| `USE_LOCAL_DB_FALLBACK` | Dev/test only | Bypasses Firestore |
| `NODE_ENV` | Always | `production` / `test` / `development` |

## Known gaps (v0.1.0)

- Real Metrc credentials not yet provisioned for production tenant
- MFA not yet enforced at the Firebase Console policy level
- No external penetration test completed
- E2E Playwright suite covers happy path only
