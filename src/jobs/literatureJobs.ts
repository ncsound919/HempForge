import cron from "node-cron";
import crypto from "crypto";
import { GoogleGenAI, Type } from "@google/genai";
import { ingestLiterature, HEMP_QUERY_TERMS, ResearchPaper } from "../lib/literatureService";
import { computeTrendSnapshot } from "../lib/trendEngine";
import { adminDb, createAuditHash } from "../services/backendServices";
import { smartInfer, ollamaHealthCheck } from "../lib/ollamaInference";

type ProductionClass =
  | "regulatory"
  | "safety"
  | "formulation"
  | "cultivation"
  | "analytics"
  | "general";

interface ProductionPaper extends ResearchPaper {
  fingerprint: string;
  canonicalId: string;
  tenantId: string;
  sourceQueries: string[];
  normalizedTitle: string;
  normalizedAbstract: string;
  compoundTags: string[];
  regulatoryTags: string[];
  studyTags: string[];
  productionClass: ProductionClass;
  relevanceScore: number;
  deterministicSummary: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastProductionRunId: string;
}

interface ProductionRun {
  id: string;
  tenantId: string;
  jobName: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  startedAt: string;
  completedAt?: string;
  terms: string[];
  rawPaperCount: number;
  uniquePaperCount: number;
  insertedCount: number;
  updatedCount: number;
  digestId?: string;
  topSignals: string[];
  errors: Array<{ term: string; message: string }>;
}

interface DailyDigest {
  id: string;
  tenantId: string;
  dateKey: string;
  generatedAt: string;
  runIds: string[];
  totalUniquePapers: number;
  openAccessCount: number;
  productionClassCounts: Record<string, number>;
  topCompounds: Array<{ name: string; count: number }>;
  topRegulatoryTags: Array<{ name: string; count: number }>;
  topPapers: Array<{
    canonicalId: string;
    title: string;
    source: string;
    publishedDate?: string;
    relevanceScore: number;
    productionClass: string;
    url?: string;
  }>;
  deterministicNarrative: string[];
}

const JOB_NAME = "AUTONOMOUS_LITERATURE_PRODUCTION";
const DEFAULT_TENANT = "Global-Hemp-Wilson";
let isRunning = false;

const COMPOUND_RULES = [
  "thca",
  "delta-9-thc",
  "d9-thc",
  "thc",
  "cbd",
  "cbda",
  "cbc",
  "cbg",
  "cbn",
  "terpene",
  "terpenes",
  "flavonoid",
];

const REGULATORY_RULES = [
  "compliance",
  "regulatory",
  "fda",
  "usda",
  "ncda",
  "limit",
  "threshold",
  "toxicology",
  "safety",
  "labeling",
  "gxp",
  "iso 17025",
];

const STUDY_RULES = [
  "clinical",
  "randomized",
  "in vitro",
  "in vivo",
  "kinetics",
  "stability",
  "pharmacokinetic",
  "chromatography",
  "hplc",
  "gc-ms",
  "cultivation",
  "post-harvest",
  "extraction",
  "formulation",
];

function stableHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeText(input?: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s%-]/g, " ")
    .trim();
}

