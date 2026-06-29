import crypto from "crypto";
import { adminDb } from "../services/backendServices";
import ss from "simple-statistics";

export interface PaperRef {
  id?: string;
  title?: string;
  abstract?: string;
  keywords?: string[];
  publishedDate?: string;
  source?: string;
  isOpenAccess?: boolean;
  citationCount?: number;
  relevanceScore?: number;
  compounds?: string[];
  class?: string;
  normalizedTitle?: string;
  normalizedAbstract?: string;
  compoundTags?: string[];
  regulatoryTags?: string[];
  studyTags?: string[];
  productionClass?: string;
  canonicalId?: string;
  ingestedAt?: string;
  lastSeenAt?: string;
  [key: string]: unknown;
}

export interface ComputedTrend {
  id: string;
  tenantId: string;
  detectedAt: string;
  title: string;
  description: string;
  growthRate: number;
  confidence: number;
  category: string;
  relatedPaperTitles: string[];
  evidence: {
    mentionCount: number;
    recentMentionCount: number;
    sourceCount: number;
  };
}

export interface ComputedInsight {
  id: string;
  tenantId: string;
  detectedAt: string;
  title: string;
  summary: string;
  implications: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  relatedCompounds: string[];
  evidence: {
    supportingPaperCount: number;
    avgRelevanceScore: number;
  };
}

export interface ComputedSimulation {
  id: string;
  tenantId: string;
  date: string;
  name: string;
  type: string;
  parameters: Record<string, number | string>;
  results: Record<string, number | string>;
  status: string;
  notes: string;
}

export interface PublicationAnomaly {
  period: string;
  expected: number;
  actual: number;
  zScore: number;
  severity: "low" | "medium" | "high";
}

export interface TemporalAcceleration {
  overallScore: number;
  recentVelocity: number;
  earlierVelocity: number;
  trend: "accelerating" | "stable" | "decelerating";
}

export interface CompoundCluster {
  theme: string;
  compounds: string[];
  strength: number;
  paperCount: number;
}

export interface RegulatoryRiskScore {
  compound: string;
  riskScore: number;
  signals: string[];
  complianceKeywords: string[];
}

export interface PublicationMomentum {
  overall: number;
  recentWeightedRate: number;
  historicalRate: number;
  momentum: "strong" | "moderate" | "weak" | "emerging";
}

export interface BurstDetection {
  compound: string;
  burstStart: string;
  burstEnd: string;
  intensity: number;
  periodCount: number;
}

export interface CrossSourceValidation {
  compound: string;
  sourceCount: number;
  sources: string[];
  agreementScore: number;
  totalMentions: number;
}

export interface MannKendallResult {
  tau: number;
  pValue: number;
  trend: "significant_increase" | "significant_decrease" | "no_significant_trend";
  zScore: number;
}

export interface TrendSnapshot {
  generatedAt: string;
  totalPapers: number;
  openAccessCount: number;
  classDistribution: Record<string, number>;
  sourceDistribution: Record<string, number>;
  topCompounds: Array<{ name: string; count: number; trend: "rising" | "stable" | "declining" }>;
  topKeywords: Array<{ name: string; count: number }>;
  publicationVelocity: Array<{ period: string; count: number }>;
  compoundCooccurrence: Array<{ pair: string; count: number }>;
  trends: ComputedTrend[];
  insights: ComputedInsight[];
  simulations: ComputedSimulation[];
  anomalies: PublicationAnomaly[];
  temporalAcceleration: TemporalAcceleration;
  compoundClusters: CompoundCluster[];
  regulatoryRisk: RegulatoryRiskScore[];
  publicationMomentum: PublicationMomentum;
  burstDetections: BurstDetection[];
  crossSourceValidation: CrossSourceValidation[];
  mannKendallTrends: Record<string, MannKendallResult>;
}

function stableHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

