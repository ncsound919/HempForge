import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore as getAdminFirestore, Firestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

type JsonMap = Record<string, any>;

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
// Determine fallback explicitly at startup
const useLocalFallback = process.env.USE_LOCAL_DB_FALLBACK === "true" || !fs.existsSync(configPath);

let firebaseConfig: any = null;
if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error("Failed to parse firebase-applet-config.json:", err);
  }
}

function getCredential() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      return cert(JSON.parse(serviceAccountJson));
    } catch (e) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", e);
    }
  }
  return applicationDefault();
}

function getAdminAppSafe() {
  if (getApps().length > 0) return getApps()[0];

  const projectId =
    firebaseConfig?.projectId ||
    process.env.FIREBASE_PROJECT_ID;

  if (!projectId && !useLocalFallback) {
    throw new Error("Missing Firebase project configuration.");
  }

  return initializeApp({
    credential: getCredential(),
    projectId,
  });
}

export class LocalFirestoreDB {
  private filePath = path.join(process.cwd(), "local-db-fallback.json");

  readData(): JsonMap {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      }
    } catch (err) {
      console.error("Local DB read failed:", err);
    }
    return {};
  }

  writeData(data: JsonMap) {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      console.error("Local DB write failed:", err);
    }
  }

  collection(collectionName: string) {
    return new LocalQuery(this, collectionName);
  }

  async getCollection(name: string): Promise<any[]> {
    const data = this.readData();
    const items = data[name] || {};
    return Object.entries(items).map(([id, value]) => ({ id, ...(value as object) }));
  }

  async setDoc(collection: string, docId: string, value: any, merge = true): Promise<void> {
    const data = this.readData();
    if (!data[collection]) data[collection] = {};
    const current = data[collection][docId] || {};
    data[collection][docId] = merge ? { ...current, ...value } : value;
    this.writeData(data);
  }
}

class LocalQuery {
  constructor(
    private db: LocalFirestoreDB,
    private collectionName: string,
    private filters: { field: string; op: string; val: any }[] = [],
    private sortField: string | null = null,
    private sortDirection: "asc" | "desc" = "asc",
    private limitCount: number | null = null
  ) {}

  doc(docId: string) {
    return new LocalDoc(this.db, this.collectionName, docId);
  }

  where(field: string, op: string, val: any) {
    return new LocalQuery(
      this.db,
      this.collectionName,
      [...this.filters, { field, op, val }],
      this.sortField,
      this.sortDirection,
      this.limitCount
    );
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return new LocalQuery(
      this.db,
      this.collectionName,
      this.filters,
      field,
      direction,
      this.limitCount
    );
  }

  limit(count: number) {
    return new LocalQuery(
      this.db,
      this.collectionName,
      this.filters,
      this.sortField,
      this.sortDirection,
      count
    );
  }

  async get() {
    const data = this.db.readData();
    const items = data[this.collectionName] || {};
    let docs = Object.entries(items).map(([id, val]: any) => ({
      id,
      ...val,
      data: () => val,
      exists: true,
    }));

    // Apply filters
    for (const filter of this.filters) {
      docs = docs.filter((doc: any) => {
        const val = doc[filter.field];
        if (filter.op === "==") return val === filter.val;
        if (filter.op === ">") return val > filter.val;
        if (filter.op === "<") return val < filter.val;
        return true;
      });
    }

    // Apply sorting
    if (this.sortField) {
      const field = this.sortField;
      const dir = this.sortDirection === "desc" ? -1 : 1;
      docs.sort((a: any, b: any) => {
        const valA = a[field];
        const valB = b[field];
        if (valA === undefined) return 1;
        if (valB === undefined) return -1;
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
      });
    }

    // Apply limit
    if (this.limitCount !== null) {
      docs = docs.slice(0, this.limitCount);
    }

    return {
      docs,
      empty: docs.length === 0,
      forEach: (cb: any) => docs.forEach(cb),
      map: (cb: any) => docs.map(cb),
    };
  }
}

class LocalDoc {
  constructor(
    private db: LocalFirestoreDB,
    private collectionName: string,
    private docId: string
  ) {}

  async get() {
    const data = this.db.readData();
    const items = data[this.collectionName] || {};
    const val = items[this.docId];
    return {
      exists: val !== undefined,
      id: this.docId,
      data: () => val,
    };
  }

