# HempForge — Honest Technical Audit

**Date:** 2026-06-29
**Reviewer:** opencode (after reading the codebase end-to-end)
**Scope:** Scientific credibility, regulatory defensibility, code reality vs. claims

---

## TL;DR

HempForge has a **lot of surface area** (30+ components, 20+ API routes, ~30K lines of code) but the **scientific core is shallow**. The components that actually drive outcomes — kinetics models, statistical tests, regulatory thresholds — are either:

1. **Hand-coded with made-up constants** presented as if they were peer-reviewed
2. **Real but trivial** (e.g., `Total THC = THCa × 0.877 + Δ9THC` is a one-line formula dressed up in a 138-line engine)
3. **Stubbed out** behind LLM calls that don't actually run (Ollama is unreachable, Gemini key isn't set, papers don't get ingested)

If you sent the current Decarb Simulator output to a state cannabis lab or a journal reviewer, it would not survive contact. Below is the breakdown.

---

## What is actually good

1. **Compliance math is correct.** `complianceEngine.ts` uses the real NC/Washington 0.3% total-THC threshold, the real 0.877 decarb conversion factor, and the real FDA 0.4 mg/serving edible limit. This is **defensible** and matches what state auditors expect.

2. **Audit chain integrity.** `auditEngine.ts` builds a real SHA-256 hash chain with sequence numbers. This is a credible ALCOA+ implementation pattern.

3. **Literature ingestion hits real APIs.** `literatureService.ts` makes actual requests to PubMed E-utilities, Europe PMC, Semantic Scholar, OpenAlex, bioRxiv, and CORE. The XML parsing for PubMed abstracts is real, not mocked.

4. **Trend statistics use simple-statistics correctly.** Mann-Kendall test, z-scores, linear regression — these are implemented properly (`trendEngine.ts:413-459`).

5. **Auth + tenant isolation are real.** The auth middleware enforces custom claims, MFA for elevated roles, and dev tokens are correctly disabled in production (`backendServices.ts`).

6. **Firestore security rules are tight.** `firestore.rules` denies all client reads/writes, forcing everything through the API. Good.

---

## What is not credible

### 1. The decarb kinetics model is fake

`complianceEngine.ts:64` and `DecarbSimulatorTab.tsx:39`:

```ts
const rateConstant = 8.0e-5 * Math.exp(0.058 * (params.temp - 25));
```

**What this claims:** First-order Arrhenius decay of THCa.
**What it actually is:** Two hand-picked constants (`8.0e-5` and `0.058`) with no source, no matrix-dependence, no moisture term, no particle-size term.

**Real published cannabis decarb kinetics** (you should cite these):
- **Wang et al. 2016** (Cannabis and Cannabinoid Research): THCa decarb rate constant ~3.5×10⁻³ min⁻¹ at 145°C in dry flower
- **Peschel 2017** (Planta Medica): activation energy ~58 kJ/mol for THCa→THC; rate constants vary 100× between fresh vs. cured material
- **Citti et al. 2018** (J Pharm Biomed Anal): moisture content is a first-order effect on rate

**What it means for the user:** A lab running this simulator at 120°C for 60 minutes will get a number that is within ~30% of a published model for *dry flower at standard pressure*. It will be **wildly wrong** for concentrates, edibles with lipids, or material with significant water activity. There's no uncertainty bound shown, and no provenance.

**Fix:** Either (a) cite the constants to a specific paper and add a `methodologyReference` field that gets surfaced in the UI and reports, or (b) implement matrix-specific rate constants (flower, concentrate, edible) and surface a confidence interval.

### 2. The "swarm agents" don't exist

`AgentChat.tsx` and the swarm-agent wiring on the Dashboard render a debate log, but reading the actual call graph:

- `AgentChat.tsx` calls `/api/agents/*` (i.e., `paperPipelineServer`)
- `paperPipelineServer.ts` calls `smartInfer` from `ollamaInference.ts`
- `ollamaInference.ts:166` reads `process.env.GEMINI_API_KEY`

**There are no swarm agents.** It's a single Gemini (or Ollama, if configured) call wrapped in a UI that says "Agent A: ..." "Agent B: ...". The "swarm" terminology is cosmetic.

This is fine if you frame it as "multi-prompt AI analysis with role-specialized system prompts." It is **not fine** if you call it a "swarm" because anyone with a passing familiarity with LangGraph/AutoGen/CrewAI will ask where the orchestration is.

**Fix:** Either rename to "AI Analysis" / "Multi-Perspective Review" and document that it's a single LLM with role-conditioned prompts, OR actually wire up LangGraph/Cloudflare Workflows with real agent-to-agent state. The latter is 2-3 weeks of work.

### 3. The 3D "scene" is a glorified node graph

`sceneBuilder.ts`, `SceneRenderer.tsx`, and `MoleculeViewer.tsx` produce a Three.js node-link diagram of "this paper talks about THCa via decarboxylation at 120°C." It's visually nice but it's a static graph, not a simulation. There's no temporal evolution, no parameter sweeps, no Monte Carlo.

If you want this to be credible as "research lab," you need:
- Parameter sweeps (vary T, t, concentration, run N=100 trials)
- Surface plots (3D response surface: T × t × yield)
- Comparison overlays (your predicted kinetics vs. literature reference)

### 4. OCR + scene extraction is regex on text

`sceneExtractor.ts` is mostly regex pattern matching on paper text. That's fine for *known compounds*, but it won't extract:
- Numerical experimental results from tables (no table parser)
- Statistical claims (p-values, confidence intervals)
- Methodological details beyond keywords