function compact(input?: string): string {
  return (input || "").replace(/\s+/g, " ").trim();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function extractTags(text: string, rules: string[]): string[] {
  return rules.filter((term) => text.includes(term));
}

async function summarizePaperAI(
  title: string,
  abstract: string,
  productionClass: ProductionClass
): Promise<string> {
  const prompt = `Summarize this ${productionClass} hemp research paper in 2-3 sentences for a regulatory compliance digest. Focus on key findings, compounds, and implications.

Title: ${title}
Abstract: ${abstract}

Return ONLY the summary text.`;

  try {
    const result = await smartInfer(prompt, {
      format: "text",
      preferLocal: true,
      systemPrompt: "You are a concise hemp research summarizer.",
    });
    return result.text.trim();
  } catch (err) {
    console.warn("[literatureJobs] AI summarization failed, using deterministic fallback:", err);
    return buildDeterministicSummary(title, productionClass, [], [], []);
  }
}

function classifyPaper(text: string): ProductionClass {
  if (
    text.includes("regulatory") ||
    text.includes("compliance") ||
    text.includes("fda") ||
    text.includes("usda") ||
    text.includes("labeling")
  ) return "regulatory";

  if (
    text.includes("toxicology") ||
    text.includes("safety") ||
    text.includes("adverse") ||
    text.includes("contaminant")
  ) return "safety";

  if (
    text.includes("formulation") ||
    text.includes("emulsion") ||
    text.includes("beverage") ||
    text.includes("capsule")
  ) return "formulation";

  if (
    text.includes("cultivation") ||
    text.includes("post-harvest") ||
    text.includes("drying") ||
    text.includes("curing")
  ) return "cultivation";

  if (
    text.includes("chromatography") ||
    text.includes("hplc") ||
    text.includes("gc-ms") ||
    text.includes("kinetics") ||
    text.includes("stability") ||
    text.includes("assay")
  ) return "analytics";

  return "general";
}

function computeRelevanceScore(
  normalizedTitle: string,
  normalizedAbstract: string,
  isOpenAccess: boolean,
  publishedDate?: string
): number {
  let score = 0;
  const text = `${normalizedTitle} ${normalizedAbstract}`;

  for (const term of COMPOUND_RULES) if (text.includes(term)) score += 8;
  for (const term of REGULATORY_RULES) if (text.includes(term)) score += 10;
  for (const term of STUDY_RULES) if (text.includes(term)) score += 6;

  if (normalizedTitle.includes("hemp")) score += 10;
  if (normalizedTitle.includes("cannabis")) score += 6;
  if (isOpenAccess) score += 5;

  if (publishedDate) {
    const published = new Date(publishedDate).getTime();
    const ageDays = Math.max(0, (Date.now() - published) / 86400000);
    if (ageDays <= 365) score += 10;
    else if (ageDays <= 730) score += 5;
  }

  return Math.min(100, score);
}

function buildDeterministicSummary(
  title: string,
  productionClass: ProductionClass,
  compoundTags: string[],
  regulatoryTags: string[],
  studyTags: string[]
): string {
  const parts = [
    `Classified as ${productionClass}.`,
    compoundTags.length ? `Compounds: ${compoundTags.join(", ")}.` : "Compounds: none detected.",
    regulatoryTags.length ? `Regulatory signals: ${regulatoryTags.join(", ")}.` : "Regulatory signals: none detected.",
    studyTags.length ? `Study features: ${studyTags.join(", ")}.` : "Study features: none detected.",
    `Source title: ${compact(title)}.`
  ];
  return parts.join(" ");
}

function buildCanonicalId(paper: ResearchPaper): string {
  const source = compact(paper.source || "unknown");
  const title = normalizeText(paper.title || "");
  const url = compact(paper.url || "");
  const authors = compact((paper.authors || []).join("|"));
  const basis = `${source}::${url || title}::${authors}`;
  return `paper-${stableHash(basis).slice(0, 20)}`;
}

function toProductionPaper(
  paper: ResearchPaper,
  query: string,
  tenantId: string,
  runId: string,
  existing?: Partial<ProductionPaper>
): ProductionPaper {
  const normalizedTitle = normalizeText(paper.title);
  const normalizedAbstract = normalizeText(paper.abstract);
  const combined = `${normalizedTitle} ${normalizedAbstract}`;

  const compoundTags = extractTags(combined, COMPOUND_RULES);
  const regulatoryTags = extractTags(combined, REGULATORY_RULES);
  const studyTags = extractTags(combined, STUDY_RULES);
  const productionClass = classifyPaper(combined);
  const relevanceScore = computeRelevanceScore(
    normalizedTitle,
    normalizedAbstract,
    !!paper.isOpenAccess,
    paper.publishedDate
  );

  const canonicalId = buildCanonicalId(paper);
  const now = new Date().toISOString();
  const fingerprint = stableHash(
    `${canonicalId}::${normalizedTitle}::${normalizedAbstract}`
  );

  return {
    ...paper,
    id: canonicalId,
    canonicalId,
    fingerprint,
    tenantId,
    sourceQueries: unique([...(existing?.sourceQueries || []), query]),
    normalizedTitle,
    normalizedAbstract,
    compoundTags,
    regulatoryTags,
    studyTags,
    productionClass,
    relevanceScore,
    deterministicSummary: buildDeterministicSummary(
      paper.title,
      productionClass,
      compoundTags,
      regulatoryTags,
      studyTags
    ),
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    lastProductionRunId: runId,
  };
}

function mergeProductionPapers(a: ProductionPaper, b: ProductionPaper): ProductionPaper {
  return {
    ...a,
    ...b,
    sourceQueries: unique([...(a.sourceQueries || []), ...(b.sourceQueries || [])]),
    compoundTags: unique([...(a.compoundTags || []), ...(b.compoundTags || [])]),
    regulatoryTags: unique([...(a.regulatoryTags || []), ...(b.regulatoryTags || [])]),
    studyTags: unique([...(a.studyTags || []), ...(b.studyTags || [])]),
    relevanceScore: Math.max(a.relevanceScore || 0, b.relevanceScore || 0),
    lastSeenAt: b.lastSeenAt,
    lastProductionRunId: b.lastProductionRunId,
  };
}

function buildDigest(
  tenantId: string,
  runId: string,
  papers: ProductionPaper[]
): DailyDigest {
  const generatedAt = new Date().toISOString();
  const dateKey = generatedAt.slice(0, 10);

  const productionClassCounts = papers.reduce<Record<string, number>>((acc, p) => {
    acc[p.productionClass] = (acc[p.productionClass] || 0) + 1;
    return acc;
  }, {});

  const compoundCount = new Map<string, number>();
  const regulatoryCount = new Map<string, number>();

  for (const p of papers) {
    for (const c of p.compoundTags) compoundCount.set(c, (compoundCount.get(c) || 0) + 1);
    for (const r of p.regulatoryTags) regulatoryCount.set(r, (regulatoryCount.get(r) || 0) + 1);
  }

  const topCompounds = [...compoundCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  const topRegulatoryTags = [...regulatoryCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  const topPapers = [...papers]
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 10)
    .map((p) => ({
      canonicalId: p.canonicalId,
      title: p.title,
      source: p.source,
      publishedDate: p.publishedDate,
      relevanceScore: p.relevanceScore,
      productionClass: p.productionClass,
      url: p.url,
    }));

  const narrative: string[] = [
    `Deterministic production digest generated for ${papers.length} unique literature records.`,
    `Dominant classes: ${Object.entries(productionClassCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} (${v})`)
      .join(", ") || "none"}.`,
    `Top compound signals: ${topCompounds.map((x) => `${x.name} (${x.count})`).join(", ") || "none"}.`,
    `Top regulatory signals: ${topRegulatoryTags.map((x) => `${x.name} (${x.count})`).join(", ") || "none"}.`,
  ];

  return {
    id: `digest-${tenantId}-${dateKey}`,
    tenantId,
    dateKey,
    generatedAt,
    runIds: [runId],
    totalUniquePapers: papers.length,
    openAccessCount: papers.filter((p) => p.isOpenAccess).length,
    productionClassCounts,
    topCompounds,
    topRegulatoryTags,
    topPapers,
    deterministicNarrative: narrative,
  };
}

async function upsertPaper(paper: ProductionPaper): Promise<"inserted" | "updated"> {
  const ref = adminDb!.collection("researchPapers").doc(paper.canonicalId);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set(paper);
    return "inserted";
  }

  const existing = snap.data() as ProductionPaper;
  const merged = mergeProductionPapers(existing, paper);
  await ref.set(merged, { merge: true });
  return "updated";
}

async function writeAuditLog(tenantId: string, run: ProductionRun) {
  const entry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    userId: "system-literature-job",
    userRole: "System",
    tenantId,
    action: "LITERATURE_PRODUCTION_RUN",
    details: `Run ${run.id} completed with ${run.uniquePaperCount} unique papers, ${run.insertedCount} inserts, ${run.updatedCount} updates.`,
    category: "SYSTEM_INTEGRATION" as const,
  };

  await adminDb!.collection("auditLogs").doc(entry.id).set({
    ...entry,
    hash: createAuditHash(entry),
  });
}

export async function runLiteratureProduction(tenantId: string = DEFAULT_TENANT, query?: string) {
  if (isRunning) {
    console.warn("[literatureJobs] Previous run still active; skipping overlap.");
    return;
  }

  if (!adminDb) {
    console.warn("[literatureJobs] Firebase Admin not initialized, skipping autonomous ingestion.");
    return;
  }

  isRunning = true;
  const startedAt = new Date().toISOString();
  const runId = `lit-prod-${tenantId}-${startedAt.replace(/[:.]/g, "-")}`;
  const terms = query ? [query] : HEMP_QUERY_TERMS;

  const run: ProductionRun = {
    id: runId,
    tenantId,
    jobName: query ? `TARGETED_FEED_AUTONOMOUS_RUN` : JOB_NAME,
    status: "RUNNING",
    startedAt,
    terms,
    rawPaperCount: 0,
    uniquePaperCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    topSignals: [],
    errors: [],
  };

  await adminDb.collection("researchProductionRuns").doc(runId).set(run);

  try {
    const merged = new Map<string, ProductionPaper>();

    for (const term of terms) {
      try {
        const papers = await ingestLiterature(term, tenantId);
        run.rawPaperCount += papers.length;

        for (const paper of papers) {
          const canonicalId = buildCanonicalId(paper);
          const existing = merged.get(canonicalId);
          const next = toProductionPaper(paper, term, tenantId, runId, existing);
          merged.set(canonicalId, existing ? mergeProductionPapers(existing, next) : next);
        }
      } catch (err: any) {
        run.errors.push({
          term,
          message: err?.message || "Unknown literature ingestion error",
        });
      }
    }

    const papers = [...merged.values()]
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    run.uniquePaperCount = papers.length;

    for (const paper of papers) {
      const result = await upsertPaper(paper);
      if (result === "inserted") run.insertedCount += 1;
      else run.updatedCount += 1;

      // Enrich top-10 papers with AI-generated summaries (best-effort, non-blocking)
      if (paper.relevanceScore >= 30 && paper.normalizedAbstract) {
        try {
          const aiSummary = await summarizePaperAI(
            paper.title,
            paper.abstract || paper.normalizedAbstract,
            paper.productionClass
          );
          if (aiSummary && aiSummary.length > 20) {
            const ref = adminDb!.collection("researchPapers").doc(paper.canonicalId);
            await ref.set({ aiSummary, deterministicSummary: aiSummary }, { merge: true });
          }
        } catch {
          // Non-critical: deterministicSummary is already saved
        }
      }
    }

    const digest = buildDigest(tenantId, runId, papers);
    run.digestId = digest.id;
    run.topSignals = [
      ...digest.topCompounds.slice(0, 4).map((x) => x.name),
      ...digest.topRegulatoryTags.slice(0, 4).map((x) => x.name),
    ];

    const digestRef = adminDb.collection("researchDigests").doc(digest.id);
    const existingDigest = await digestRef.get();

    if (!existingDigest.exists) {
      await digestRef.set(digest);
    } else {
      const previous = existingDigest.data() as DailyDigest;
      const mergedRunIds = unique([...(previous.runIds || []), runId]);
      await digestRef.set(
        {
          ...digest,
          runIds: mergedRunIds,
        },
        { merge: true }
      );
    }

    run.status = "COMPLETED";
    run.completedAt = new Date().toISOString();

    await adminDb.collection("researchProductionRuns").doc(runId).set(run, { merge: true });
    await writeAuditLog(tenantId, run);

    // Run trend & insight detection, simulation conversion, and research doc creation
    console.log("[literatureJobs] Running autonomous trend, insight, simulation & doc generation pipeline...");
    await runAutonomousTrendsAndSimulations(tenantId);

    console.log(
      `[literatureJobs] Completed ${runId}: ${run.uniquePaperCount} unique papers, ${run.insertedCount} inserted, ${run.updatedCount} updated.`
    );
  } catch (err: any) {
    run.status = "FAILED";
    run.completedAt = new Date().toISOString();
    run.errors.push({
      term: "SYSTEM",
      message: err?.message || "Unhandled literature production failure",
    });

    await adminDb.collection("researchProductionRuns").doc(runId).set(run, { merge: true });
    console.error("[literatureJobs] Fatal production run failure:", err);
  } finally {
    isRunning = false;
  }
}

export async function runAutonomousTrendsAndSimulations(tenantId: string = DEFAULT_TENANT) {
  if (!adminDb) return;
  try {
    const snapshot = await computeTrendSnapshot(tenantId);
    if (!snapshot) {
      console.warn("[literatureJobs] Trend snapshot returned null; skipping.");
      return;
    }

    const batch = adminDb.batch();

    // Store the full snapshot in a single document for dashboard consumption
    const snapshotId = `snapshot-${tenantId}-${new Date().toISOString().slice(0, 10)}`;
    const snapRef = adminDb.collection("trendSnapshots").doc(snapshotId);
    batch.set(snapRef, {
      ...snapshot,
      id: snapshotId,
      tenantId,
    }, { merge: true });

    for (const t of snapshot.trends) {
      const ref = adminDb.collection("researchTrends").doc(t.id);
      batch.set(ref, t, { merge: true });
    }

    for (const ins of snapshot.insights) {
      const ref = adminDb.collection("researchInsights").doc(ins.id);
      batch.set(ref, ins, { merge: true });
    }

    for (const sim of snapshot.simulations) {
      const ref = adminDb.collection("experimentalTrials").doc(sim.id);
      batch.set(ref, sim, { merge: true });
    }

    // Generate synthetic research docs from top compounds
    for (let i = 0; i < Math.min(2, snapshot.topCompounds.length); i++) {
      const c = snapshot.topCompounds[i];
      const docId = `doc-auto-${stableHash(c.name).slice(0, 8)}`;
      const title = `Literature-Driven Analysis: Role of ${c.name.toUpperCase()} in Hemp Science`;
      const mappedDoc = {
        id: docId,
        canonicalId: docId,
        name: `${c.name}_literature_analysis.pdf`,
        path: "/Autonomous_Research_Docs/",
        size: "150 KB",
        type: "pdf",
        uploadDate: new Date().toISOString().split("T")[0],
        title,
        journal: "HempForge Swarm Synthesizer",
        year: new Date().getFullYear(),
        authors: "HempForge AI Swarm",
        abstract: `Computed literature analysis: ${c.name} appears in ${c.count} of ${snapshot.totalPapers} indexed papers, with a ${c.trend} trend. Derived from ${snapshot.sourceDistribution ? Object.keys(snapshot.sourceDistribution).length : "multiple"} sources.`,
        compounds: [c.name],
        dosage: "N/A",
        outcomes: `${c.name} trending ${c.trend} across indexed corpus.`,
        markdown: `# ${title}\n\n## Abstract\nAutomated literature synthesis based on ${snapshot.totalPapers} indexed papers.\n\n## Findings\n- ${c.name} appears in ${c.count} papers\n- Trend: ${c.trend}\n- Source diversity: ${Object.keys(snapshot.sourceDistribution || {}).length} sources`,
        tenantId,
        lastSeenAt: new Date().toISOString(),
      };
      const ref = adminDb.collection("researchPapers").doc(docId);
      batch.set(ref, mappedDoc, { merge: true });
    }

    await batch.commit();

    const auditEntry: any = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: "system-swarm-agent",
      userRole: "System",
      tenantId,
      action: "SWARM_AUTONOMOUS_PIPELINE_COMPLETE",
      details: `Autonomous Swarm computed trends from ${snapshot.totalPapers} papers: ${snapshot.trends.length} trends, ${snapshot.insights.length} insights, ${snapshot.simulations.length} simulations.`,
      category: "SYSTEM_INTEGRATION",
    };

    await adminDb.collection("auditLogs").doc(auditEntry.id).set({
      ...auditEntry,
      hash: createAuditHash(auditEntry),
    });

    console.log(`[literatureJobs] Trend snapshot computed for ${tenantId}: ${snapshot.totalPapers} papers, ${snapshot.trends.length} trends.`);
  } catch (err) {
    console.error("[literatureJobs] Error in runAutonomousTrendsAndSimulations:", err);
  }
}

export function startLiteratureJobs() {
  cron.schedule("0 * * * *", async () => {
    console.log("[literatureJobs] Running deterministic literature production pipeline...");
    await runLiteratureProduction(DEFAULT_TENANT);
  });
}