  async set(docData: any, options?: any) {
    const data = this.db.readData();
    if (!data[this.collectionName]) {
      data[this.collectionName] = {};
    }
    const current = data[this.collectionName][this.docId] || {};
    if (options && options.merge) {
      data[this.collectionName][this.docId] = { ...current, ...docData };
    } else {
      data[this.collectionName][this.docId] = docData;
    }
    this.db.writeData(data);
  }
}

export const localDb = new LocalFirestoreDB();

let adminDb: any = null;

try {
  if (!useLocalFallback) {
    const app = getAdminAppSafe();
    const databaseId = firebaseConfig?.firestoreDatabaseId || "(default)";
    adminDb = getAdminFirestore(app, databaseId);
    console.log("Firebase Admin initialized for database:", databaseId);
  } else {
    console.warn("Using local DB fallback because USE_LOCAL_DB_FALLBACK=true or firebase-applet-config.json is missing");
    adminDb = localDb;
  }
} catch (err) {
  console.error("Admin Firestore initialization failed, falling back to local DB:", err);
  adminDb = localDb;
}

export { adminDb };

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userRole: string;
  tenantId: string;
  action: string;
  details: string;
  category: "DATA_CHANGE" | "SYSTEM_INTEGRATION" | "AI_INFERENCE" | "AUTH" | "COMPLIANCE_ALARM";
  hash: string;
  /** Sequence number for chain-linked audit entries (ALCOA+ criterion 4) */
  sequenceNumber?: number;
  /** Hash of the previous chain-linked entry */
  previousHash?: string;
  /** Output classification for truthfulness tracking */
  outputClassification?: string;
}

export interface MetrcPackage {
  packageId: string;
  licenseNumber: string;
  itemStrain: string;
  productType: "Flower" | "Concentrate" | "Infused-Edible" | "Topical";
  quantity: number;
  unitOfMeasure: "Grams" | "Ounces" | "Units";
  status: "In-Transit" | "In-Inventory" | "Testing-Pending" | "Testing-Passed" | "Testing-Failed";
  lastSyncDate: string;
  tenantId: string;
}

export interface CsaValidationRun {
  runId: string;
  agentName: string;
  version: string;
  intendedUse: string;
  riskRating: "Low" | "Medium" | "High";
  testScenario: string;
  status: "VALIDATED" | "PENDING_REVIEW" | "FAILED";
  runParameters: {
    temperature: number;
    thresholdCap: number;
    decarbFormula: string;
  };
  validatedAt: string;
  verifiedBy: string;
  tenantId: string;
}

export interface ISOLab {
  id: string;
  name: string;
  location: string;
  isoAccreditation: string;
  certificateNumber: string;
  activeHandshake: boolean;
  tenantId: string;
}

