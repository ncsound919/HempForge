# Implementation Plan: 6-Tool Integration into HempForge

**Date:** 2026-06-30  
**Status:** Plan (pre-implementation)  
**Scope:** Integrate mem0, ResearchClaw, BlackMind, AgentBrowser, Math X, and Data Visualization into the HempForge platform

---

## Architecture Strategy

Three integration patterns, selected per tool:

| Pattern | Description | Tools |
|---------|-------------|-------|
| **Sidecar Service** | Runs as a separate process/container; HempForge calls via HTTP/WS | mem0, ResearchClaw |
| **Library Extraction** | Copy/adapt source modules directly into HempForge's codebase | AgentBrowser (lib modules), BlackMind (engines), Math X (WASM hooks + prompts) |
| **Asset Extraction** | Copy UI components, prompt libraries, or standalone utilities | Data Visualization (shadcn/ui + codex engine) |

---

## Phase 1: Foundation Layer (Quick Wins)

**Goal:** Establish infrastructure and deliver immediate value with minimal code changes.

### 1.1 mem0 — Sidecar Memory Service

**What we're building:** A self-hosted mem0 FastAPI server with pgvector (PostgreSQL) for vector storage and Neo4j for graph memory. HempForge's agent system gets persistent multi-level memory.

**Files to create:**
- `docker-compose.mem0.yml` — Docker Compose for mem0 + PostgreSQL (pgvector) + Neo4j
- `src/lib/mem0Client.ts` — TypeScript HTTP client wrapping mem0 REST API
- `src/routes/mem0.ts` — Express router for `/api/mem0/*` endpoints
- `src/components/MemoryExplorer.tsx` — UI for viewing/searching agent memory
- `src/types/mem0.ts` — TypeScript interfaces for memory operations
- `.env.example` additions: `MEM0_API_URL`, `MEM0_API_KEY`, `MEM0_CONFIG`

**Files to modify:**
- `server.ts` — mount `mem0Router` at `/api/mem0`
- `src/agents/agentEngine.ts` — inject mem0 calls into skill execution (read memory before, write after)
- `src/agents/autonomyLoop.ts` — add memory cleanup cron
- `src/App.tsx` — add MemoryExplorer route
- `src/components/Sidebar.tsx` — add Memory nav item

**Key design decisions:**
- mem0 runs with `Qdrant` as default vector store (zero extra infrastructure for v1 — Qdrant is memory-only, embedded)
- For production, switch to `pgvector` in Docker Compose
- The Express client wraps 4 core operations: `add`, `search`, `get`, `delete`
- Memory is scoped by tenant isolation (`tenantId` → `user_id` field)
- Graph memory (Neo4j) is Phase 1.5 — skip for v1 if not needed

**Dependencies to add:**
- None (HTTP calls only — no npm package needed for v1)
- Python: `pip install mem0ai`

---

### 1.2 Data Visualization — Codex Engine + UI Components

**What we're building:** Extract the Codex scoring engine as a Python microservice and copy the 53 shadcn/ui components for HempForge to use.

**Files to create:**
- `src/services/codexService.ts` — TypeScript client calling Codex Python microservice
- `src/components/ui/` — 20-30 most useful shadcn/ui components (select, dialog, sheet, dropdown-menu, chart, tabs, tooltip, skeleton, badge, card, slider, table, accordion, etc.)
- `src/hooks/use-mobile.ts` — responsive hook
- `src/lib/utils.ts` — `cn()` utility (clsx + tailwind-merge)

**Files to modify:**
- `package.json` — add `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react` (if not present)
- `src/components/Dashboard.tsx` — optionally integrate Codex scoring for compliance KPI valuation

**Codex Engine integration** (choose one):
- **Option A (recommended):** Port the 6-metric math to TypeScript (`src/lib/codexEngine.ts`) — the formulas are pure arithmetic + sigmoid, zero Python dependency
- **Option B:** Run `codex_engine.py` as a FastAPI microservice on port 5002

---

### 1.3 Math X — WASM Computation Hooks + Prompt Library

**What we're building:** Extract the Pyodide WASM computation engine, DuckDB-Wasm hook, Plotly chart component, and the prompt library into HempForge.