const COMPOUND_NAMES = [
  "thca", "thc", "delta-9-thc", "d9-thc", "cbd", "cbda", "cbc", "cbg",
  "cbn", "cbdv", "thcv", "cbcv", "cbgv", "terpene", "terpenes",
  "myrcene", "limonene", "caryophyllene", "linalool", "pinene",
  "humulene", "bisabolol", "flavonoid"
];

function extractCompounds(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const c of COMPOUND_NAMES) {
    if (lower.includes(c)) found.add(c);
  }
  return [...found];
}

function computeTrendDirection(
  compound: string,
  periodBuckets: Map<string, Set<string>>
): "rising" | "stable" | "declining" {
  const periods = [...periodBuckets.keys()].sort();
  if (periods.length < 2) return "stable";
  const recent = periods.slice(-Math.min(3, periods.length));
  const older = periods.slice(0, Math.max(1, periods.length - recent.length));
  const recentCount = recent.filter(p => periodBuckets.get(p)?.has(compound)).length;
  const olderCount = older.filter(p => periodBuckets.get(p)?.has(compound)).length;
  const recentRatio = recentCount / recent.length;
  const olderRatio = olderCount / older.length || 0.01;
  const change = recentRatio / olderRatio;
  if (change > 1.3) return "rising";
  if (change < 0.7) return "declining";
  return "stable";
}

function detectAnomalies(velocity: Array<{ period: string; count: number }>): PublicationAnomaly[] {
  if (velocity.length < 4) return [];
  const counts = velocity.map(v => v.count);
  const mu = ss.mean(counts);
  const sigma = ss.standardDeviation(counts);
  if (sigma === 0) return [];
  return velocity
    .map(v => {
      const z = (v.count - mu) / sigma;
      const absZ = Math.abs(z);
      return {
        period: v.period,
        expected: Math.round(mu * 10) / 10,
        actual: v.count,
        zScore: Math.round(z * 100) / 100,
        severity: absZ >= 3 ? "high" as const : absZ >= 2 ? "medium" as const : "low" as const,
      };
    })
    .filter(a => Math.abs(a.zScore) >= 2)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

function detectTemporalAcceleration(velocity: Array<{ period: string; count: number }>): TemporalAcceleration {
  if (velocity.length < 2) {
    return { overallScore: 0, recentVelocity: 0, earlierVelocity: 0, trend: "stable" };
  }
  const mid = Math.floor(velocity.length / 2);
  const earlierHalf = velocity.slice(0, mid);
  const recentHalf = velocity.slice(mid);
  const earlierRate = earlierHalf.length > 0 ? ss.mean(earlierHalf.map(v => v.count)) : 0;
  const recentRate = recentHalf.length > 0 ? ss.mean(recentHalf.map(v => v.count)) : 0;
  const denominator = earlierRate || 1;
  const changeRatio = (recentRate - earlierRate) / denominator;
  const score = Math.max(-100, Math.min(100, Math.round(changeRatio * 100)));
  let trend: "accelerating" | "stable" | "decelerating";
  if (score > 15) trend = "accelerating";
  else if (score < -15) trend = "decelerating";
  else trend = "stable";
  return {
    overallScore: score,
    recentVelocity: Math.round(recentRate * 10) / 10,
    earlierVelocity: Math.round(earlierRate * 10) / 10,
    trend,
  };
}

const THEME_SEEDS: Record<string, string[]> = {
  "Cannabinoid Therapy": ["thca", "thc", "cbd", "cbg", "cbn", "cbdv", "thcv", "cbda"],
  "Terpene Research": ["terpene", "terpenes", "myrcene", "limonene", "caryophyllene", "linalool", "pinene", "humulene", "bisabolol"],
  "Minor Cannabinoids": ["cbc", "cbcv", "cbgv", "cbn", "cbdv", "thcv"],
  "Flavonoid Studies": ["flavonoid"],
};

function clusterCompounds(
  compoundCount: Map<string, number>,
  cooccurrence: Map<string, number>
): CompoundCluster[] {
  const allCompounds = [...compoundCount.keys()];
  if (allCompounds.length === 0) return [];

  const clusters: CompoundCluster[] = [];
  const assigned = new Set<string>();

  for (const [themeName, seeds] of Object.entries(THEME_SEEDS)) {
    const members = seeds.filter(s => allCompounds.includes(s));
    if (members.length === 0) continue;

    let totalCooccur = 0;
    let pairCount = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = [members[i], members[j]].sort().join("+");
        const val = cooccurrence.get(key) || 0;
        totalCooccur += val;
        pairCount++;
      }
    }
    const avgStrength = pairCount > 0 ? totalCooccur / pairCount : 0;
    const paperCount = members.reduce((s, m) => s + (compoundCount.get(m) || 0), 0);

    clusters.push({
      theme: themeName,
      compounds: members,
      strength: Math.round(avgStrength * 100) / 100,
      paperCount,
    });
    members.forEach(m => assigned.add(m));
  }

  const unassigned = allCompounds.filter(c => !assigned.has(c));
  if (unassigned.length >= 2) {
    let totalCooccur = 0;
    let pairCount = 0;
    for (let i = 0; i < unassigned.length; i++) {
      for (let j = i + 1; j < unassigned.length; j++) {
        const key = [unassigned[i], unassigned[j]].sort().join("+");
        totalCooccur += cooccurrence.get(key) || 0;
        pairCount++;
      }
    }
    clusters.push({
      theme: "Other Research",
      compounds: unassigned,
      strength: pairCount > 0 ? Math.round((totalCooccur / pairCount) * 100) / 100 : 0,
      paperCount: unassigned.reduce((s, m) => s + (compoundCount.get(m) || 0), 0),
    });
  }

  return clusters.sort((a, b) => b.paperCount - a.paperCount);
}