export async function fetchFromFirestore(
  collectionPath: string,
  _authToken: string
): Promise<any[]> {
  if (adminDb && adminDb !== localDb) {
    try {
      const snapshot = await adminDb.collection(collectionPath).get();
      return snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (err) {
      console.error(`Admin Firestore read error on ${collectionPath}:`, err);
    }
  }

  return localDb.getCollection(collectionPath);
}

export async function writeToFirestore(
  collectionPath: string,
  docId: string,
  data: any,
  _authToken: string
): Promise<void> {
  if (adminDb && adminDb !== localDb) {
    try {
      await adminDb.collection(collectionPath).doc(docId).set(data, { merge: true });
      return;
    } catch (err) {
      console.error(`Admin Firestore write error on ${collectionPath}/${docId}:`, err);
    }
  }

  await localDb.setDoc(collectionPath, docId, data, true);
}

// -------------------------------------------------------------
// Dynamic, Tenant-Scoped Access Functions
// -------------------------------------------------------------

export async function getMetrcPackages(authToken: string, tenantId: string): Promise<MetrcPackage[]> {
  try {
    const raw = await fetchFromFirestore("metrcPackages", authToken);
    return raw.filter((p) => p.tenantId === tenantId) as MetrcPackage[];
  } catch (err) {
    console.error("Error scoping metrc packages:", err);
    return [];
  }
}

export async function saveMetrcPackage(pkg: MetrcPackage, authToken: string, tenantId: string): Promise<void> {
  try {
    pkg.tenantId = tenantId;
    await writeToFirestore("metrcPackages", pkg.packageId, pkg, authToken);
  } catch (err) {
    console.error("Error saving metrc package:", err);
  }
}

export async function getCsaValidationRuns(authToken: string, tenantId: string): Promise<CsaValidationRun[]> {
  try {
    const raw = await fetchFromFirestore("csaValidationRuns", authToken);
    return (raw.filter((r) => r.tenantId === tenantId) as CsaValidationRun[])
      .sort((a, b) => new Date(b.validatedAt).getTime() - new Date(a.validatedAt).getTime());
  } catch (err) {
    console.error("Error scoping CSA validation runs:", err);
    return [];
  }
}

export async function saveCsaValidationRun(run: CsaValidationRun, authToken: string, tenantId: string): Promise<void> {
  try {
    run.tenantId = tenantId;
    await writeToFirestore("csaValidationRuns", run.runId, run, authToken);
  } catch (err) {
    console.error("Error saving CSA run:", err);
  }
}

export async function getIsoLabs(authToken: string, tenantId: string): Promise<ISOLab[]> {
  try {
    const raw = await fetchFromFirestore("isoLabs", authToken);
    return raw.filter((l) => l.tenantId === tenantId) as ISOLab[];
  } catch (err) {
    console.error("Error scoping ISO labs:", err);
    return [];
  }
}

export async function saveIsoLab(lab: ISOLab, authToken: string, tenantId: string): Promise<void> {
  try {
    lab.tenantId = tenantId;
    await writeToFirestore("isoLabs", lab.id, lab, authToken);
  } catch (err) {
    console.error("Error saving ISO lab:", err);
  }
}

export async function getCoas(authToken: string, tenantId: string): Promise<any[]> {
  try {
    const raw = await fetchFromFirestore("coas", authToken);
    return raw.filter((c) => c.tenantId === tenantId);
  } catch (err) {
    console.error("Error reading COAs from Firestore:", err);
    return [];
  }
}

export async function saveCoa(coa: any, authToken: string, tenantId: string): Promise<void> {
  try {
    coa.tenantId = tenantId;
    await writeToFirestore("coas", coa.id, coa, authToken);
  } catch (err) {
    console.error("Error writing COA to Firestore:", err);
  }
}

export async function getLiteratureCache(authToken: string, tenantId: string): Promise<any[]> {
  try {
    const raw = await fetchFromFirestore("literatureCache", authToken);
    return raw.filter((p) => p.tenantId === tenantId);
  } catch (err) {
    console.error("Error reading literatureCache from Firestore:", err);
    return [];
  }
}

export async function saveLiteraturePaper(paper: any, authToken: string, tenantId: string): Promise<void> {
  try {
    paper.tenantId = tenantId;
    const docId = String(paper.id).replace(/\//g, "_");

    // Deduplication: if paper has a DOI, check for existing entry with same DOI
    if (paper.doi) {
      const doiKey = paper.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').trim();
      const existingPapers = await fetchFromFirestore("literatureCache", authToken);
      const duplicate = existingPapers.find(
        (p: any) =>
          p.tenantId === tenantId &&
          p.doi &&
          p.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').trim() === doiKey
      );
      if (duplicate) {
        console.log(`[dedup] Paper with DOI ${doiKey} already exists (id: ${duplicate.id}); skipping save.`);
        return;
      }
    }

    // Dedup by URL hash as secondary key
    if (paper.url && !paper.doi) {
      const urlKey = paper.url.replace(/\/+$/, '').toLowerCase();
      const existingPapers = await fetchFromFirestore("literatureCache", authToken);
      const duplicate = existingPapers.find(
        (p: any) =>
          p.tenantId === tenantId &&
          p.url &&
          p.url.replace(/\/+$/, '').toLowerCase() === urlKey
      );
      if (duplicate) {
        console.log(`[dedup] Paper with URL ${urlKey} already exists (id: ${duplicate.id}); skipping save.`);
        return;
      }
    }

    await writeToFirestore("literatureCache", docId, paper, authToken);
  } catch (err) {
    console.error("Error writing literature paper to Firestore:", err);
  }
}
