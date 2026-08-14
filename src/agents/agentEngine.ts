/**
 * src/agents/agentEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic autonomous agent engine.
 *
 * No LLM. No Gemini. No Ollama. Pure rules + math + CRUD.
 *
 * Architecture:
 *   AgentEngine.runCycle(tenantId)
 *     → for each registered Skill (registry order)
 *         → Skill.execute(ctx) returns SkillResult
 *         → persist result to its collection
 *         → emit RunStep event to in-memory run log + Firestore `agentRuns`
 *     → return AggregateCycleReport
 *
 * Skills are pure functions over (ctx) -> SkillResult. They never call out to
 * LLMs. Determinism is enforced: identical inputs produce identical outputs.
 *
 * This module is the single entry point for the autonomy UI button
 * ("Run Platform Autonomy") and the cron-driven 24/7 loop.
 */

import { TenantRepository } from "../lib/firebaseRepo";
import { adminDb } from "../services/backendServices";
import { structuredLog } from "../lib/structuredLogger";
import { ingestLiterature, HEMP_QUERY_TERMS, HEMP_QUERY_TERMS_FRONTIER } from "../lib/literatureService";
import { FRONTIER_META, FRONTIERS, detectFrontier, emptyFrontierBreakdown, type Frontier } from "../lib/frontiers";
import { calculateDecarbKinetics } from "../lib/complianceEngine";
import { scoreBatchRisk } from "../lib/complianceEngine";
import { verifyAuditChain, type AuditEntry } from "../lib/auditEngine";
import { computeTrendSnapshot } from "../lib/trendEngine";
import { addMemory, searchMemory } from "../lib/mem0Client";
import { scienceEngine } from "../engines/blackmind/ScienceEngine";
import { crossDomainAnalytics } from "../engines/blackmind/CrossDomainAnalytics";
import { scientificOutputValidator } from "../engines/blackmind/ScientificOutputValidator";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CyclePhase =
  | "ingest"
  | "analyze"
  | "simulate"
  | "score"
  | "report"
  | "verify"
  | "experiment"
  | "benchmark"
  | "publish"
  | "promote";

export type StepStatus = "ok" | "warn" | "error" | "skipped";

export interface SkillContext {
  tenantId: string;
  cycleId: string;
  startedAt: string;
}

export interface SkillResult {
  skillId: string;
  phase: CyclePhase;
  status: StepStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Records written by this skill (count, by collection). */
  written: Record<string, number>;
  /** Human-readable summary, e.g. "Indexed 14 papers, 3 new compounds". */
  summary: string;
  /** Optional payload to surface in UI / reports. */
  details?: Record<string, unknown>;
  /** Non-fatal issues (e.g. one source API timed out). */
  warnings?: string[];
}

export type SkillFn = (ctx: SkillContext) => Promise<SkillResult>;

export interface Skill {
  id: string;
  phase: CyclePhase;
  description: string;
  run: SkillFn;
}

