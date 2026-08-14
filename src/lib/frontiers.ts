/**
 * src/lib/frontiers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontier taxonomy. HempForge organizes research, experiments, and product
 * briefs around five concrete research frontiers where the science and market
 * demand are active but evidence is fragmented.
 *
 *   minorCannabinoids  — THCV, CBG, CBN, CBC, CBDV (and minor acids)
 *   fiberIndustrial    — bast fiber, hurd, composites, mechanical properties
 *   regenerative       — soil health, rotation, cover cropping, weed suppression
 *   organicProduction  — certified-organic constraints, biological IPM
 *   precisionSensing   — mold/pollen/threat sensing, sensor fusion, alerts
 *
 * Every signal in the literature and experiment queue is tagged with one or
 * more of these. The platform surfaces a frontier breakdown in the autonomy
 * status so users can see where their research is heading.
 */

export const FRONTIERS = [
  "minorCannabinoids",
  "fiberIndustrial",
  "regenerative",
  "organicProduction",
  "precisionSensing",
] as const;

export type Frontier = (typeof FRONTIERS)[number];

export interface FrontierMeta {
  id: Frontier;
  label: string;
  description: string;
  productSurface: string;
  queries: string[];
  compounds: string[];
  benchmarkKinds: string[];
}

export const FRONTIER_META: Record<Frontier, FrontierMeta> = {
  minorCannabinoids: {
    id: "minorCannabinoids",
    label: "Minor Cannabinoids",
    description:
      "THCV, CBG, CBN, CBC, CBDV and acidic forms — science + market demand are growing but evidence and productization are fragmented.",
    productSurface: "Literature radar, experiment tracking, formulation benchmarking, product briefs.",
    queries: [
      "THCV pharmacology",
      "CBG cannabinoid",
      "CBN sleep efficacy",
      "CBC anti-inflammatory",
      "minor cannabinoid bioavailability",
      "cannabidivarin CBDV",
      "cannabinoid acid decarboxylation",
    ],
    compounds: ["THCV", "CBG", "CBGa", "CBN", "CBC", "CBDV", "CBL", "CBT"],
    benchmarkKinds: ["decarb-kinetics", "bioavailability", "stability", "synergy"],
  },
  fiberIndustrial: {
    id: "fiberIndustrial",
    label: "Fiber & Industrial Hemp",
    description:
      "Mechanical properties, processing traceability, and buyer-spec matching are still being evaluated.",
    productSurface: "Material quality scoring, processing traceability, buyer-spec matching.",
    queries: [
      "hemp bast fiber tensile",
      "hemp hurd composite",
      "industrial hemp decortication",
      "hemp fiber length distribution",
      "hemp fiber moisture content",
      "natural fiber composite mechanical",
    ],
    compounds: [],
    benchmarkKinds: ["tensile-strength", "fiber-length", "moisture", "decortication-yield"],
  },
  regenerative: {
    id: "regenerative",
    label: "Regenerative Hemp",
    description:
      "Soil health, weed suppression, resilient rotations, and carbon outcomes are active research themes.",
    productSurface: "Field trial manager, soil-performance dashboard, rotation intelligence.",
    queries: [
      "hemp cover crop",
      "hemp soil carbon sequestration",
      "hemp rotation weed suppression",
      "hemp phytoremediation",
      "regenerative hemp agriculture",
      "hemp soil health mycorrhizal",
    ],
    compounds: [],
    benchmarkKinds: ["soil-carbon", "weed-suppression", "yield-following-crop"],
  },
  organicProduction: {
    id: "organicProduction",
    label: "Organic Production",
    description:
      "Grower pain points and production challenges remain significant; OMRI-listed input constraints.",
    productSurface: "Constraint mapping, benchmark analytics, decision support.",
    queries: [
      "organic hemp production",
      "OMRI hemp pest management",
      "hemp biological pest control",
      "organic certification hemp",
      "hemp IPM thrips",
    ],
    compounds: [],
    benchmarkKinds: ["input-cost", "yield", "pest-incidence"],
  },
  precisionSensing: {
    id: "precisionSensing",
    label: "Precision Sensing",
    description:
      "Mold, pollen, and crop threat detection affect profitability; sensor fusion and intervention logs.",
    productSurface: "Sensor fusion, anomaly alerts, intervention logs.",
    queries: [
      "hemp bud rot detection sensor",
      "pollen count hemp field",
      "hemp disease early detection",
      "spectral imaging cannabis",
      "humidity mold hemp",
      "IoT hemp cultivation",
    ],
    compounds: [],
    benchmarkKinds: ["detection-latency", "false-positive-rate", "sensor-coverage"],
  },
};

export function detectFrontier(text: string): Frontier[] {
  const lower = (text || "").toLowerCase();
  const hits = new Set<Frontier>();
  for (const id of FRONTIERS) {
    const meta = FRONTIER_META[id];
    for (const q of meta.queries) {
      if (lower.includes(q.toLowerCase().split(" ")[0]) && lower.includes(q.toLowerCase().split(" ").slice(-1)[0])) {
        hits.add(id);
        break;
      }
    }
    for (const c of meta.compounds) {
      if (lower.includes(c.toLowerCase())) {
        hits.add(id);
        break;
      }
    }
  }
  return [...hits];
}

export function emptyFrontierBreakdown(): Record<Frontier, number> {
  return {
    minorCannabinoids: 0,
    fiberIndustrial: 0,
    regenerative: 0,
    organicProduction: 0,
    precisionSensing: 0,
  };
}