**Files to create:**
- `src/workers/usePyodide.ts` — WASM Python executor hook (ported from Math X)
- `src/workers/useDuckDB.ts` — DuckDB-Wasm hook (ported from Math X)
- `src/workers/pyodide.worker.ts` — Web Worker for Pyodide execution
- `src/components/ChartView.tsx` — Plotly chart renderer (ported from Math X)
- `src/components/MathRenderer.tsx` — LaTeX + markdown renderer (ported from Math X)
- `src/lib/mathPrompts.ts` — extracted prompt library from Math X's `services/prompts.ts`
- `src/lib/domainPrompts.ts` — 10 domain specialist prompts
- `src/lib/localVectorMemory.ts` — TF-IDF vector memory for RAG
- `src/routes/mathx.ts` — Express router for `/api/mathx/*` (plan, codegen, chat, domain)

**Files to modify:**
- `package.json` — add `@duckdb/duckdb-wasm`, `plotly.js-dist-min`
- `server.ts` — mount `mathxRouter` at `/api/mathx`
- `src/vite.config.ts` — add proxy for `/api/mathx/*` if running as separate service
- `src/components/ResearchLab.tsx` or `src/components/Notebook.tsx` — integrate Pyodide-powered "Compute Cell" for in-browser Python math (COA calculations, decarb kinetics, statistical analysis)
- `src/lib/complianceEngine.ts` — add WASM-accelerated variants of `calculateDecarbKinetics` and `calculateCompliance` (runs in-browser via Pyodide instead of server-side Node)

**Key design decisions:**
- The Pyodide Web Worker is the most valuable asset — it enables **serverless scientific computing in the browser**
- The Math X Express API routes (chat, plan, codegen, domain) are optional; only extract if HempForge needs Claude-powered math reasoning
- The prompt library is pure text — copy directly, zero dependencies

---

## Phase 2: Agent Infrastructure Layer

**Goal:** Give HempForge's agent system production-grade orchestration, scheduled execution, event bus, and memory.

### 2.1 AgentBrowser — Agent Infrastructure Library

**What we're building:** Extract the pure-TypeScript agent modules from AgentBrowser and adapt them for HempForge's database layer.

**Files to create:**
- `src/lib/agentBrowsing/` (new directory):
  - `eventBus.ts` — ported from AgentBrowser `agent-event-bus.ts` — hybrid in-memory + durable event bus with 20 event types
  - `agentMemory.ts` — ported from `agent-memory.ts` — TTL-expiring KV store (adapt to Firestore or in-memory)
  - `agentScheduler.ts` — ported from `agent-scheduler.ts` — cron-based execution with cross-agent trigger chains
  - `autonomousAgents.ts` — ported from `autonomous-agents.ts` — 11 preset agent definitions + cron schedules
  - `workflowEngine.ts` — ported from `workflow-engine.ts` — 36 step types, 18 built-in workflows
  - `securityMiddleware.ts` — ported from `security-middleware.ts` — prompt injection detection, secrets scanning
  - `browserController.ts` — ported from `browser-controller.ts` — Playwright-based headless browser
  - `serviceHub.ts` — ported from `service-hub.ts` — multi-service registry with fallback chains
  - `index.ts` — barrel exports
- `src/routes/agentBrowsing.ts` — Express router for managing agents, workflows, triggers
- `src/components/AgentBrowser/` — UI:
  - `AgentBrowserDashboard.tsx` — main agent management UI
  - `WorkflowDesigner.tsx` — workflow builder
  - `AgentSchedulerPanel.tsx` — cron schedule management
  - `EventBusMonitor.tsx` — real-time event stream
  - `BrowserControlPanel.tsx` — headless browser control

**Files to modify:**
- `server.ts` — mount `agentBrowsingRouter` at `/api/agents-browser`
- `src/agents/agentEngine.ts` — optionally register AgentBrowser's event bus as additional event sink
- `src/agents/autonomyLoop.ts` — optionally use AgentBrowser's scheduler for cron jobs instead of inline cron
- `src/App.tsx` — add AgentBrowser routes
- `src/components/Sidebar.tsx` — add AgentBrowser nav items
- `package.json` — add `@playwright/test` (browser controller), `node-cron` (already present)

**Key design decisions:**
- Only extract the pure-TypeScript modules with zero Next.js dependency
- Replace `@/lib/db` (Prisma) references with HempForge's `firebaseRepo.ts` (TenantRepository) or an in-memory adapter
- The browser controller requires Playwright to be installed (`npx playwright install chromium`)
- 11 preset agent schedules can be adapted for hemp-specific tasks (e.g., "literature-digest" instead of "business-book-insights")

---

### 2.2 ResearchClaw — Autonomous Research Sidecar