const COMPLIANCE_KEYWORDS = [
  "compliance", "regulatory", "fda", "usda", "limit", "threshold",
  "legal", "law", "policy", "restriction", "ban", "prohibit",
  "certificate", "license", "inspection", "audit", "gxp", "iso",
  "haccp", "good manufacturing", "validation", "qualification",
  "0.3%", "dry weight", "delta-9", "psychoactive", "controlled substance",
];

function scoreRegulatoryRisk(
  papers: PaperRef[],
  compoundCount: Map<string, number>,
  topCompounds: Array<{ name: string; count: number }>
): RegulatoryRiskScore[] {
  const compoundPaperMap = new Map<string, string[]>();
  for (const p of papers) {
    const combined = `${p.normalizedTitle || ""} ${p.normalizedAbstract || ""} ${(p.compoundTags || []).join(" ")}`.toLowerCase();
    for (const c of topCompounds.map(tc => tc.name)) {
      if (combined.includes(c)) {
        if (!compoundPaperMap.has(c)) compoundPaperMap.set(c, []);
        compoundPaperMap.get(c)!.push(combined);
      }
    }
  }

  return topCompounds.map(tc => {
    const paperTexts = compoundPaperMap.get(tc.name) || [];
    const allText = paperTexts.join(" ");
    const matchedKeywords = COMPLIANCE_KEYWORDS.filter(kw =>
      allText.toLowerCase().includes(kw)
    );
    const signals: string[] = [];
    if (matchedKeywords.includes("fda")) signals.push("FDA involvement");
    if (matchedKeywords.includes("ban") || matchedKeywords.includes("prohibit"))
      signals.push("Prohibition-related discussion");
    if (matchedKeywords.includes("0.3%") || matchedKeywords.includes("dry weight"))
      signals.push("THC compliance threshold");
    if (matchedKeywords.includes("controlled substance"))
      signals.push("Controlled substance classification");
    if (matchedKeywords.includes("inspection") || matchedKeywords.includes("audit"))
      signals.push("Inspection/audit activity");

    const density = paperTexts.length > 0
      ? matchedKeywords.length / (paperTexts.length * COMPLIANCE_KEYWORDS.length) * 1000
      : 0;
    const riskScore = Math.min(100, Math.round(density * 5 + (tc.count > 10 ? 15 : 0) + signals.length * 10));

    return {
      compound: tc.name,
      riskScore,
      signals,
      complianceKeywords: matchedKeywords,
    };
  }).sort((a, b) => b.riskScore - a.riskScore);
}

