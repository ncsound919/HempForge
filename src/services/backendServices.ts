import { getApps, initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { AuditLog, writeToFirestore, fetchFromFirestore } from "../lib/firebaseService";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** Roles that require MFA in production. */
const MFA_REQUIRED_ROLES = new Set(["Lab Admin", "Quality Auditor"]);

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = null;
export let adminDb: any = null;

if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.error("Error reading firebase-applet-config.json:", error);
  }
}

// ─── Startup validation ──────────────────────────────────────────────────────
// Fail-fast on misconfiguration. Production refuses to boot without
// (a) a Firebase projectId in firebase-applet-config.json, (b) a sufficiently
// long COA_SIGNING_SECRET, and (c) an explicit CORS_ORIGIN allow-list.
// Local/test environments skip the CORS check (Vite dev server origin varies).

function validateStartupConfig(): void {
  const projectId =
    firebaseConfig?.projectId || process.env.FIREBASE_PROJECT_ID;

  if (!projectId || !projectId.trim()) {
    if (IS_PRODUCTION) {
      throw new Error(
        "Refusing to start: firebase-applet-config.json is missing projectId. " +
        "Production requires a configured Firebase project."
      );
    }
    console.warn("[startup] firebase-applet-config.json missing projectId — relying on USE_LOCAL_DB_FALLBACK.");
  }

  const signingSecret = process.env.COA_SIGNING_SECRET;
  if (!signingSecret || signingSecret.length < 32) {
    if (IS_PRODUCTION) {
      throw new Error(
        "Refusing to start: COA_SIGNING_SECRET is missing or shorter than 32 characters. " +
        "Production requires a strong HMAC secret for COA signatures."
      );
    }
    console.warn(
      `[startup] COA_SIGNING_SECRET is ${signingSecret ? "weak" : "missing"} — COA signing will be disabled. ` +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }

  if (IS_PRODUCTION && !process.env.CORS_ORIGIN) {
    throw new Error(
      "Refusing to start: CORS_ORIGIN is not set. Production requires an explicit " +
      "comma-separated allow-list of origins (e.g. https://app.hempforge.com)."
    );
  }
}

validateStartupConfig();

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

  if (!projectId) {
    throw new Error("Missing FIREBASE_PROJECT_ID for Firebase Admin initialization.");
  }

  return initializeApp({
    credential: getCredential(),
    projectId,
  });
}

try {
  const app = getAdminAppSafe();
  const databaseId = firebaseConfig?.firestoreDatabaseId || "(default)";
  adminDb = getAdminFirestore(app, databaseId);
} catch (error) {
  console.error("Failed to initialize Firebase Admin:", error);
  adminDb = null;
}