**What we're building:** ResearchClaw runs as a FastAPI sidecar service. HempForge triggers research runs, monitors progress via WebSocket, and retrieves generated papers/experiments.

**Files to create:**
- `docker-compose.researchclaw.yml` — Docker Compose for ResearchClaw FastAPI server
- `researchclaw-config.yaml` — preconfigured HempForge-specific ResearchClaw config (hemp/cannabinoid domain profiles, auto-approve gates)
- `src/lib/researchClawClient.ts` — TypeScript HTTP + WebSocket client
- `src/routes/researchclaw.ts` — Express router for `/api/researchclaw/*` endpoints
- `src/components/ResearchClaw/`:
  - `ResearchPipelineDashboard.tsx` — pipeline status, stage progression
  - `LiteratureDiscoveryPanel.tsx` — literature search results display
  - `PaperViewer.tsx` — generated paper viewer
  - `ResearchChat.tsx` — WebSocket chat with ResearchClaw's dialog agent

**Files to modify:**
- `server.ts` — mount `researchClawRouter` at `/api/researchclaw`
- `src/jobs/literatureJobs.ts` — optionally delegate literature ingestion to ResearchClaw
- `src/routes/literature.ts` — add proxy endpoint to ResearchClaw's literature search
- `src/lib/literatureService.ts` — add option to use ResearchClaw as a search backend
- `src/components/ResearchLab.tsx` — add ResearchClaw pipeline panel
- `src/components/Sidebar.tsx` — add ResearchClaw nav item
- `src/App.tsx` — add ResearchClaw routes
- `.env.example` — add `RESEARCHCLAW_URL`

**Key design decisions:**
- ResearchClaw runs as a **fully separate Python service** with its own Docker container
- Communication is via REST (trigger/status/results) + WebSocket (real-time events)
- The `artifacts/` directory is a shared Docker volume for paper/experiment exchange
- HempForge preconfigures ResearchClaw with hemp-specific domain profiles and literature sources
- HITL gates (stages 5, 9, 20) are auto-approved for unattended operation, or surfaced in HempForge's workflow UI for manual approval

**Dependencies:**
- Docker + Docker Compose
- Python 3.11+ in the ResearchClaw container
- LLM API key (OpenAI, Anthropic, or Gemini) configured in ResearchClaw's config

---

## Phase 3: Scientific Intelligence Layer

**Goal:** Integrate BlackMind's engine modules to provide bioinformatics, scientific reasoning, knowledge storage, and cross-domain analytics.

### 3.1 BlackMind — Scientific Engine Modules

**What we're building:** Extract BlackMind's engine modules and import them as a TypeScript library within HempForge.

