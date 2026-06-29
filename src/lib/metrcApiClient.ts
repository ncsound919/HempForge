/**
 * metrcApiClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin, typed wrapper around the Metrc v2 REST API.
 *
 * Required env vars:
 *   METRC_API_KEY        — Metrc vendor + user API key (base64 encoded pair)
 *   METRC_BASE_URL       — e.g. https://api-nc.metrc.com  (no trailing slash)
 *   METRC_LICENSE_NUMBER — NC hemp grower/processor license number
 *
 * All reads are write-through cached to Firestore via the caller (metrc.ts).
 * This client has zero side effects — it only fetches from Metrc and returns.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface MetrcApiPackage {
  Id: number;
  Label: string;
  PackageType: string;
  ProductName: string;
  ProductCategoryName: string;
  Quantity: number;
  UnitOfMeasureName: string;
  ReceivedDateTime: string | null;
  LastModified: string;
  LabTestingState: string;
  Item: {
    Name: string;
    ProductCategoryName: string;
    StrainName: string | null;
  };
}

export interface MetrcApiLabResult {
  PackageId: number;
  PackageLabel: string;
  TestTypeName: string;
  Status: string;
  ResultReleaseDateTime: string;
  LabFacilityName: string;
  Results: Array<{
    TestTypeName: string;
    ResultLevel: number;
    Passed: boolean;
    TestComment: string | null;
  }>;
}

function getMetrcConfig() {
  const apiKey = process.env.METRC_API_KEY?.trim();
  const baseUrl = process.env.METRC_BASE_URL?.trim().replace(/\/$/, "");
  const licenseNumber = process.env.METRC_LICENSE_NUMBER?.trim();

  if (!apiKey || !baseUrl || !licenseNumber) {
    return null;
  }
  return { apiKey, baseUrl, licenseNumber };
}

export function isMetrcConfigured(): boolean {
  return getMetrcConfig() !== null;
}

async function metrcFetch<T>(path: string): Promise<T> {
  const config = getMetrcConfig();
  if (!config) {
    throw new Error(
      "Metrc is not configured. Set METRC_API_KEY, METRC_BASE_URL, and METRC_LICENSE_NUMBER."
    );
  }

  const url = `${config.baseUrl}${path}?licenseNumber=${encodeURIComponent(config.licenseNumber)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Metrc API error ${response.status} on ${path}: ${body.slice(0, 200)}`
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Fetch all active packages for the configured license.
 */
export async function fetchMetrcPackages(): Promise<MetrcApiPackage[]> {
  return metrcFetch<MetrcApiPackage[]>("/packages/v2/active");
}

/**
 * Fetch all on-hold packages (awaiting lab results).
 */
export async function fetchMetrcPackagesOnHold(): Promise<MetrcApiPackage[]> {
  return metrcFetch<MetrcApiPackage[]>("/packages/v2/onhold");
}

/**
 * Fetch lab results for a specific package label.
 */
export async function fetchMetrcLabResults(
  packageLabel: string
): Promise<MetrcApiLabResult[]> {
  return metrcFetch<MetrcApiLabResult[]>(
    `/labtests/v2/results?packageLabel=${encodeURIComponent(packageLabel)}`
  );
}

/**
 * Normalize a Metrc API package into HempForge's internal MetrcPackage shape.
 */
export function normalizeMetrcPackage(
  raw: MetrcApiPackage,
  tenantId: string
) {
  return {
    packageId: raw.Label,
    licenseNumber: process.env.METRC_LICENSE_NUMBER || "",
    itemStrain: raw.Item?.StrainName || raw.Item?.Name || "Unknown",
    productType: mapProductType(raw.ProductCategoryName),
    quantity: raw.Quantity,
    unitOfMeasure: mapUnitOfMeasure(raw.UnitOfMeasureName),
    status: mapLabTestingState(raw.LabTestingState),
    lastSyncDate: new Date().toISOString(),
    metrcLastModified: raw.LastModified,
    tenantId,
  };
}

function mapProductType(
  category: string
): "Flower" | "Concentrate" | "Infused-Edible" | "Topical" {
  const c = (category || "").toLowerCase();
  if (c.includes("flower") || c.includes("hemp")) return "Flower";
  if (c.includes("concentrate") || c.includes("extract")) return "Concentrate";
  if (c.includes("edible") || c.includes("beverage") || c.includes("food"))
    return "Infused-Edible";
  if (c.includes("topical") || c.includes("lotion")) return "Topical";
  return "Flower";
}

function mapUnitOfMeasure(
  unit: string
): "Grams" | "Ounces" | "Units" {
  const u = (unit || "").toLowerCase();
  if (u.includes("gram")) return "Grams";
  if (u.includes("ounce")) return "Ounces";
  return "Units";
}

function mapLabTestingState(
  state: string
): "In-Transit" | "In-Inventory" | "Testing-Pending" | "Testing-Passed" | "Testing-Failed" {
  const s = (state || "").toLowerCase();
  if (s.includes("passed") || s === "testingpassed") return "Testing-Passed";
  if (s.includes("failed") || s === "testingfailed") return "Testing-Failed";
  if (s.includes("pending") || s.includes("submitted")) return "Testing-Pending";
  if (s.includes("transit")) return "In-Transit";
  return "In-Inventory";
}