function computePublicationMomentum(velocity: Array<{ period: string; count: number }>): PublicationMomentum {
  if (velocity.length === 0) {
    return { overall: 0, recentWeightedRate: 0, historicalRate: 0, momentum: "weak" };
  }
  const counts = velocity.map(v => v.count);
  const mu = ss.mean(counts);
  const n = counts.length;

  const halfLife = Math.max(2, Math.floor(n / 3));
  const lambda = Math.log(2) / halfLife;
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < n; i++) {
    const age = n - 1 - i;
    const weight = Math.exp(-lambda * age);
    weightedSum += counts[i] * weight;
    weightTotal += weight;
  }
  const recentWeightedRate = weightTotal > 0 ? weightedSum / weightTotal : 0;

  const historicalRate = mu;
  const ratio = historicalRate > 0 ? recentWeightedRate / historicalRate : 1;

  let overall: number;
  let momentum: PublicationMomentum["momentum"];
  if (ratio >= 1.5 && recentWeightedRate >= mu * 1.2) {
    overall = Math.min(100, 70 + Math.round(ratio * 10));
    momentum = "strong";
  } else if (ratio >= 1.1) {
    overall = Math.round(50 + ratio * 15);
    momentum = "moderate";
  } else if (ratio >= 0.8) {
    overall = Math.round(30 + ratio * 20);
    momentum = "weak";
  } else {
    overall = Math.max(5, Math.round(ratio * 30));
    momentum = "emerging";
  }

  return {
    overall: Math.min(100, Math.max(0, overall)),
    recentWeightedRate: Math.round(recentWeightedRate * 100) / 100,
    historicalRate: Math.round(historicalRate * 100) / 100,
    momentum,
  };
}

/**
 * Mann-Kendall non-parametric trend test for publication time series.
 * Detects statistically significant monotonic trends in compound mentions over time.
 */
function mannKendallTest(values: number[]): MannKendallResult {
  const n = values.length;
  if (n < 4) {
    return { tau: 0, pValue: 1, trend: "no_significant_trend", zScore: 0 };
  }

  let S = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = values[j] - values[i];
      if (diff > 0) S++;
      else if (diff < 0) S--;
    }
  }

  const tau = (2 * S) / (n * (n - 1));

  // Variance of S (corrected for ties)
  const tieGroups = new Map<number, number>();
  for (const v of values) {
    tieGroups.set(v, (tieGroups.get(v) || 0) + 1);
  }
  let tieCorrection = 0;
  for (const t of tieGroups.values()) {
    if (t > 1) tieCorrection += t * (t - 1) * (2 * t + 5);
  }

  const varS = (n * (n - 1) * (2 * n + 5) - tieCorrection) / 18;
  const sigmaS = Math.sqrt(varS);

  let zScore = 0;
  if (sigmaS > 0) {
    if (S > 0) zScore = (S - 1) / sigmaS;
    else if (S < 0) zScore = (S + 1) / sigmaS;
  }

  // Two-tailed p-value approximation using normal distribution
  const absZ = Math.abs(zScore);
  const pValue = 2 * (1 - normalCDF(absZ));

  let trend: MannKendallResult["trend"] = "no_significant_trend";
  if (pValue < 0.05) {
    trend = tau > 0 ? "significant_increase" : "significant_decrease";
  }

  return {
    tau: Math.round(tau * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    trend,
    zScore: Math.round(zScore * 100) / 100,
  };
}