// Helper to sign audit entries (ALCOA++)
export function createAuditHash(log: Omit<AuditLog, "hash">): string {
  const content = `${log.id}-${log.timestamp}-${log.userId}-${log.userRole}-${log.action}-${log.details}-${log.category}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

// Cryptographic signature for GxP COA verification
export function signCoa(coa: any): string {
  const secret = process.env.COA_SIGNING_SECRET;
  if (!secret) {
    throw new Error("COA_SIGNING_SECRET environment variable is not configured. Set it in .env before signing certificates.");
  }
  const content = `${coa.id}|${coa.batchId}|${coa.strain}|${coa.totalThc}|${coa.status}`;
  return crypto.createHmac("sha256", secret).update(content).digest("hex");
}

// Durable Firestore Persistence Access Functions
export async function getAuditLogs(authToken: string): Promise<AuditLog[]> {
  try {
    const logs = await fetchFromFirestore("auditLogs", authToken);
    return logs.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) as AuditLog[];
  } catch (err) {
    console.error("Error reading audit logs:", err);
    return [];
  }
}

export async function saveAuditLog(log: Omit<AuditLog, "hash">, authToken: string): Promise<void> {
  try {
    await writeToFirestore("auditLogs", log.id, log, authToken);
  } catch (err) {
    console.error("Error writing audit log:", err);
  }
}

// Authentication & Tenant Extraction Middleware
export interface AuthContext {
  userId: string;
  userEmail: string;
  userRole: string;
  tenantId: string;
}

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
      firebaseToken?: string | null;
      decodedClaims?: any;
    }
  }
}

export function deriveTenantAndRole(decoded: any): { tenantId: string; userRole: string } {
  const email = decoded.email || "unknown@domain.com";
  const adminEmail = process.env.ADMIN_EMAIL || "admin@hempforge.lan";

  const tenantId =
    typeof decoded.tenantId === "string" && decoded.tenantId.trim()
      ? decoded.tenantId
      : email.endsWith("@gmail.com") || email === adminEmail
      ? "Global-Hemp-Wilson"
      : `Tenant-${email.split("@")[1].replace(/\./g, "-")}`;

  const userRole =
    typeof decoded.role === "string" && decoded.role.trim()
      ? decoded.role
      : email.includes("auditor")
      ? "Quality Auditor"
      : "Lab Admin";

  return { tenantId, userRole };
}

/**
 * Strict extractor for the auth middleware path. Requires tenantId and role
 * to be present on the verified token claims. Falls back to email inference
 * only in non-production environments to keep the demo tenant working.
 *
 * Returns null if a production request lacks an explicit tenantId claim.
 */
function extractStrictTenantAndRole(decoded: any): { tenantId: string; userRole: string } | null {
  const claimTenant =
    typeof decoded.tenantId === "string" && decoded.tenantId.trim() ? decoded.tenantId : "";
  const claimRole =
    typeof decoded.role === "string" && decoded.role.trim() ? decoded.role : "";

  if (claimTenant && claimRole) {
    return { tenantId: claimTenant, userRole: claimRole };
  }

  if (IS_PRODUCTION) {
    return null;
  }

  // Non-production: allow the legacy fallback so the demo tenant still works.
  return deriveTenantAndRole(decoded);
}

export async function ensureUserProfile(decoded: any): Promise<AuthContext> {
  const userId = decoded.uid;
  const userEmail = decoded.email || "unknown@domain.com";
  const extracted = extractStrictTenantAndRole(decoded);
  if (!extracted) {
    throw new Error(
      `Token for ${userEmail} is missing required claims (tenantId, role). ` +
      "Production users must be provisioned with explicit custom claims via the admin API."
    );
  }
  const { tenantId, userRole } = extracted;

  await writeToFirestore("users", userId, {
    uid: userId,
    email: userEmail,
    tenantId,
    role: userRole,
    lastSeenAt: new Date().toISOString(),
  }, "");

  try {
    const currentClaims = decoded || {};
    if (currentClaims.tenantId !== tenantId || currentClaims.role !== userRole) {
      await getAdminAuth().setCustomUserClaims(userId, {
        ...currentClaims,
        tenantId,
        role: userRole,
      });
      console.log(`Assigned custom claims to ${userId}: tenantId=${tenantId}, role=${userRole}`);
    }
  } catch (err) {
    console.warn("Unable to update custom claims:", err);
  }

  return { userId, userEmail, tenantId, userRole };
}

/**
 * Parse a development-only token of the form:
 *   dev-<uid>:<email>:<tenantId>:<role>
 * Tokens MUST start with "dev-" and are only honored when NODE_ENV !== "production".
 *
 * Used by tests and local development so engineers do not need a real Firebase
 * Auth user to exercise protected routes. Production refuses these outright.
 */
function parseDevToken(token: string): { uid: string; email: string; tenantId: string; role: string } | null {
  if (IS_PRODUCTION) return null;
  if (!token.startsWith("dev-")) return null;
  const parts = token.slice(4).split(":");
  if (parts.length < 4) return null;
  const [uid, email, tenantId, role] = parts;
  if (!uid || !email || !tenantId || !role) return null;
  return { uid, email, tenantId, role };
}

export const authMiddleware = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  const bearerToken =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

  req.firebaseToken = bearerToken;

  if (!bearerToken) {
    return res.status(401).json({
      error: "Unauthorized",
      details: "Missing Bearer token.",
    });
  }

  // Dev tokens: short-circuit before calling Firebase Auth.
  // Strictly disabled in production via parseDevToken().
  const dev = parseDevToken(bearerToken);
  if (dev) {
    req.authContext = {
      userId: dev.uid,
      userEmail: dev.email,
      userRole: dev.role,
      tenantId: dev.tenantId,
    };
    req.decodedClaims = dev;
    return next();
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(bearerToken);

    if (!decoded?.uid) {
      return res.status(401).json({
        error: "Unauthorized",
        details: "Invalid Firebase token.",
      });
    }

    const extracted = extractStrictTenantAndRole(decoded);
    if (!extracted) {
      return res.status(403).json({
        error: "Forbidden",
        details:
          "Token is missing required custom claims (tenantId, role). " +
          "Production users must be provisioned with explicit claims via the Firebase Admin API.",
      });
    }

    // ─── MFA enforcement ────────────────────────────────────────────────────
    // Lab Admin and Quality Auditor must complete a second factor in production.
    // Firebase records MFA completion in decoded.firebase.sign_in_second_factor.
    // Enable MFA in Firebase Console → Authentication → Multi-factor Authentication.
    if (IS_PRODUCTION && MFA_REQUIRED_ROLES.has(extracted.userRole)) {
      const secondFactor = (decoded as any)?.firebase?.sign_in_second_factor;
      if (!secondFactor) {
        return res.status(403).json({
          error: "Forbidden",
          details:
            `Multi-factor authentication is required for the '${extracted.userRole}' role. ` +
            "Please sign in again with your second factor (TOTP or SMS) to access this resource.",
        });
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    req.authContext = {
      userId: decoded.uid,
      userEmail: decoded.email || "unknown@domain.com",
      userRole: extracted.userRole,
      tenantId: extracted.tenantId,
    };
    req.decodedClaims = decoded;

    return next();
  } catch (err: any) {
    console.error("Token authentication failed:", err);
    return res.status(401).json({
      error: "Unauthorized",
      details: err?.message || "Token verification failed.",
    });
  }
};

// Generic rate limiter factory — supports multiple named limiters with configurable limits
const rateLimitStores = new Map<string, Map<string, { count: number; resetTime: number }>>();

export function createRateLimiter(name: string, maxRequests: number, windowMs: number = 60 * 1000) {
  if (!rateLimitStores.has(name)) {
    rateLimitStores.set(name, new Map());
  }
  const store = rateLimitStores.get(name)!;

  return {
    check(key: string): { allowed: boolean; remaining: number; resetTime: number } {
      const now = Date.now();
      let entry = store.get(key);
      if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + windowMs };
      }
      entry.count += 1;
      store.set(key, entry);
      return {
        allowed: entry.count <= maxRequests,
        remaining: Math.max(0, maxRequests - entry.count),
        resetTime: entry.resetTime,
      };
    },
    reset(key: string) {
      store.delete(key);
    },
  };
}

export const geminiRateLimiter = createRateLimiter("gemini", 10, 60 * 1000);
export const literatureRateLimiter = createRateLimiter("literature", 5, 60 * 1000);

// Backwards-compatible wrappers
export const GEMINI_LIMIT_MAX_REQUESTS = 10;

export function checkGeminiRateLimit(userId: string): { allowed: boolean; remaining: number; resetTime: number } {
  return geminiRateLimiter.check(userId);
}

export function checkLitRateLimit(uid: string): boolean {
  return literatureRateLimiter.check(uid).allowed;
}

export function isValidGeminiKey(key: string | undefined): boolean {
  if (!key) return false;
  const cleaned = key.trim();
  return cleaned.startsWith("AIzaSy") && cleaned.length > 10 && cleaned !== "MY_GEMINI_API_KEY";
}