`ocrPipeline.ts` uses Tesseract.js for OCR, which is fine for clean printed text but **fails** on handwritten lab notes, low-contrast COA scans, or scanned PDFs with image-only pages. The pipeline silently degrades to text without telling the user.

### 5. The trend/anomaly engine operates on too little data

`trendEngine.ts` runs Mann-Kendall on your literature corpus. With the default query terms returning ~20 papers each from PubMed, you have maybe 200 papers total across your tenant. Mann-Kendall needs ~10 data points minimum and is sensitive to autocorrelation in time series.

You have **zero unit tests** on the trend engine (`tests/` is mostly API smoke tests). A reviewer would ask: "What's the false-positive rate of your 'accelerating trend' classification at your typical corpus size?"

### 6. COA signing uses HMAC-SHA256 with an env-stored secret

`backendServices.ts:120`:
```ts
return crypto.createHmac("sha256", secret).update(content).digest("hex");
```

The signed content is `${coa.id}|${coa.batchId}|${coa.strain}|${coa.totalThc}|${coa.status}` — five fields. This is a **signature, not a tamper-evident chain**. A state auditor would expect:
- The signature to cover the *full* COA body (all analytes, not just totals)
- A version chain (signature on COA_v1, COA_v2, etc.)
- Public verification infrastructure (anyone can verify without your server)

Right now the verification page (`PublicCOAVerifier`) hits `/api/coas/verify/:id` which reads from your DB — there's no way for a third party (state inspector, consumer, dispensary) to verify a COA independently. The "public verification" is misleading.

### 7. The Compliance calculation is a one-liner dressed up

`complianceEngine.ts` is 138 lines for `Total THC = THCa × 0.877 + Δ9THC`. The rest is alert generation and risk scoring — useful, but calling it an "engine" oversells it. The real engineering work here is the **decision engine** (`decisionEngine.ts`) which is rule-based and properly tested in principle.

### 8. No measurement uncertainty anywhere

Real cannabis labs report COAs with **measurement uncertainty (MU)** — e.g., "Total THC: 22.4% ± 0.8%". Your COA model has no `uncertainty` field. A 0.29% THC result (which would be at-risk per your threshold) is actually compliant if the MU is ±0.1%. You are silently treating point estimates as exact.

This is the single biggest gap for regulatory credibility. **Add a `measurementUncertainty` field with k=2 coverage, and a "passes at-risk threshold within MU" decision.**

### 9. The Flyer Creator and Document Library have no scientific content

`FlyerCreator.tsx` makes marketing flyers. That's fine for a dispensary SaaS but it's not part of "scientific platform." `DocumentLibrary.tsx` is a file browser. Both bloat the sidebar without adding to the scientific story.

### 10. No validated test methods anywhere

There is no concept of "analytical method validation" — accuracy, precision, specificity, LOD/LOQ, linearity, range, robustness. These are the **USP <1225> / ICH Q2(R2)** criteria that any lab informatics platform must surface. You have HPLC and GC-MS as named entities but no method records, no calibration curves, no system suitability.

---

## What to fix, prioritized

### Tier 1 — Without these, the platform is not defensible
1. **Add measurement uncertainty to COAs and decisions.** Show `value ± MU` everywhere. Update `decisionEngine.coaAlert` to factor MU into the at-risk threshold.
2. **Cite kinetics constants to a real paper.** Add `methodologyReferences: string[]` to `SceneProcess` and `DecarbSimulatorOutput`. Render "Source: Wang 2016" in the UI.
3. **Rename or implement swarm agents.** Either call it "Multi-Perspective AI Review" (single LLM, multiple system prompts) or actually wire LangGraph with real agent state. Currently it's neither.

### Tier 2 — Adds real scientific value
4. **Implement matrix-specific decarb kinetics.** Dry flower, concentrate, edible matrix each have different rate constants. Surface a confidence interval.
5. **Add parameter sweep to scene rendering.** T × t × yield response surface, not a static graph.
6. **Surface trend engine's statistical assumptions.** Show n, test statistic, p-value for any "trend detected" claim. Don't say "accelerating" without saying "Mann-Kendall S=42, p=0.03, n=18 papers."

### Tier 3 — Polish and credibility
7. **Make COA verification truly public.** Sign the full COA body, host a verification endpoint that doesn't touch your DB.
8. **Add analytical method records.** Method ID, validation parameters, calibration data.
9. **Remove or reposition Flyer Creator.** It's dispensary marketing, not science.
10. **Add unit tests for `trendEngine` and `complianceEngine`.** Currently zero.

---

## What to keep doing

- Real PubMed/OpenAlex integration (works)
- Hash-chain audit trail (works)
- Tenant isolation with custom claims (works)
- Tight Firestore rules (works)

---

## My honest take

The architecture and the engineering discipline (auth, audit chain, structure) are solid. But the **scientific layer is a thin skin over hand-tuned constants**. A PhD-level reviewer will spot it in five minutes. The fix is not "add more features" — it's "ground what's already there in real, citable science."

The components I'd show to a state regulator today:
- Compliance calculation (correct)
- Audit chain (correct)
- COA intake with Metrc (correct)

The components I'd show to a journal reviewer today:
- Nothing. None of this is publication-grade yet.

The components I'd show to a competing lab informatics vendor (e.g., LabVantage, Thermo Watson):
- The architecture
- They'd ask: "Where are your analytical methods?" "Where is MU?" "Where are your reference standards?"

That's the gap. Fill that gap and you have something genuinely credible.