/** Standard normal CDF approximation (Abramowitz & Stegun) */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Kleinberg-inspired burst detection for compound mentions across time periods.
 * Identifies periods of unusually high activity for specific compounds.
 */
function detectBursts(
  compoundPeriodCounts: Map<string, Map<string, number>>,
  globalPeriodCounts: Map<string, number>
): BurstDetection[] {
  const bursts: BurstDetection[] = [];

  for (const [compound, periodMap] of compoundPeriodCounts.entries()) {
    const periods = [...periodMap.keys()].sort();
    if (periods.length < 3) continue;

    const counts = periods.map(p => periodMap.get(p) || 0);
    const mu = ss.mean(counts);
    const sigma = ss.standardDeviation(counts);
    if (sigma === 0 || mu === 0) continue;

    // Find contiguous burst periods where count > mu + 1.5*sigma
    const threshold = mu + 1.5 * sigma;
    let burstStart: string | null = null;
    let burstPeriods = 0;
    let burstIntensity = 0;

    for (let i = 0; i < periods.length; i++) {
      if (counts[i] > threshold) {
        if (!burstStart) burstStart = periods[i];
        burstPeriods++;
        burstIntensity += (counts[i] - mu) / sigma;
      } else if (burstStart) {
        bursts.push({
          compound,
          burstStart,
          burstEnd: periods[i - 1],
          intensity: Math.round((burstIntensity / burstPeriods) * 100) / 100,
          periodCount: burstPeriods,
        });
        burstStart = null;
        burstPeriods = 0;
        burstIntensity = 0;
      }
    }

    // Flush trailing burst
    if (burstStart) {
      bursts.push({
        compound,
        burstStart,
        burstEnd: periods[periods.length - 1],
        intensity: Math.round((burstIntensity / burstPeriods) * 100) / 100,
        periodCount: burstPeriods,
      });
    }
  }

  return bursts
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 10);
}

/**
 * Cross-source validation: measures agreement across different data sources
 * for compound mentions. Higher scores indicate more reliable signals.
 */
function computeCrossSourceValidation(
  papers: PaperRef[],
  topCompounds: Array<{ name: string; count: number }>
): CrossSourceValidation[] {
  return topCompounds.map(tc => {
    const sourceMentions = new Map<string, number>();
    let totalMentions = 0;

    for (const p of papers) {
      const combined = `${p.normalizedTitle || ""} ${p.normalizedAbstract || ""} ${(p.compoundTags || []).join(" ")}`.toLowerCase();
      if (combined.includes(tc.name)) {
        const src = p.source || "unknown";
        sourceMentions.set(src, (sourceMentions.get(src) || 0) + 1);
        totalMentions++;
      }
    }

    const sources = [...sourceMentions.keys()];
    const sourceCount = sources.length;

    // Agreement score: how evenly distributed across sources (entropy-based)
    let agreementScore = 0;
    if (sourceCount > 1 && totalMentions > 0) {
      let entropy = 0;
      for (const count of sourceMentions.values()) {
        const p = count / totalMentions;
        if (p > 0) entropy -= p * Math.log2(p);
      }
      const maxEntropy = Math.log2(sourceCount);
      agreementScore = maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) : 0;
    } else if (sourceCount === 1) {
      agreementScore = 25; // Single source = low validation
    }

    return { compound: tc.name, sourceCount, sources, agreementScore, totalMentions };
  }).sort((a, b) => b.agreementScore - a.agreementScore);
}

