import fs from "fs";
import path from "path";
import crypto from "crypto";
import chokidar from "chokidar";
import mammoth from "mammoth";
import matter from "gray-matter";
import { createRequire } from "module";
import { adminDb, createAuditHash } from "../services/backendServices";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

type LocalDocClass =
  | "paper"
  | "report"
  | "sop"
  | "coa"
  | "notes"
  | "dataset"
  | "general";

interface LocalFolderIndexConfig {
  tenantId: string;
  enabled: boolean;
  watch: boolean;
  folders: string[];
  allowedExtensions: string[];
  maxFileSizeMb: number;
  autoPromoteToResearchPapers: boolean;
}

interface IndexedLocalDocument {
  id: string;
  tenantId: string;
  sourceType: "local-folder";
  filePath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  indexedAt: string;
  fingerprint: string;
  title: string;
  abstract: string;
  textPreview: string;
  fullText?: string;
  metadata: Record<string, any>;
  compoundTags: string[];
  regulatoryTags: string[];
  studyTags: string[];
  docClass: LocalDocClass;
  relevanceScore: number;
  promotedToResearchPapers: boolean;
}

interface LocalIndexRun {
  id: string;
  tenantId: string;
  startedAt: string;
  completedAt?: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  scannedFiles: number;
  indexedFiles: number;
  updatedFiles: number;
  skippedFiles: number;
  promotedFiles: number;
  errors: Array<{ filePath: string; message: string }>;
}

const DEFAULT_CONFIG: LocalFolderIndexConfig = {
  tenantId: "Global-Hemp-Wilson",
  enabled: true,
  watch: true,
  folders: [
    path.resolve(process.cwd(), "local-research"),
  ],
  allowedExtensions: [".pdf", ".txt", ".md", ".json", ".docx"],
  maxFileSizeMb: 25,
  autoPromoteToResearchPapers: true,
};

const COMPOUND_RULES = [
  "thca", "thc", "delta-9-thc", "d9-thc", "cbd", "cbda", "cbc", "cbg", "cbn", "terpene"
];

const REGULATORY_RULES = [
  "regulatory", "compliance", "fda", "usda", "ncda", "gxp", "iso 17025", "threshold", "limit"
];

const STUDY_RULES = [
  "clinical", "kinetics", "stability", "chromatography", "hplc", "gc-ms", "cultivation", "extraction", "formulation"
];

let watcher: any = null;
let runLock = false;

function sha256(input: string | Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeText(input?: string) {
  return (input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(input?: string) {
  return normalizeText(input).toLowerCase();
}

function detectTags(text: string, rules: string[]) {
  const t = lower(text);
  return rules.filter((rule) => t.includes(rule));
}

function classifyDoc(fileName: string, text: string): LocalDocClass {
  const base = `${lower(fileName)} ${lower(text).slice(0, 4000)}`;

  if (base.includes("certificate of analysis") || base.includes("coa")) return "coa";
  if (base.includes("sop") || base.includes("standard operating procedure")) return "sop";
  if (base.includes("report") || base.includes("executive briefing")) return "report";
  if (base.includes("dataset") || base.includes("csv export")) return "dataset";
  if (base.includes("note") || base.includes("meeting")) return "notes";
  if (base.includes("journal") || base.includes("abstract") || base.includes("introduction")) return "paper";
  return "general";
}

function scoreDoc(text: string, fileName: string) {
  const t = lower(`${fileName} ${text}`);
  let score = 0;

  for (const r of COMPOUND_RULES) if (t.includes(r)) score += 8;
  for (const r of REGULATORY_RULES) if (t.includes(r)) score += 10;
  for (const r of STUDY_RULES) if (t.includes(r)) score += 6;

  if (t.includes("hemp")) score += 10;
  if (t.includes("cannabis")) score += 6;
  if (t.includes("north carolina")) score += 8;

  return Math.min(100, score);
}

async function extractTextFromFile(filePath: string): Promise<{ text: string; metadata: Record<string, any> }> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt") {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return { text: raw, metadata: {} };
  }

  if (ext === ".md") {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const parsed = matter(raw);
    return {
      text: parsed.content,
      metadata: parsed.data || {},
    };
  }

  if (ext === ".json") {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    return {
      text: typeof json === "string" ? json : JSON.stringify(json, null, 2),
      metadata: { jsonKeys: typeof json === "object" && json ? Object.keys(json) : [] },
    };
  }

  if (ext === ".pdf") {
    const buffer = await fs.promises.readFile(filePath);
    const parsed = await pdfParse(buffer);
    return {
      text: parsed.text || "",
      metadata: parsed.info || {},
    };
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      text: result.value || "",
      metadata: {},
    };
  }

  throw new Error(`Unsupported file extension: ${ext}`);
}