**Files to create:**
- `src/engines/blackmind/` (new directory):
  - `ScienceEngine.ts` — ported from BlackMind — unified scientific query execution (PubMed, UniProt, AlphaFold, CRISPR design, sequence analysis)
  - `BioPipelineEngine.ts` — ported — biotech pipeline orchestration (drug target, protein analysis, genomic variant)
  - `KnowledgeStore.ts` — ported — 3-tier artifact/curated/feature storage with lineage
  - `EventBus.ts` — ported — persistent event backbone with DLQ, idempotency, replay (note: may merge with AgentBrowser's event bus)
  - `WorkflowOrchestrator.ts` — ported — 5 golden-path workflows with retry
  - `CrossDomainAnalytics.ts` — ported — trend/anomaly/correlation/drift detection
  - `ScientificOutputValidator.ts` — ported — 7-type output validator
  - `BlackMindBrain.ts` — ported — observe→reason→plan→execute→learn cycle
  - `ProductionAdapters.ts` — ported — circuit breaker, exponential backoff retry, health checks
  - `ObservabilityStack.ts` — ported — logs, traces, audit, health, DLQ monitoring
  - `FreeAPIsEngine.ts` — ported — free public science APIs
  - `index.ts` — barrel exports
  - `types.ts` — extracted type definitions
- `src/routes/blackmind.ts` — Express router for `/api/blackmind/*`
- `src/components/BlackMind/`:
  - `ScienceLabPanel.tsx` — unified science query interface
  - `BioPipelineRunner.tsx` — biotech pipeline execution UI
  - `KnowledgeGraphViewer.tsx` — knowledge store browser
  - `CrossDomainAnalyticsDashboard.tsx` — analytics dashboard

**Files to modify:**
- `server.ts` — mount `blackMindRouter` at `/api/blackmind`
- `src/agents/agentEngine.ts` — add BlackMind skills: `run-science-query` (PubMed/UniProt/AlphaFold), `run-validations` (ScientificOutputValidator), `cross-domain-analysis`
- `src/jobs/literatureJobs.ts` — optionally use BlackMind's FreeAPIsEngine as additional literature source
- `src/lib/literatureService.ts` — add BlackMind's NCBI/PubMed client as alternate ingestion path
- `src/components/ResearchLab.tsx` — integrate BioPipelineRunner
- `src/App.tsx` — add BlackMind routes
- `src/components/Sidebar.tsx` — add BlackMind nav items
- `package.json` — add `@anthropic-ai/sdk`, `openai`, `@google/genai` (BlackMind's LLM SDKs, if not already present), `d3` (if using BlackMind's D3 visualizations)
- `.env.example` — add `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (optional, depending on which LLM backends BlackMind uses)

**Key design decisions:**
- BlackMind's engines are already exported as singleton classes — minimal refactoring needed
- Each engine is imported independently (no need to import the full BlackMind app)
- The React UI layer (`src/App.tsx`, `src/components/`) from BlackMind is NOT ported — only the engines and their types
- LLM dependencies are optional — engines work with any LLM backend
- BlackMind's EventBus may merge with AgentBrowser's EventBus in a later refactor (same pattern, different origins)

---

## Files Summary

### New Files Created

| # | File | Source | Phase |
|---|------|--------|-------|
| 1 | `docker-compose.mem0.yml` | New | 1 |
| 2 | `src/lib/mem0Client.ts` | New | 1 |
| 3 | `src/routes/mem0.ts` | New | 1 |
| 4 | `src/components/MemoryExplorer.tsx` | New | 1 |
| 5 | `src/types/mem0.ts` | New | 1 |
| 6 | `src/lib/codexEngine.ts` | Ported from Data Viz `codex_engine.py` | 1 |
| 7 | `src/components/ui/*` (20-30 files) | Copied from Data Viz `Tools/app/src/components/ui/` | 1 |
| 8 | `src/hooks/use-mobile.ts` | Copied from Data Viz `Tools/app/src/hooks/` | 1 |
| 9 | `src/lib/utils.ts` | Copied from Data Viz `Tools/app/src/lib/` | 1 |
| 10 | `src/workers/usePyodide.ts` | Ported from Math X `apps/web/src/workers/` | 1 |
| 11 | `src/workers/useDuckDB.ts` | Ported from Math X | 1 |
| 12 | `src/workers/pyodide.worker.ts` | New (inline worker adapted from Math X) | 1 |
| 13 | `src/components/ChartView.tsx` | Ported from Math X | 1 |
| 14 | `src/components/MathRenderer.tsx` | Ported from Math X | 1 |
| 15 | `src/lib/mathPrompts.ts` | Copy from Math X `services/prompts.ts` | 1 |
| 16 | `src/lib/domainPrompts.ts` | Copy from Math X `services/domainPrompts.ts` | 1 |
| 17 | `src/lib/localVectorMemory.ts` | Ported from Math X `state/memory.ts` | 1 |
| 18 | `src/routes/mathx.ts` | Ported from Math X `apps/api/src/routes/` | 1 |
| 19 | `src/lib/agentBrowsing/` (9 files) | Ported from AgentBrowser `src/lib/` | 2 |
| 20 | `src/routes/agentBrowsing.ts` | New (wraps lib modules) | 2 |
| 21 | `src/components/AgentBrowser/` (5 files) | New (UI for agent modules) | 2 |
| 22 | `docker-compose.researchclaw.yml` | New | 2 |
| 23 | `researchclaw-config.yaml` | New (preconfigured for hemp) | 2 |
| 24 | `src/lib/researchClawClient.ts` | New | 2 |
| 25 | `src/routes/researchclaw.ts` | New | 2 |
| 26 | `src/components/ResearchClaw/` (4 files) | New | 2 |
| 27 | `src/engines/blackmind/` (12 files) | Ported from BlackMind `src/engine/` | 3 |
| 28 | `src/routes/blackmind.ts` | New | 3 |
| 29 | `src/components/BlackMind/` (4 files) | New | 3 |

### Files Modified

| # | File | Change | Phase |
|---|------|--------|-------|
| 1 | `server.ts` | Mount 6 new routers | 1,2,3 |
| 2 | `src/agents/agentEngine.ts` | Inject mem0 calls; add BlackMind skills | 1,3 |
| 3 | `src/agents/autonomyLoop.ts` | Memory cleanup cron; optional AgentBrowser scheduler | 1,2 |
| 4 | `src/App.tsx` | Add 6 new route groups | 1,2,3 |
| 5 | `src/components/Sidebar.tsx` | Add 6 nav items | 1,2,3 |
| 6 | `src/jobs/literatureJobs.ts` | Optional ResearchClaw/BlackMind integration | 2,3 |
| 7 | `src/lib/literatureService.ts` | Add ResearchClaw + BlackMind backends | 2,3 |
| 8 | `src/lib/complianceEngine.ts` | Add WASM-accelerated variants | 1 |
| 9 | `src/components/ResearchLab.tsx` | Add ResearchClaw + BlackMind panels | 2,3 |
| 10 | `src/components/Dashboard.tsx` | Optional Codex integration | 1 |
| 11 | `src/components/Notebook.tsx` | Math X compute cell integration | 1 |
| 12 | `package.json` | Add ~10 new dependencies | 1,2,3 |
| 13 | `.env.example` | Add 8-12 new env vars | 1,2,3 |

---

## Dependency Order

```
Phase 1 ─────────────────────────────────────────────────────────────
  mem0 (sidecar)                  ─ no code deps, independent
  Data Visualization (UI copy)    ─ no code deps, independent
  Data Visualization (Codex)      ─ no code deps, independent
  Math X (WASM hooks + prompts)   ─ no code deps, independent

Phase 2 ─────────────────────────────────────────────────────────────
  AgentBrowser (lib modules)      ─ can use mem0 for agent memory
  ResearchClaw (sidecar)          ─ independent

Phase 3 ─────────────────────────────────────────────────────────────
  BlackMind (engines)             ─ can use AgentBrowser's event bus
                                  ─ can use mem0 for knowledge store persistence
```

All Phase 1 tasks are independent and can run in parallel. Phase 2 depends on Phase 1 for Platform architecture. Phase 3 depends on Phase 2 for event bus integration.

---

## Docker Compose Additions

After all phases, `docker-compose.yml` will include:

```yaml
services:
  hempforge:        # existing
  mem0:             # Phase 1 — port 8888 (FastAPI)
    depends_on: [postgres, neo4j]
  postgres:         # Phase 1 — port 8432 (pgvector)
  neo4j:            # Phase 1.5 — port 8474 (graph memory)
  researchclaw:     # Phase 2 — port 8080 (FastAPI)
```

---

## New npm Dependencies

```
# All phases combined:
clsx                    # Phase 1 (Data Viz UI)
tailwind-merge          # Phase 1 (Data Viz UI)
class-variance-authority # Phase 1 (Data Viz UI) — may already be transitive
@duckdb/duckdb-wasm     # Phase 1 (Math X)
plotly.js-dist-min      # Phase 1 (Math X)
@anthropic-ai/sdk       # Phase 3 (BlackMind) — optional
openai                  # Phase 3 (BlackMind) — optional
@google/genai           # Phase 3 (BlackMind) — optional
d3                      # Phase 3 (BlackMind) — optional
```

---

## Verification Strategy

After each phase:

1. **TypeScript check:** `npx tsc --noEmit` — zero type errors
2. **Build check:** `npm run build` — Vite + esbuild succeed
3. **Lint:** `npm run lint` — passes
4. **Existing tests pass:** `npm run test:unit && npm run test:api`
5. **New tests:** Write tests for new services/clients
6. **UI smoke test:** Load each new route, verify rendering
7. **Integration test:** HempForge agent ←→ mem0, ResearchClaw pipeline trigger, BlackMind science query

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| mem0 requires OpenAI API key for embeddings | High | Use Ollama local embeddings (nomic-embed-text) for dev; OpenAI for prod |
| ResearchClaw needs GPU for experiment execution | Medium | Start in `simulated` mode; GPU only for production use |
| BlackMind engine modules depend on LLM SDKs not in HempForge | Low | All engines work without LLMs (deterministic defaults); SDKs are optional peer deps |
| AgentBrowser P0 security issues | High | Only extract lib modules, NOT the Next.js routes; adapt security middleware with HempForge's existing auth |
| Pyodide WASM bundle is ~8MB | Low | Lazy-load from CDN; cache via service worker |
| Tool overlap (3 event buses, 2 memory systems) | Medium | Phase 3 includes a unification task: merge BlackMind EventBus with AgentBrowser EventBus |