export async function computeTrendSnapshot(tenantId: string): Promise<TrendSnapshot | null> {
  if (!adminDb) return null;

  try {
    const snap = await adminDb
      .collection("researchPapers")
      .where("tenantId", "==", tenantId)
      .get();

    const papers: PaperRef[] = snap.docs.map((d: { data: () => unknown }) => d.data() as PaperRef);

    if (papers.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        totalPapers: 0,
        openAccessCount: 0,
        classDistribution: {},
        sourceDistribution: {},
        topCompounds: [],
        topKeywords: [],
        publicationVelocity: [],
        compoundCooccurrence: [],
        trends: [],
        insights: [],
        simulations: [],
        anomalies: [],
        temporalAcceleration: { overallScore: 0, recentVelocity: 0, earlierVelocity: 0, trend: "stable" },
        compoundClusters: [],
        regulatoryRisk: [],
        publicationMomentum: { overall: 0, recentWeightedRate: 0, historicalRate: 0, momentum: "weak" },
        burstDetections: [],
        crossSourceValidation: [],
        mannKendallTrends: {},
      };
    }

    const classDistribution: Record<string, number> = {};
    const sourceDistribution: Record<string, number> = {};
    const compoundCount = new Map<string, number>();
    const keywordCount = new Map<string, number>();
    const publicationBuckets = new Map<string, Set<string>>();
    const compoundPeriodBuckets = new Map<string, Set<string>>();
    const cooccurrenceCount = new Map<string, number>();
    const compoundPapers = new Map<string, Set<string>>();
    const compoundPeriodCounts = new Map<string, Map<string, number>>();

    for (const p of papers) {
      const cls = p.productionClass || "general";
      classDistribution[cls] = (classDistribution[cls] || 0) + 1;

      const src = p.source || "unknown";
      sourceDistribution[src] = (sourceDistribution[src] || 0) + 1;

      const combined = `${p.normalizedTitle || ""} ${p.normalizedAbstract || ""} ${(p.compoundTags || []).join(" ")} ${(p.keywords || []).join(" ")}`.toLowerCase();

      const compounds = extractCompounds(combined);
      for (const c of compounds) {
        compoundCount.set(c, (compoundCount.get(c) || 0) + 1);
        if (!compoundPapers.has(c)) compoundPapers.set(c, new Set());
        compoundPapers.get(c)!.add(p.canonicalId || p.id || "");
      }

      for (const kw of p.compoundTags || []) {
        keywordCount.set(kw, (keywordCount.get(kw) || 0) + 1);
      }
      for (const kw of p.regulatoryTags || []) {
        keywordCount.set(kw, (keywordCount.get(kw) || 0) + 1);
      }
      for (const kw of p.studyTags || []) {
        keywordCount.set(kw, (keywordCount.get(kw) || 0) + 1);
      }

      const pubDate = p.publishedDate || p.lastSeenAt || p.ingestedAt;
      if (pubDate) {
        const monthKey = pubDate.slice(0, 7);
        if (!publicationBuckets.has(monthKey)) publicationBuckets.set(monthKey, new Set());
        publicationBuckets.get(monthKey)!.add(p.canonicalId || p.id || "");

        for (const c of compounds) {
          if (!compoundPeriodBuckets.has(monthKey)) compoundPeriodBuckets.set(monthKey, new Set());
          compoundPeriodBuckets.get(monthKey)!.add(c);

          // Track numeric counts per compound per period for burst detection & Mann-Kendall
          if (!compoundPeriodCounts.has(c)) compoundPeriodCounts.set(c, new Map());
          const cMap = compoundPeriodCounts.get(c)!;
          cMap.set(monthKey, (cMap.get(monthKey) || 0) + 1);
        }
      }

      const tags = [...(p.compoundTags || []), ...(p.regulatoryTags || []), ...(p.studyTags || [])];
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
          const pair = [tags[i], tags[j]].sort().join("+");
          cooccurrenceCount.set(pair, (cooccurrenceCount.get(pair) || 0) + 1);
        }
      }
    }

    const topCompounds = [...compoundCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({
        name,
        count,
        trend: computeTrendDirection(name, compoundPeriodBuckets),
      }));

    const topKeywords = [...keywordCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    const publicationVelocity = [...publicationBuckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, ids]) => ({ period, count: ids.size }));

    const cooccurrence = [...cooccurrenceCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([pair, count]) => ({ pair, count }));

    const openAccessCount = papers.filter((p: PaperRef) => p.isOpenAccess).length;

    const trendCandidates = topCompounds.filter(c => c.trend === "rising" && c.count >= 2).slice(0, 4);
    const trends: ComputedTrend[] = trendCandidates.map(c => {
      const title = c.trend === "rising"
        ? `Rising focus on ${c.name} in hemp literature`
        : `${c.name} appears in ${c.count} indexed publications`;
      const relatedTitles = [...(compoundPapers.get(c.name) || [])].slice(0, 3);
      return {
        id: `trend-${stableHash(title).slice(0, 12)}`,
        tenantId,
        detectedAt: new Date().toISOString(),
        title,
        description: `${c.name} appears in ${c.count} of ${papers.length} indexed papers, trending ${c.trend} in recent publication data.`,
        growthRate: Math.min(95, Math.round((c.count / Math.max(1, papers.length)) * 100)),
        confidence: Math.min(95, 50 + Math.round((c.count / Math.max(1, papers.length)) * 50)),
        category: c.name.length <= 5 ? "Compound" : "Topic",
        relatedPaperTitles: relatedTitles,
        evidence: {
          mentionCount: c.count,
          recentMentionCount: c.count,
          sourceCount: new Set(papers.map((p: PaperRef) => p.source)).size,
        },
      };
    });

    const insights: ComputedInsight[] = [];
    const highRelevancePapers = [...papers]
      .filter((p: PaperRef) => (p.relevanceScore || 0) >= 40)
      .sort((a: PaperRef, b: PaperRef) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

    if (highRelevancePapers.length >= 2) {
      const topComp = topCompounds[0];
      if (topComp) {
        const topRegulatoryTag = topKeywords.find(k =>
          ["compliance", "regulatory", "fda", "usda", "limit", "threshold"].includes(k.name)
        );
        insights.push({
          id: `insight-${stableHash(topComp.name).slice(0, 12)}`,
          tenantId,
          detectedAt: new Date().toISOString(),
          title: `${topComp.name} dominates recent indexed literature`,
          summary: `${topComp.name} is the most frequently mentioned compound, appearing in ${topComp.count} of ${papers.length} papers. This suggests strong research focus in this area.`,
          implications: topRegulatoryTag
            ? `Regulatory keyword '${topRegulatoryTag.name}' co-occurs in indexed papers, indicating compliance-linked research activity.`
            : "Increased formulation or extraction research focus likely.",
          severity: topComp.count > papers.length * 0.5 ? "HIGH" : "MEDIUM",
          relatedCompounds: [topComp.name],
          evidence: {
            supportingPaperCount: topComp.count,
            avgRelevanceScore: Math.round(
              highRelevancePapers.reduce((s: number, p: PaperRef) => s + (p.relevanceScore || 0), 0) / highRelevancePapers.length
            ),
          },
        });
      }
    }

    if (papers.length >= 3 && sourceDistribution["openalex"] && sourceDistribution["pubmed"]) {
      insights.push({
        id: `insight-${stableHash("cross-source").slice(0, 12)}`,
        tenantId,
        detectedAt: new Date().toISOString(),
        title: "Multi-source literature coverage active",
        summary: `Papers indexed from ${Object.keys(sourceDistribution).length} sources (${Object.entries(sourceDistribution).map(([k, v]) => `${k}: ${v}`).join(", ")}), indicating broad cross-referencing.`,
        implications: "Cross-source validation strengthens the reliability of computed trend signals.",
        severity: "LOW",
        relatedCompounds: topCompounds.slice(0, 3).map(c => c.name),
        evidence: {
          supportingPaperCount: papers.length,
          avgRelevanceScore: Math.round(
            papers.reduce((s: number, p: PaperRef) => s + (p.relevanceScore || 0), 0) / papers.length
          ),
        },
      });
    }

    const simulations: ComputedSimulation[] = [];
    if (topCompounds.length > 0) {
      simulations.push({
        id: `trial-auto-${stableHash("compound-blend").slice(0, 8)}`,
        tenantId,
        date: new Date().toISOString().split("T")[0],
        name: "Compound Synergy Blend Optimization",
        type: "Formulation",
        parameters: {
          compounds: topCompounds.slice(0, 3).map(c => c.name).join(", "),
          blendRatio: "1:1:1",
          temperature: 120,
          duration: 45,
        },
        results: {
          synergyScore: Math.min(95, 40 + topCompounds.length * 8),
          compliance: "PENDING_ANALYSIS",
        },
        status: "simulated_from_literature",
        notes: `Based on co-occurrence of ${topCompounds.slice(0, 3).map(c => c.name).join(", ")} in ${papers.length} indexed papers.`,
      });
    }

    const citationCounts = papers.filter((p: PaperRef) => (p.citationCount || 0) > 0);
    if (citationCounts.length > 0) {
      const avgCitations = citationCounts.reduce((s: number, p: PaperRef) => s + (p.citationCount || 0), 0) / citationCounts.length;
      simulations.push({
        id: `trial-auto-${stableHash("citation-impact").slice(0, 8)}`,
        tenantId,
        date: new Date().toISOString().split("T")[0],
        name: "Citation Impact Analysis",
        type: "Bibliometric",
        parameters: {
          paperCount: papers.length,
          papersWithCitations: citationCounts.length,
          avgCitations: Math.round(avgCitations * 10) / 10,
        },
        results: {
          totalCitationCount: citationCounts.reduce((s: number, p: PaperRef) => s + (p.citationCount || 0), 0),
          hIndexEstimate: Math.min(citationCounts.length, Math.round(Math.sqrt(avgCitations * citationCounts.length))),
        },
        status: "completed",
        notes: `Aggregate bibliometric analysis of ${papers.length} papers across ${Object.keys(sourceDistribution).length} sources.`,
      });
    }

    const anomalies = detectAnomalies(publicationVelocity);
    const temporalAcceleration = detectTemporalAcceleration(publicationVelocity);
    const compoundClusters = clusterCompounds(compoundCount, cooccurrenceCount);
    const regulatoryRisk = scoreRegulatoryRisk(papers, compoundCount, topCompounds);
    const publicationMomentum = computePublicationMomentum(publicationVelocity);

    // Advanced trend detection: burst detection across compound time series
    const globalPeriodCounts = new Map<string, number>();
    for (const [period, ids] of publicationBuckets.entries()) {
      globalPeriodCounts.set(period, ids.size);
    }
    const burstDetections = detectBursts(compoundPeriodCounts, globalPeriodCounts);

    // Cross-source validation for top compounds
    const crossSourceValidation = computeCrossSourceValidation(papers, topCompounds);

    // Mann-Kendall statistical trend tests for top compounds
    const mannKendallTrends: Record<string, MannKendallResult> = {};
    const sortedPeriods = [...publicationBuckets.keys()].sort();
    for (const tc of topCompounds.slice(0, 8)) {
      const periodMap = compoundPeriodCounts.get(tc.name);
      if (periodMap && sortedPeriods.length >= 4) {
        const timeSeries = sortedPeriods.map(p => periodMap.get(p) || 0);
        mannKendallTrends[tc.name] = mannKendallTest(timeSeries);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      totalPapers: papers.length,
      openAccessCount,
      classDistribution,
      sourceDistribution,
      topCompounds,
      topKeywords,
      publicationVelocity,
      compoundCooccurrence: cooccurrence,
      trends,
      insights,
      simulations,
      anomalies,
      temporalAcceleration,
      compoundClusters,
      regulatoryRisk,
      publicationMomentum,
      burstDetections,
      crossSourceValidation,
      mannKendallTrends,
    };
  } catch (err) {
    console.error("[trendEngine] Error computing trend snapshot:", err);
    return null;
  }
}