function buildTitle(fileName: string, text: string, metadata: Record<string, any>) {
  return (
    metadata.title ||
    normalizeText(text).split(". ")[0]?.slice(0, 180) ||
    fileName.replace(path.extname(fileName), "")
  );
}

function buildAbstract(text: string) {
  return normalizeText(text).slice(0, 1200);
}

async function upsertLocalDocument(
  cfg: LocalFolderIndexConfig,
  filePath: string
): Promise<"inserted" | "updated" | "skipped"> {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) return "skipped";

  const ext = path.extname(filePath).toLowerCase();
  if (!cfg.allowedExtensions.includes(ext)) return "skipped";

  const maxBytes = cfg.maxFileSizeMb * 1024 * 1024;
  if (stat.size > maxBytes) return "skipped";

  const raw = await fs.promises.readFile(filePath);
  const contentHash = sha256(raw);
  const docId = `local-${sha256(`${cfg.tenantId}:${filePath}`).slice(0, 24)}`;

  const existingRef = adminDb!.collection("localResearchDocuments").doc(docId);
  const existingSnap = await existingRef.get();

  if (existingSnap.exists) {
    const existing = existingSnap.data() as IndexedLocalDocument;
    if (existing.fingerprint === contentHash) {
      return "skipped";
    }
  }

  const { text, metadata } = await extractTextFromFile(filePath);
  const fileName = path.basename(filePath);
  const title = buildTitle(fileName, text, metadata);
  const abstract = buildAbstract(text);

  const compoundTags = detectTags(text, COMPOUND_RULES);
  const regulatoryTags = detectTags(text, REGULATORY_RULES);
  const studyTags = detectTags(text, STUDY_RULES);
  const docClass = classifyDoc(fileName, text);
  const relevanceScore = scoreDoc(text, fileName);

  const payload: IndexedLocalDocument = {
    id: docId,
    tenantId: cfg.tenantId,
    sourceType: "local-folder",
    filePath,
    fileName,
    extension: ext,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    indexedAt: new Date().toISOString(),
    fingerprint: contentHash,
    title,
    abstract,
    textPreview: normalizeText(text).slice(0, 1500),
    fullText: text.slice(0, 50000),
    metadata,
    compoundTags,
    regulatoryTags,
    studyTags,
    docClass,
    relevanceScore,
    promotedToResearchPapers: false,
  };

  const mode = existingSnap.exists ? "updated" : "inserted";
  await existingRef.set(payload, { merge: true });

  if (cfg.autoPromoteToResearchPapers) {
    await adminDb!.collection("researchPapers").doc(docId).set(
      {
        id: docId,
        title: payload.title,
        abstract: payload.abstract,
        url: `file://${filePath}`,
        source: "local-folder",
        publishedDate: payload.modifiedAt,
        keywords: [...compoundTags, ...regulatoryTags, ...studyTags],
        isOpenAccess: false,
        ingestedAt: payload.indexedAt,
        tenantId: cfg.tenantId,
        localFilePath: filePath,
        relevanceScore,
        productionClass: docClass,
      },
      { merge: true }
    );

    await existingRef.set({ promotedToResearchPapers: true }, { merge: true });
  }

  return mode;
}

async function walkDir(dir: string, files: string[] = []): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(resolved, files);
    } else {
      files.push(resolved);
    }
  }

  return files;
}