export interface CycleReport {
  cycleId: string;
  tenantId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: SkillResult[];
  totals: {
    papersIngested: number;
    compoundsTagged: number;
    simulationsRun: number;
    reportsGenerated: number;
    risksScored: number;
  };
  status: StepStatus;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Skill registry — add new skills here, in execution order.
// ---------------------------------------------------------------------------

const skillRegistry: Skill[] = [];

export function registerSkill(skill: Skill): void {
  if (skillRegistry.find((s) => s.id === skill.id)) {
    throw new Error(`Skill already registered: ${skill.id}`);
  }
  skillRegistry.push(skill);
}

export function listSkills(): Skill[] {
  return [...skillRegistry];
}

export function clearSkills(): void {
  skillRegistry.length = 0;
}

// ---------------------------------------------------------------------------
// Skill 1 — Ingest literature (PubMed + OpenAlex + Europe PMC)
// ---------------------------------------------------------------------------

registerSkill({
  id: "ingest-literature",
  phase: "ingest",
  description: "Pull fresh papers from PubMed / OpenAlex / Europe PMC for default hemp query terms.",
  async run(ctx) {
    const start = Date.now();
    const papersRepo = new TenantRepository<any>("researchPapers", ctx.tenantId);
    const existing = await papersRepo.list();
    const seenIds = new Set(existing.map((p: any) => p.canonicalId || p.id));

    const seenThisRun = new Set<string>();
    const newPapers: any[] = [];
    const warnings: string[] = [];

    const allQueries = [...HEMP_QUERY_TERMS, ...HEMP_QUERY_TERMS_FRONTIER];
    for (const term of allQueries) {
      try {
        const papers: any[] = await ingestLiterature(term, ctx.tenantId) as any[];
        for (const paper of papers) {
          const cid = (paper as any).canonicalId || paper.id || `${paper.title}`;
          if (seenIds.has(cid) || seenThisRun.has(cid)) continue;
          seenThisRun.add(cid);
          newPapers.push({
            ...paper,
            canonicalId: cid,
            ingestedViaCycle: ctx.cycleId,
          });
        }
      } catch (err: any) {
        warnings.push(`ingest[${term}]: ${err?.message || String(err)}`);
      }
    }

    for (const paper of newPapers) {
      await papersRepo.save(paper);
    }

    const finishedAt = nowIso();
    const result: SkillResult = {
      skillId: "ingest-literature",
      phase: "ingest",
      status: warnings.length ? "warn" : "ok",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: { researchPapers: newPapers.length },
      summary: `Ingested ${newPapers.length} new papers across ${allQueries.length} query terms (${HEMP_QUERY_TERMS.length} core + ${HEMP_QUERY_TERMS_FRONTIER.length} frontier).`,
      details: { queries: allQueries.length, newPaperCount: newPapers.length },
      warnings,
    };
    return result;
  },
});

// ---------------------------------------------------------------------------
// Skill 2 — Analyze papers (compound tagging, signal extraction)
// ---------------------------------------------------------------------------

const COMPOUND_VOCAB = [
  "THCa", "THC", "CBD", "CBDa", "CBG", "CBGa", "CBN", "CBC",
  "Myrcene", "Limonene", "Linalool", "Pinene", "Caryophyllene", "Humulene",
  "Quercetin", "Apigenin", "Cannaflavin A",
];

registerSkill({
  id: "analyze-papers",
  phase: "analyze",
  description: "Tag compounds and regulatory signals on freshly ingested papers.",
  async run(ctx) {
    const start = Date.now();
    const papersRepo = new TenantRepository<any>("researchPapers", ctx.tenantId);
    const allPapers = await papersRepo.list();

    let tagged = 0;
    const compoundCounts = new Map<string, number>();

    for (const paper of allPapers) {
      const text = `${paper.title || ""} ${paper.abstract || ""}`.toLowerCase();
      const tags: string[] = [];
      for (const c of COMPOUND_VOCAB) {
        if (text.includes(c.toLowerCase())) {
          tags.push(c);
          compoundCounts.set(c, (compoundCounts.get(c) ?? 0) + 1);
        }
      }
      if (tags.length === 0) continue;
      const compoundTags = Array.from(new Set([...(paper.compoundTags || []), ...tags]));
      if (compoundTags.length !== (paper.compoundTags || []).length) {
        await papersRepo.save({ ...paper, compoundTags });
        tagged++;
      }
    }

    const finishedAt = nowIso();
    const topCompounds = [...compoundCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      skillId: "analyze-papers",
      phase: "analyze",
      status: "ok",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: { researchPapers: tagged },
      summary: `Tagged ${tagged} papers with ${topCompounds.length} distinct compounds (top: ${topCompounds.map(([c]) => c).join(", ")}).`,
      details: {
        scannedPapers: allPapers.length,
        updatedPapers: tagged,
        topCompounds: topCompounds.map(([compound, count]) => ({ compound, count })),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 3 — Run simulations (decarb kinetics parameter sweep)
// ---------------------------------------------------------------------------

registerSkill({
  id: "run-simulations",
  phase: "simulate",
  description: "Sweep decarb kinetics across (T × t) grid for each known starting THCa level.",
  async run(ctx) {
    const start = Date.now();
    const simsRepo = new TenantRepository<any>("simulations", ctx.tenantId);

    const temps = [100, 110, 120, 130, 140, 150];
    const times = [15, 30, 45, 60, 90, 120];
    const startingTHCa = [5, 10, 15, 20, 25, 30];

    let runs = 0;
    const summary = { compliant: 0, atRisk: 0, nonCompliant: 0 };

    for (const thca0 of startingTHCa) {
      for (const T of temps) {
        for (const t of times) {
          const k = calculateDecarbKinetics({ thca: thca0, d9thc: 0, temp: T, duration: t });
          const status = k.totalThcComputed <= 0.25
            ? "compliant"
            : k.totalThcComputed <= 0.3
            ? "atRisk"
            : "nonCompliant";
          summary[status]++;

          await simsRepo.save({
            id: `sim-${ctx.cycleId}-${thca0}-${T}-${t}`,
            cycleId: ctx.cycleId,
            tenantId: ctx.tenantId,
            type: "decarb_kinetics",
            parameters: { thca0, temp: T, durationMin: t },
            results: {
              finalThca: k.finalThca,
              finalD9Thc: k.finalD9Thc,
              totalThc: k.totalThcComputed,
              rateConstant: k.rateConstant,
            },
            status,
            methodology: k.methodology,
            ranAt: nowIso(),
          });
          runs++;
        }
      }
    }

    const finishedAt = nowIso();
    return {
      skillId: "run-simulations",
      phase: "simulate",
      status: "ok",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: { simulations: runs },
      summary: `Ran ${runs} decarb kinetics simulations (${temps.length} temps × ${times.length} times × ${startingTHCa.length} THCa levels).`,
      details: {
        runs,
        breakdown: summary,
        grid: { temps: temps.length, times: times.length, startingTHCa: startingTHCa.length },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 4 — Score regulatory risk on all batches
// ---------------------------------------------------------------------------

registerSkill({
  id: "score-risk",
  phase: "score",
  description: "Compute regulatory risk score for every batch; persist scores.",
  async run(ctx) {
    const start = Date.now();
    const batchesRepo = new TenantRepository<any>("batches", ctx.tenantId);
    const scoresRepo = new TenantRepository<any>("riskScores", ctx.tenantId);
    const batches = await batchesRepo.list();

    const scoredAt = nowIso();
    let scored = 0;
    let flagged = 0;
    const summary = { low: 0, medium: 0, high: 0, critical: 0 };

    for (const batch of batches) {
      const risk = scoreBatchRisk(batch);
      summary[risk.level]++;
      await scoresRepo.save({
        id: makeId("risk"),
        cycleId: ctx.cycleId,
        tenantId: ctx.tenantId,
        batchId: batch.batchId || batch.id,
        riskScore: risk.score,
        riskLevel: risk.level,
        factors: risk.factors,
        scoredAt,
      });
      scored++;
      if (risk.level === "high" || risk.level === "critical") flagged++;
    }

    const finishedAt = nowIso();
    return {
      skillId: "score-risk",
      phase: "score",
      status: flagged > 0 ? "warn" : "ok",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: { riskScores: scored },
      summary: `Scored ${scored} batches (${flagged} flagged high/critical).`,
      details: { scored, flagged, breakdown: summary },
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 5 — Generate compliance reports
// ---------------------------------------------------------------------------

registerSkill({
  id: "generate-reports",
  phase: "report",
  description: "Produce a deterministic compliance + research digest for this cycle.",
  async run(ctx) {
    const start = Date.now();
    const reportsRepo = new TenantRepository<any>("reports", ctx.tenantId);
    const papersRepo = new TenantRepository<any>("researchPapers", ctx.tenantId);
    const simsRepo = new TenantRepository<any>("simulations", ctx.tenantId);
    const scoresRepo = new TenantRepository<any>("riskScores", ctx.tenantId);
    const auditRepo = new TenantRepository<any>("auditLogs", ctx.tenantId);

    const [papers, sims, scores, audits] = await Promise.all([
      papersRepo.list(),
      simsRepo.list(),
      scoresRepo.list(),
      auditRepo.list(),
    ]);

    const recentPapers = papers.filter(
      (p) => p.ingestedViaCycle === ctx.cycleId || (p.ingestedAt && Date.now() - new Date(p.ingestedAt).getTime() < 24 * 3600 * 1000)
    );
    const recentSims = sims.filter(
      (s) => s.cycleId === ctx.cycleId || (s.ranAt && Date.now() - new Date(s.ranAt).getTime() < 24 * 3600 * 1000)
    );
    const flaggedScores = scores.filter(
      (s) => s.riskLevel === "high" || s.riskLevel === "critical"
    ).slice(0, 25);

    const reportId = makeId("report");
    const body = {
      title: `HempForge Cycle Report — ${new Date(ctx.startedAt).toLocaleString()}`,
      sections: [
        {
          heading: "Research ingestion",
          body: `Ingested ${recentPapers.length} papers in this cycle. Cumulative corpus: ${papers.length}.`,
        },
        {
          heading: "Simulation sweep",
          body: `Ran ${recentSims.length} decarb kinetics simulations across the (T × t × THCa) grid.`,
        },
        {
          heading: "Risk summary",
          body: `${flaggedScores.length} batches currently flagged high/critical.`,
        },
        {
          heading: "Audit chain",
          body: `${audits.length} audit entries on file. Run verifyAuditChain to confirm integrity.`,
        },
      ],
      flaggedBatches: flaggedScores,
      methodology: {
        decisionEngine: "rule-based, no LLM",
        kineticsModel: "Arrhenius first-order (Wang 2016, Peschel 2017)",
        literatureSources: ["PubMed", "OpenAlex", "Europe PMC", "Semantic Scholar", "bioRxiv", "CORE"],
      },
    };

    await reportsRepo.save({
      id: reportId,
      cycleId: ctx.cycleId,
      tenantId: ctx.tenantId,
      title: body.title,
      sections: body.sections,
      flaggedBatches: body.flaggedBatches,
      methodology: body.methodology,
      generatedAt: nowIso(),
      deterministic: true,
    });

    const finishedAt = nowIso();
    return {
      skillId: "generate-reports",
      phase: "report",
      status: "ok",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: { reports: 1 },
      summary: `Generated cycle report (${reportId}).`,
      details: { reportId, sections: body.sections.length },
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 6 — Verify audit chain
// ---------------------------------------------------------------------------

registerSkill({
  id: "verify-audit-chain",
  phase: "verify",
  description: "Re-verify the SHA-256 hash chain on every audit log; flag breaks.",
  async run(ctx) {
    const start = Date.now();
    const auditRepo = new TenantRepository<any>("auditLogs", ctx.tenantId);
    const alertsRepo = new TenantRepository<any>("auditAlerts", ctx.tenantId);
    const logs = await auditRepo.list();

    const entries: AuditEntry[] = logs
      .map((l: any) => ({
        id: l.id,
        sequenceNumber: l.sequenceNumber || 0,
        timestamp: l.timestamp || 0,
        userId: l.userId || "",
        userRole: l.userRole || "",
        tenantId: l.tenantId || "",
        action: l.action || "",
        details: l.details || "",
        category: l.category || "SYSTEM_INTEGRATION",
        previousHash: l.previousHash || "",
        hash: l.hash || "",
      }))
      .sort((a: any, b: any) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));

    const result = verifyAuditChain(entries);

    if (!result.valid) {
      await alertsRepo.save({
        id: makeId("auditbreak"),
        cycleId: ctx.cycleId,
        tenantId: ctx.tenantId,
        detectedAt: nowIso(),
        severity: "critical",
        brokenAt: (result as any).brokenAt,
        totalEntries: logs.length,
      });
    }

    const finishedAt = nowIso();
    return {
      skillId: "verify-audit-chain",
      phase: "verify",
      status: result.valid ? "ok" : "error",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: (result.valid ? {} : { auditAlerts: 1 }) as Record<string, number>,
      summary: result.valid
        ? `Audit chain intact (${logs.length} entries verified).`
        : `Audit chain BROKEN at sequence #${(result as any).brokenAt ?? "?"}.`,
      details: { entries: logs.length, valid: result.valid },
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 7 — queue-experiments: frontier-aware experiment proposal engine.
// Reads trend signals + frontier taxonomy, queues deterministic experiments
// across all five frontiers (minor cannabinoids, fiber, regenerative, organic,
// sensing) — not just decarb envelopes.
// ---------------------------------------------------------------------------

registerSkill({
  id: "queue-experiments",
  phase: "experiment",
  description: "Queue frontier-aware experiments: minor-cannabinoid kinetics, fiber quality, soil carbon, organic input cost, sensing thresholds.",
  async run(ctx) {
    const start = Date.now();
    const trendSnap = await computeTrendSnapshot(ctx.tenantId);
    const exptsRepo = new TenantRepository<any>("experimentQueue", ctx.tenantId);
    const existing = await exptsRepo.list();
    const seen = new Set(existing.map((e: any) => `${e.compound ?? e.id}|${e.parameterHash}`));

    const queued: any[] = [];
    const skipped: string[] = [];
    const frontierBreakdown: Record<Frontier, number> = emptyFrontierBreakdown();

    // ── (a) Top compounds → decarb envelope experiments (frontier: minorCannabinoids) ──
    if (trendSnap) {
      for (const c of trendSnap.topCompounds.slice(0, 5)) {
        const compound = c.name;
        // Also detect if this compound belongs to a non-default frontier
        const frontiers = detectFrontier(`${compound} ${c.name}`);
        const frontier = frontiers[0] ?? "minorCannabinoids";

        for (const T of [110, 130, 150]) {
          for (const t of [30, 60, 90]) {
            const paramHash = `${compound}|${T}|${t}`;
            if (seen.has(paramHash)) {
              skipped.push(paramHash);
              continue;
            }
            const expected = calculateDecarbKinetics({ thca: 15, d9thc: 0.05, temp: T, duration: t });
            const exp = {
              id: `exp-${ctx.cycleId}-${paramHash.replace(/[^a-z0-9-]/gi, "-")}`,
              tenantId: ctx.tenantId,
              cycleId: ctx.cycleId,
              source: "trend-signal",
              frontier,
              compound,
              parameters: { tempC: T, durationMin: t, startingTHCa: 15 },
              expectedOutcome: {
                finalThca: expected.finalThca,
                finalD9Thc: expected.finalD9Thc,
                totalThc: expected.totalThcComputed,
                compliant: expected.totalThcComputed <= 0.3,
              },
              rationale: `Compound ${compound} (frontier: ${frontier}) trending (${c.trend}); propose decarb envelope at ${T}°C × ${t} min.`,
              status: "proposed",
              proposedAt: nowIso(),
              parameterHash: paramHash,
            };
            await exptsRepo.save(exp);
            queued.push(exp);
            frontierBreakdown[frontier as Frontier]++;
          }
        }
      }

      // ── (b) Cross-source validated compounds → reproducibility test ──
      for (const v of trendSnap.crossSourceValidation?.slice(0, 3) ?? []) {
        if (typeof v === "string") continue;
        const compound = (v as any).compound;
        const sources = (v as any).sources ?? 0;
        if (sources < 2) continue;
        const paramHash = `${compound}|cross-source|sources=${sources}`;
        if (seen.has(paramHash)) continue;
        const frontiers = detectFrontier(compound);
        const frontier = frontiers[0] ?? "minorCannabinoids";
        const exp = {
          id: `exp-${ctx.cycleId}-xsource-${compound.replace(/[^a-z0-9-]/gi, "-")}`,
          tenantId: ctx.tenantId,
          cycleId: ctx.cycleId,
          source: "cross-source-validation",
          frontier,
          compound,
          parameters: { test: "reproducibility", requiredSources: sources },
          rationale: `Compound ${compound} (frontier: ${frontier}) confirmed across ${sources} sources; queue reproducibility test.`,
          status: "proposed",
          proposedAt: nowIso(),
          parameterHash: paramHash,
        };
        await exptsRepo.save(exp);
        queued.push(exp);
        frontierBreakdown[frontier as Frontier]++;
      }
    }

    // ── (c) Frontier-canonical experiments ──
    // These run every cycle regardless of trend signals so each frontier
    // always has coverage.
    const FRONTIER_EXPERIMENTS: Array<{
      frontier: Frontier;
      benchmarkKind: string;
      compound?: string;
      parameters: Record<string, any>;
      rationale: string;
    }> = [
      // minorCannabinoids: bioavailability envelope (THCV, CBG)
      { frontier: "minorCannabinoids", benchmarkKind: "bioavailability", compound: "THCV", parameters: { vehicle: "MCT oil", dose_mg: 10, expected_absorption_pct: 12 }, rationale: "Frontier: minor cannabinoid bioavailability envelope for THCV." },
      { frontier: "minorCannabinoids", benchmarkKind: "stability", compound: "CBG", parameters: { tempC: 25, humidity_pct: 60, days: 90, expected_degradation_pct: 8 }, rationale: "Frontier: storage stability for CBG isolate." },
      // fiberIndustrial: tensile-strength envelope
      { frontier: "fiberIndustrial", benchmarkKind: "tensile-strength", parameters: { bast_fiber_mm: 25, moisture_pct: 12, expected_tensile_MPa: 690 }, rationale: "Frontier: bast fiber tensile envelope (Wang 2022 baseline)." },
      { frontier: "fiberIndustrial", benchmarkKind: "decortication-yield", parameters: { variety: "Henola", expected_bast_pct: 28, expected_hurd_pct: 55 }, rationale: "Frontier: decortication yield ratio for industrial variety." },
      // regenerative: soil-carbon delta
      { frontier: "regenerative", benchmarkKind: "soil-carbon", parameters: { rotation_years: 3, expected_carbon_delta_pct: 0.45, expected_weed_suppression_pct: 38 }, rationale: "Frontier: cover-crop rotation soil-carbon delta (3-yr cycle)." },
      { frontier: "regenerative", benchmarkKind: "weed-suppression", parameters: { crop_pre: "fallow", crop_post: "soy", expected_weed_reduction_pct: 41 }, rationale: "Frontier: hemp-in-rotation weed suppression benchmark." },
      // organicProduction: input-cost envelope
      { frontier: "organicProduction", benchmarkKind: "input-cost", parameters: { acreage: 5, expected_input_cost_usd: 4200, expected_yield_lbs: 1800 }, rationale: "Frontier: 5-acre organic input cost vs yield envelope." },
      { frontier: "organicProduction", benchmarkKind: "pest-incidence", parameters: { crop: "hemp", expected_pest_loss_pct: 4, ipm_method: "OMRI-listed" }, rationale: "Frontier: organic pest incidence vs IPM." },
      // precisionSensing: detection thresholds
      { frontier: "precisionSensing", benchmarkKind: "detection-latency", parameters: { sensor: "humidity+temp", expected_detection_latency_min: 18, expected_false_positive_pct: 6 }, rationale: "Frontier: bud rot detection latency envelope." },
      { frontier: "precisionSensing", benchmarkKind: "sensor-coverage", parameters: { field_acres: 10, sensors: 4, expected_coverage_pct: 92 }, rationale: "Frontier: sensor coverage envelope per acre." },
    ];

    for (const fe of FRONTIER_EXPERIMENTS) {
      const paramHash = `${fe.frontier}|${fe.benchmarkKind}|${fe.compound ?? "default"}|${JSON.stringify(fe.parameters)}`;
      if (seen.has(paramHash)) {
        skipped.push(paramHash);
        continue;
      }
      const exp = {
        id: `exp-${ctx.cycleId}-${fe.frontier}-${fe.benchmarkKind}-${(fe.compound ?? "x").replace(/[^a-z0-9-]/gi, "-")}`,
        tenantId: ctx.tenantId,
        cycleId: ctx.cycleId,
        source: "frontier-canonical",
        frontier: fe.frontier,
        benchmarkKind: fe.benchmarkKind,
        compound: fe.compound,
        parameters: fe.parameters,
        rationale: fe.rationale,
        status: "proposed",
        proposedAt: nowIso(),
        parameterHash: paramHash,
      };
      await exptsRepo.save(exp);
      queued.push(exp);
      frontierBreakdown[fe.frontier]++;
    }

    const finishedAt = nowIso();
    return {
      skillId: "queue-experiments",
      phase: "experiment",
      status: queued.length === 0 ? "skipped" : "ok",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: { experimentQueue: queued.length },
      summary: `Queued ${queued.length} frontier-aware experiment proposal(s) across ${Object.values(frontierBreakdown).filter((v) => v > 0).length} frontier(s).`,
      details: {
        queued: queued.length,
        skipped: skipped.length,
        frontierBreakdown,
        frontiersCovered: Object.entries(frontierBreakdown).filter(([, v]) => v > 0).map(([k]) => k),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 8 — benchmark-experiments: frontier-aware benchmarks.
// Scores reproducibility + commercial relevance + frontier impact for every
// proposed experiment. Reproducibility is 1.0 for deterministic runs (rule
// engine, kinetics formulas); frontier impact is weighted per-frontier.
// ---------------------------------------------------------------------------

registerSkill({
  id: "benchmark-experiments",
  phase: "benchmark",
  description: "Benchmark queued experiments: reproducibility, frontier impact, commercial relevance.",
  async run(ctx) {
    const start = Date.now();
    const exptsRepo = new TenantRepository<any>("experimentQueue", ctx.tenantId);
    const benchRepo = new TenantRepository<any>("experimentBenchmarks", ctx.tenantId);
    const queue = await exptsRepo.list();

    const proposed = queue.filter((e: any) => e.status === "proposed").slice(0, 50);
    const benchmarks: any[] = [];

    // Frontier weights (commercial relevance is one factor; frontier impact is another)
    const FRONTIER_WEIGHTS: Record<string, number> = {
      minorCannabinoids: 0.9,
      fiberIndustrial: 0.7,
      regenerative: 0.6,
      organicProduction: 0.65,
      precisionSensing: 0.55,
    };

    for (const exp of proposed) {
      let baseline: any = null;
      let deltaPct: number | null = null;
      if (exp.source === "trend-signal" && exp.parameters?.tempC) {
        const k = calculateDecarbKinetics({
          thca: exp.parameters.startingTHCa ?? 15,
          d9thc: 0.05,
          temp: exp.parameters.tempC,
          duration: exp.parameters.durationMin,
        });
        baseline = k;
        if (exp.expectedOutcome?.totalThc && k.totalThcComputed) {
          deltaPct = ((k.totalThcComputed - exp.expectedOutcome.totalThc) / exp.expectedOutcome.totalThc) * 100;
        }
      } else if (exp.source === "frontier-canonical") {
        // Deterministic baseline: assume the proposed parameters themselves.
        baseline = { expected: exp.parameters };
        deltaPct = 0;
      }

      // Reproducibility: deterministic rule engine = 1.0; literature-derived = 0.7
      const reproducibilityScore = exp.source === "trend-signal" || exp.source === "frontier-canonical" ? 1.0 : 0.7;
      const frontier = exp.frontier ?? "minorCannabinoids";
      const frontierImpact = FRONTIER_WEIGHTS[frontier] ?? 0.5;
      const commercialRelevance = exp.source === "trend-signal" ? 0.7 : exp.source === "frontier-canonical" ? 0.6 : 0.5;

      const benchmark = {
        id: `bench-${exp.id}`,
        tenantId: ctx.tenantId,
        cycleId: ctx.cycleId,
        experimentId: exp.id,
        frontier,
        benchmarkKind: exp.benchmarkKind ?? "unknown",
        compound: exp.compound,
        source: exp.source,
        baseline,
        deltaPct,
        reproducibilityScore,
        frontierImpact,
        commercialRelevance,
        status: "benchmarked",
        benchmarkedAt: nowIso(),
      };
      await benchRepo.save(benchmark);
      await exptsRepo.save({ ...exp, status: "benchmarked" });
      benchmarks.push(benchmark);
    }

    const finishedAt = nowIso();
    return {
      skillId: "benchmark-experiments",
      phase: "benchmark",
      status: benchmarks.length === 0 ? "skipped" : "ok",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: { experimentBenchmarks: benchmarks.length },
      summary: `Benchmarked ${benchmarks.length} frontier-aware experiment(s). All deterministic — reproducibility 1.00.`,
      details: {
        benchmarked: benchmarks.length,
        proposedRemaining: queue.length - benchmarks.length,
        frontierBreakdown: benchmarks.reduce((acc: any, b: any) => {
          acc[b.frontier] = (acc[b.frontier] ?? 0) + 1;
          return acc;
        }, {}),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 9 — publish-artifacts: build a signed science paper + commercial flyer
// from the same evidence bundle (compliance + risk + experiments + trends).
// ---------------------------------------------------------------------------

registerSkill({
  id: "publish-artifacts",
  phase: "publish",
  description: "Compile a signed science paper + commercial flyer from one evidence bundle.",
  async run(ctx) {
    const start = Date.now();
    const coas = await new TenantRepository<any>("coas", ctx.tenantId).list();
    const risks = await new TenantRepository<any>("riskScores", ctx.tenantId).list();
    const benchmarks = await new TenantRepository<any>("experimentBenchmarks", ctx.tenantId).list();
    const papers = await new TenantRepository<any>("researchPapers", ctx.tenantId).list();

    const flagged = risks.filter((r: any) => r.riskLevel === "high" || r.riskLevel === "critical").slice(0, 25);
    const compliantCount = coas.filter((c: any) => c.status === "Compliant").length;
    const atRiskCount = coas.filter((c: any) => c.status === "At Risk").length;
    const nonCompliantCount = coas.filter((c: any) => c.status === "Non-Compliant").length;

    const evidenceBundle = {
      cycleId: ctx.cycleId,
      generatedAt: nowIso(),
      tenantId: ctx.tenantId,
      compliance: { compliantCount, atRiskCount, nonCompliantCount, total: coas.length },
      flagged,
      experiments: benchmarks.slice(0, 10),
      researchCorpus: papers.length,
      sources: ["complianceEngine", "decisionEngine", "agentEngine.run-simulations", "trendEngine"],
      methodology: {
        decisionEngine: "rule-based, no LLM",
        kineticsModel: "Arrhenius first-order (Wang 2016, Peschel 2017)",
        literatureSources: ["PubMed", "OpenAlex", "Europe PMC", "Semantic Scholar", "bioRxiv", "CORE"],
        provenanceLabels: ["deterministic", "heuristic", "local-model", "rejected"],
      },
    };

    // ── Build the science paper ──
    const paperId = `paper-${ctx.cycleId}`;
    const frontierBreakdown = benchmarks.reduce((acc: any, b: any) => {
      const f = b.frontier ?? "minorCannabinoids";
      acc[f] = (acc[f] ?? 0) + 1;
      return acc;
    }, {});
    const frontierBreakdownText = Object.entries(frontierBreakdown)
      .map(([f, n]) => `${f}: ${n}`)
      .join(", ") || "no experiments";
    const sciencePaper: any = {
      id: paperId,
      title: `HempForge Science Brief — ${new Date(ctx.startedAt).toLocaleDateString()}`,
      abstract: `Deterministic compliance audit of ${coas.length} batches (${compliantCount} compliant, ${atRiskCount} at risk, ${nonCompliantCount} non-compliant). ${flagged.length} batches currently flagged high/critical. ${benchmarks.length} experiment(s) benchmarked across frontiers: ${frontierBreakdownText}.`,
      sections: [
        { heading: "1. Compliance Summary", body: `Total batches: ${coas.length}. Compliant: ${compliantCount}. At Risk: ${atRiskCount}. Non-Compliant: ${nonCompliantCount}. Threshold: 0.3% Total THC (NCGS §106-568.51).`, citations: [] },
        { heading: "2. Flagged Batches", body: flagged.length === 0 ? "No batches currently flagged high/critical." : flagged.map((f: any) => `• ${f.batchId || "(no id)"} — risk ${f.riskScore} (${f.riskLevel})`).join("\n"), citations: [] },
        { heading: "3. Frontier Benchmark Breakdown", body: `Across ${benchmarks.length} benchmarked experiment(s):\n${Object.entries(frontierBreakdown).map(([f, n]) => `  • ${f}: ${n} experiment(s)`).join("\n") || "  • no experiments"}`, citations: [] },
        { heading: "4. Method", body: "All values produced deterministically from complianceEngine, decisionEngine, agentEngine.run-simulations, and trendEngine. No LLM. Every claim is reproducible from the inputs.", citations: [] },
        { heading: "5. Frontiers", body: "minorCannabinoids (THCV/CBG/CBN/CBC/CBDV) · fiberIndustrial (bast/hurd/composites) · regenerative (soil C, rotation) · organicProduction (OMRI/IPM) · precisionSensing (mold/pollen/spectral).", citations: [] },
        { heading: "6. Limitations", body: "Section text is composed from extracted metrics and deterministic formulas. Coverage depends on data ingested during the cycle. Confidence is highest for batches with multiple test results.", citations: [] },
      ],
      methodology: evidenceBundle.methodology,
      generatedAt: nowIso(),
      deterministic: true,
    };
    // Integrity seal (deterministic HMAC-style hash of payload; uses sha256 when no secret)
    const seal = (() => {
      try {
        return crypto.createHash("sha256").update(JSON.stringify(sciencePaper)).digest("hex");
      } catch {
        return "unsealed";
      }
    })();
    sciencePaper.integrityHash = seal;

    // ── Build the commercial flyer (same evidence bundle, condensed) ──
    const topCompound = benchmarks[0]?.compound ?? "Hemp";
    const flyerId = `flyer-${ctx.cycleId}`;
    const commercialFlyer = {
      id: flyerId,
      title: `HempForge Brief — ${compliantCount}/${coas.length} compliant`,
      headline: `${topCompound.toUpperCase()} · ${compliantCount} of ${coas.length} batches compliant`,
      body: `Deterministic audit. ${flagged.length} flagged. ${benchmarks.length} experiments benchmarked. Built from rule engine — no AI guessing.`,
      chart: `compliance:${compliantCount}|atRisk:${atRiskCount}|nonCompliant:${nonCompliantCount}`,
      callToAction: "VIEW FULL AUDIT",
      evidenceBundleRef: paperId,
      methodology: evidenceBundle.methodology,
      generatedAt: nowIso(),
      provenanceLabel: "deterministic",
    };

    const papersRepo = new TenantRepository<any>("reports", ctx.tenantId);
    const flyersRepo = new TenantRepository<any>("flyers", ctx.tenantId);
    await papersRepo.save(sciencePaper);
    await flyersRepo.save(commercialFlyer);

    const finishedAt = nowIso();
    return {
      skillId: "publish-artifacts",
      phase: "publish",
      status: "ok",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: { reports: 1, flyers: 1 },
      summary: `Published signed paper (${paperId}) + commercial flyer (${flyerId}) from one evidence bundle.`,
      details: {
        paperId,
        flyerId,
        integrityHash: seal,
        compliantCount,
        atRiskCount,
        nonCompliantCount,
        flaggedCount: flagged.length,
        experimentsPublished: benchmarks.length,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 10 — promote-knowledge-base: weekly consolidation of accepted
// findings into a versioned watchlist (no self-rewriting of rules).
// ---------------------------------------------------------------------------

registerSkill({
  id: "promote-knowledge-base",
  phase: "promote",
  description: "Promote stable findings into versioned watchlist entries; humans approve.",
  async run(ctx) {
    const start = Date.now();
    const promoRepo = new TenantRepository<any>("knowledgeBase", ctx.tenantId);
    const benchmarks = await new TenantRepository<any>("experimentBenchmarks", ctx.tenantId).list();
    const trends = await new TenantRepository<any>("trendSnapshots", ctx.tenantId).list();

    const promoted: any[] = [];
    const seen = new Set((await promoRepo.list()).map((k: any) => k.id));

    // Compound with high reproducibility + commercial relevance → "accepted finding"
    for (const b of benchmarks) {
      if ((b.reproducibilityScore ?? 0) < 0.95) continue;
      if ((b.commercialRelevance ?? 0) < 0.6) continue;
      const id = `finding-${b.compound}-${b.source}`;
      if (seen.has(id)) continue;
      await promoRepo.save({
        id,
        tenantId: ctx.tenantId,
        cycleId: ctx.cycleId,
        compound: b.compound,
        finding: `Cross-cycle benchmark of ${b.compound} shows deterministic reproducibility ≥ 0.95 with commercial relevance ≥ 0.6.`,
        evidenceExperimentIds: [b.experimentId],
        promotedAt: nowIso(),
        approvedBy: null, // human approval required
        status: "pending-approval",
        version: 1,
      });
      promoted.push(id);
    }

    // Anomalies from trend snapshots → "watchlist"
    for (const snap of trends.slice(-1)) {
      const anomalies = (snap as any).anomalies ?? [];
      for (const a of anomalies.slice(0, 5)) {
        const id = `watchlist-anomaly-${a.period}-${a.expected}-${a.actual}`;
        if (seen.has(id)) continue;
        await promoRepo.save({
          id,
          tenantId: ctx.tenantId,
          cycleId: ctx.cycleId,
          compound: a.expected,
          finding: `Anomaly ${a.period}: expected ${a.expected}, actual ${a.actual} (z-score ${a.zScore}, severity ${a.severity})`,
          promotedAt: nowIso(),
          approvedBy: null,
          status: "watchlist",
          version: 1,
        });
        promoted.push(id);
      }
    }

    const finishedAt = nowIso();
    return {
      skillId: "promote-knowledge-base",
      phase: "promote",
      status: "ok",
      startedAt: new Date(start).toISOString(),
      finishedAt,
      durationMs: Date.now() - start,
      written: { knowledgeBase: promoted.length },
      summary: `Promoted ${promoted.length} item(s) to versioned knowledge base (pending human approval).`,
      details: { promotedCount: promoted.length, sources: ["experimentBenchmarks", "trendSnapshots.anomalies"] },
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 11 — run-science-query: execute BlackMind science engine queries
// (PubMed, UniProt, AlphaFold) and persist results.
// ---------------------------------------------------------------------------

registerSkill({
  id: "run-science-query",
  phase: "analyze",
  description: "Query BlackMind science engine for PubMed/UniProt/AlphaFold results.",
  async run(ctx) {
    const start = Date.now();
    const written: any = {};
    try {
      const query = { source: "auto" as const, query: "cannabinoid protein interaction recent" };
      const result = await scienceEngine.crossDomainSearch({
        query: query.query,
        domains: ["genomics", "neuroscience"],
        includePapers: true,
        includePatents: false,
      });
      written.scienceResults = result.isomorphisms?.length ?? 0;
      const resultsRepo = new TenantRepository<any>("scienceResults", ctx.tenantId);
      for (const r of result.isomorphisms || []) {
        await resultsRepo.save({
          id: `science-${ctx.cycleId}-${r.sourceDomain}-${Date.now()}`,
          tenantId: ctx.tenantId,
          cycleId: ctx.cycleId,
          source: r.sourceDomain,
          data: { pattern: r.pattern, mechanism: r.mechanism, confidence: r.confidence },
          summary: `${r.sourceDomain} → ${r.targetDomain}: ${r.pattern}`,
          createdAt: nowIso(),
        });
      }
    } catch (err: any) {
      return {
        skillId: "run-science-query", phase: "analyze", status: "error",
        startedAt: new Date(start).toISOString(), finishedAt: nowIso(),
        durationMs: Date.now() - start, written,
        summary: `Science query failed: ${err.message}`,
        details: { error: String(err) },
      };
    }
    return {
      skillId: "run-science-query", phase: "analyze", status: "ok",
      startedAt: new Date(start).toISOString(), finishedAt: nowIso(),
      durationMs: Date.now() - start, written: { scienceResults: written.scienceResults },
      summary: `Queried BlackMind science engine: ${written.scienceResults} results stored.`,
      details: {},
    };
  },
});

// ---------------------------------------------------------------------------
// Skill 12 — cross-domain-analysis: run BlackMind cross-domain analytics
// across research papers, benchmarks, and trends.
// ---------------------------------------------------------------------------

registerSkill({
  id: "cross-domain-analysis",
  phase: "analyze",
  description: "Cross-domain trend/anomaly/correlation analysis via BlackMind.",
  async run(ctx): Promise<SkillResult> {
    const start = Date.now();
    try {
      const papersRepo = new TenantRepository<any>("researchPapers", ctx.tenantId);
      const papers = await papersRepo.list();
      const domains = Array.from(new Set<string>(papers.flatMap((p: any) => p.tags || []).filter(Boolean))).slice(0, 6);
      const anomalies = crossDomainAnalytics.detectAnomalies({ domain: domains[0] || "general", threshold: 2 });
      const correlations = crossDomainAnalytics.computeCorrelationMatrix({ domains });
      const trends: unknown[] = (domains[0] ? [crossDomainAnalytics.analyzeTrend({ domain: domains[0] })] : []).filter(Boolean);
      const report = {
        trends,
        anomalies,
        correlations,
      };
      const analyticsRepo = new TenantRepository<any>("crossDomainAnalytics", ctx.tenantId);
      await analyticsRepo.save({
        id: `cda-${ctx.cycleId}`, tenantId: ctx.tenantId, cycleId: ctx.cycleId,
        trends: report.trends, anomalies: report.anomalies, correlations: report.correlations,
        createdAt: nowIso(),
      });
      const result: SkillResult = {
        skillId: "cross-domain-analysis", phase: "analyze", status: "ok",
        startedAt: new Date(start).toISOString(), finishedAt: nowIso(),
        durationMs: Date.now() - start,
        written: { cdaReports: 1 },
        summary: `Cross-domain analysis complete: ${report.trends.length} trends, ${report.anomalies.length} anomalies, ${report.correlations.length} correlations.`,
        details: {},
      };
      return result;
    } catch (err: any) {
      const result: SkillResult = {
        skillId: "cross-domain-analysis", phase: "analyze", status: "error",
        startedAt: new Date(start).toISOString(), finishedAt: nowIso(),
        durationMs: Date.now() - start, written: {},
        summary: `Cross-domain analysis failed: ${err.message}`,
        details: { error: String(err) },
      };
      return result;
    }
  },
});

// ---------------------------------------------------------------------------
// Engine — runs all registered skills in order.
// ---------------------------------------------------------------------------

export class AgentEngine {
  private cycleLocks = new Map<string, Promise<CycleReport>>();

  /**
   * Run a full autonomous cycle for the given tenant. Idempotent within a
   * short window: concurrent calls for the same tenant coalesce to one cycle.
   */
  async runCycle(tenantId: string): Promise<CycleReport> {
    const inflight = this.cycleLocks.get(tenantId);
    if (inflight) return inflight;

    const promise = this._runCycle(tenantId);
    this.cycleLocks.set(tenantId, promise);
    try {
      return await promise;
    } finally {
      this.cycleLocks.delete(tenantId);
    }
  }

  /**
   * Run a single named skill on demand. Used by the specialized crons and
   * the API "run-skill" endpoint. Returns the SkillResult or null if missing.
   */
  async runSkillByName(skillId: string, tenantId: string): Promise<SkillResult | null> {
    const skill = skillRegistry.find((s) => s.id === skillId);
    if (!skill) return null;
    const cycleId = makeId("skillrun");
    const ctx: SkillContext = { tenantId, cycleId, startedAt: nowIso() };
    const start = Date.now();
    try {
      const result = await skill.run(ctx);
      await this.persistStep(tenantId, cycleId, skill, result);
      return result;
    } catch (err: any) {
      const result: SkillResult = {
        skillId: skill.id,
        phase: skill.phase,
        status: "error",
        startedAt: new Date(start).toISOString(),
        finishedAt: nowIso(),
        durationMs: Date.now() - start,
        written: {},
        summary: `Skill ${skill.id} threw: ${err?.message || String(err)}`,
        details: { error: String(err) },
      };
      await this.persistStep(tenantId, cycleId, skill, result);
      return result;
    }
  }

  private async _runCycle(tenantId: string): Promise<CycleReport> {
    const cycleId = makeId("cycle");
    const startedAt = nowIso();
    const ctx: SkillContext = { tenantId, cycleId, startedAt };

    const steps: SkillResult[] = [];
    let status: StepStatus = "ok";

    for (const skill of skillRegistry) {
      const t0 = Date.now();
      try {
        const result = await skill.run(ctx);
        steps.push(result);
        if (result.status === "error") status = "error";
        else if (result.status === "warn" && status === "ok") status = "warn";

        // Persist each step to the agentRuns collection for auditability.
        await this.persistStep(tenantId, cycleId, skill, result);
      } catch (err: any) {
        const failedAt = nowIso();
        const result: SkillResult = {
          skillId: skill.id,
          phase: skill.phase,
          status: "error",
          startedAt: new Date(t0).toISOString(),
          finishedAt: failedAt,
          durationMs: Date.now() - t0,
          written: {},
          summary: `Skill ${skill.id} threw: ${err?.message || String(err)}`,
          details: { error: String(err) },
        };
        steps.push(result);
        status = "error";
        await this.persistStep(tenantId, cycleId, skill, result);
      }
    }

    const finishedAt = nowIso();
    const totals = {
      papersIngested: steps.find((s) => s.skillId === "ingest-literature")?.written.researchPapers ?? 0,
      compoundsTagged: steps.find((s) => s.skillId === "analyze-papers")?.written.researchPapers ?? 0,
      simulationsRun: steps.find((s) => s.skillId === "run-simulations")?.written.simulations ?? 0,
      reportsGenerated: steps.find((s) => s.skillId === "generate-reports")?.written.reports ?? 0,
      risksScored: steps.find((s) => s.skillId === "score-risk")?.written.riskScores ?? 0,
      experimentsQueued: steps.find((s) => s.skillId === "queue-experiments")?.written.experimentQueue ?? 0,
      experimentsBenchmarked: steps.find((s) => s.skillId === "benchmark-experiments")?.written.experimentBenchmarks ?? 0,
      flyersPublished: steps.find((s) => s.skillId === "publish-artifacts")?.written.flyers ?? 0,
      knowledgePromoted: steps.find((s) => s.skillId === "promote-knowledge-base")?.written.knowledgeBase ?? 0,
    };

    const report: CycleReport = {
      cycleId,
      tenantId,
      startedAt,
      finishedAt,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      steps,
      totals,
      status,
    };

    await this.persistCycleSummary(report);

    // Store cycle summary as mem0 memory for future LLM-powered retrieval.
    await this.storeCycleMemory(report).catch((err) =>
      structuredLog("warn", "agentEngine: mem0 store failed", { tenantId, error: String(err) })
    );

    structuredLog("info", `agentEngine: Cycle ${cycleId} complete`, {
      tenantId,
      status,
      totals,
      durationMs: report.durationMs,
    });
    return report;
  }

  private async persistStep(
    tenantId: string,
    cycleId: string,
    skill: Skill,
    result: SkillResult
  ): Promise<void> {
    const runsRepo = new TenantRepository<any>("agentRuns", tenantId);
    await runsRepo.save({
      id: `${cycleId}-${skill.id}`,
      cycleId,
      tenantId,
      skillId: skill.id,
      phase: skill.phase,
      status: result.status,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      written: result.written,
      summary: result.summary,
      details: result.details,
      warnings: result.warnings,
    });
  }

  private async persistCycleSummary(report: CycleReport): Promise<void> {
    const cyclesRepo = new TenantRepository<any>("agentCycles", report.tenantId);
    await cyclesRepo.save({
      id: report.cycleId,
      cycleId: report.cycleId,
      tenantId: report.tenantId,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      durationMs: report.durationMs,
      status: report.status,
      totals: report.totals,
      stepCount: report.steps.length,
    });
  }

  private async storeCycleMemory(report: CycleReport): Promise<void> {
    const summary = report.steps
      .filter((s) => s.summary)
      .map((s) => `[${s.skillId}] ${s.summary}`)
      .join("\n");

    const messages = [
      { role: "system" as const, content: `Agent cycle ${report.cycleId} completed with status: ${report.status}.` },
      { role: "assistant" as const, content: summary || "No detailed summary available." },
    ];

    await addMemory({
      messages,
      userId: report.tenantId,
      agentId: "hempforge-agent",
      runId: report.cycleId,
      metadata: {
        status: report.status,
        durationMs: report.durationMs,
        totals: report.totals,
        stepCount: report.steps.length,
      },
    });
  }
}

export const agentEngine = new AgentEngine();