async function writeAudit(tenantId: string, run: LocalIndexRun) {
  const entry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    userId: "system-local-folder-indexer",
    userRole: "System",
    tenantId,
    action: "LOCAL_FOLDER_INDEX_RUN",
    details: `Indexed local folder content. Scanned ${run.scannedFiles}, inserted ${run.indexedFiles}, updated ${run.updatedFiles}, skipped ${run.skippedFiles}.`,
    category: "SYSTEM_INTEGRATION" as const,
  };

  await adminDb!.collection("auditLogs").doc(entry.id).set({
    ...entry,
    hash: createAuditHash(entry),
  });
}

export async function runLocalFolderIndexing(config: Partial<LocalFolderIndexConfig> = {}) {
  if (!adminDb) {
    console.warn("[localFolderIndexer] Firebase Admin not initialized.");
    return;
  }

  if (runLock) {
    console.warn("[localFolderIndexer] Index run skipped because another run is active.");
    return;
  }

  const cfg: LocalFolderIndexConfig = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) return;

  runLock = true;
  const runId = `local-index-${Date.now()}`;
  const run: LocalIndexRun = {
    id: runId,
    tenantId: cfg.tenantId,
    startedAt: new Date().toISOString(),
    status: "RUNNING",
    scannedFiles: 0,
    indexedFiles: 0,
    updatedFiles: 0,
    skippedFiles: 0,
    promotedFiles: 0,
    errors: [],
  };

  await adminDb.collection("localResearchRuns").doc(runId).set(run);

  // Ensure watched directories exist
  for (const folder of cfg.folders) {
    if (!fs.existsSync(folder)) {
      console.warn(`[localFolderIndexer] Directory '${folder}' does not exist. Creating it with a placeholder.`);
      try {
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(
          path.join(folder, ".gitkeep"),
          "Place this directory under version control or add local research files here.\n"
        );
      } catch (mkdirErr) {
        console.warn(`[localFolderIndexer] Could not create directory '${folder}':`, mkdirErr);
      }
    }
  }

  try {
    const allFiles: string[] = [];
    for (const folder of cfg.folders) {
      if (!fs.existsSync(folder)) continue;
      const files = await walkDir(folder);
      allFiles.push(...files);
    }

    run.scannedFiles = allFiles.length;

    for (const filePath of allFiles) {
      try {
        const result = await upsertLocalDocument(cfg, filePath);
        if (result === "inserted") {
          run.indexedFiles += 1;
          if (cfg.autoPromoteToResearchPapers) run.promotedFiles += 1;
        } else if (result === "updated") {
          run.updatedFiles += 1;
          if (cfg.autoPromoteToResearchPapers) run.promotedFiles += 1;
        } else {
          run.skippedFiles += 1;
        }
      } catch (err: any) {
        run.errors.push({
          filePath,
          message: err?.message || "Unknown indexing failure",
        });
      }
    }

    run.status = "COMPLETED";
    run.completedAt = new Date().toISOString();
    await adminDb.collection("localResearchRuns").doc(runId).set(run, { merge: true });
    await writeAudit(cfg.tenantId, run);
  } catch (err: any) {
    run.status = "FAILED";
    run.completedAt = new Date().toISOString();
    run.errors.push({
      filePath: "SYSTEM",
      message: err?.message || "Unhandled local indexing failure",
    });
    await adminDb.collection("localResearchRuns").doc(runId).set(run, { merge: true });
    throw err;
  } finally {
    runLock = false;
  }
}

export function startLocalFolderIndexer(config: Partial<LocalFolderIndexConfig> = {}) {
  const cfg: LocalFolderIndexConfig = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) return;

  runLocalFolderIndexing(cfg).catch((err) => {
    console.error("[localFolderIndexer] Initial scan failed:", err);
  });

  if (!cfg.watch) return;

  watcher = chokidar.watch(cfg.folders, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  });

  const trigger = (filePath: string) => {
    upsertLocalDocument(cfg, filePath).catch((err) => {
      console.error(`[localFolderIndexer] Failed to index ${filePath}:`, err);
    });
  };

  watcher.on("add", trigger);
  watcher.on("change", trigger);

  console.log("[localFolderIndexer] Watching folders:", cfg.folders);
}

export async function stopLocalFolderIndexer() {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}
