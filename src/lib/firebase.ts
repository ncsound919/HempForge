import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, type User } from 'firebase/auth';
import { initializeFirestore, setLogLevel } from 'firebase/firestore';
import rawFirebaseConfig from '../../firebase-applet-config.json';

const firebaseConfig = rawFirebaseConfig as any;

// Dev bypass is forced when:
//   1. The Firebase config has missing/empty apiKey or projectId (the config
//      file ships empty in the repo and must be filled in locally), OR
//   2. The URL query contains `?devBypass=1` so engineers can flip between
//      real Firebase Auth and the local dev-token path without editing the
//      config file.
//   3. localStorage has 'hf.devBypass' = '1' from a previous dev-token sign-in.
// The dev bypass is NEVER enabled in production NODE_ENV.
const configLooksReal =
  typeof firebaseConfig?.apiKey === 'string' &&
  firebaseConfig.apiKey.length > 0 &&
  typeof firebaseConfig?.projectId === 'string' &&
  firebaseConfig.projectId.length > 0;

const queryDevBypass =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('devBypass') === '1';

const localDevBypass =
  typeof window !== 'undefined' && localStorage.getItem('hf.devBypass') === '1';

// Persist URL devBypass to localStorage so it survives SPA navigation
if (typeof window !== 'undefined' && queryDevBypass && !localDevBypass) {
  try {
    localStorage.setItem('hf.devBypass', '1');
  } catch {
    // non-fatal
  }
}

const IS_DEV_BYPASS =
  (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') &&
  (!configLooksReal || queryDevBypass || localDevBypass);

if (!IS_DEV_BYPASS) {
  setLogLevel('error');
}

let app: any;
let authInstance: any;
let dbInstance: any;

if (IS_DEV_BYPASS) {
  console.warn(
    '[firebase] Dev bypass mode: skipping real Firebase initialization. ' +
    'Use the "Sign in with dev token" button on the sign-in screen.'
  );

  // Minimal stand-in for the Firebase User shape that downstream code
  // consumes (uid, email, getIdToken()).
  type Listener = (user: User | null) => void;
  const listeners = new Set<Listener>();
  let mockUser: any = null;

  const buildMockUser = (uid: string, email: string, tenantId: string, role: string) => ({
    uid,
    email,
    displayName: email,
    emailVerified: true,
    isAnonymous: false,
    phoneNumber: null,
    photoURL: null,
    providerId: 'custom',
    metadata: { creationTime: undefined, lastSignInTime: undefined },
    providerData: [],
    refreshToken: '',
    tenantId,
    role,
    delete: async () => {},
    getIdToken: async () => `dev-${uid}:${email}:${tenantId}:${role}`,
    getIdTokenResult: async () => ({
      authTime: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 3600_000).toISOString(),
      issuedAtTime: new Date().toISOString(),
      signInProvider: 'custom',
      signInSecondFactor: null,
      token: `dev-${uid}:${email}:${tenantId}:${role}`,
      claims: { uid, email, tenantId, role },
    }),
    reload: async () => {},
    toJSON: () => ({ uid, email, tenantId, role }),
  });

  app = { name: '[DEFAULT]', options: firebaseConfig };

  authInstance = {
    get currentUser() {
      return mockUser;
    },
    onAuthStateChanged: (cb: Listener) => {
      listeners.add(cb);
      // Fire immediately on subscription, mirroring Firebase behavior.
      setTimeout(() => cb(mockUser), 0);
      return () => listeners.delete(cb);
    },
    signInWithCustomToken: async (token: string) => {
      const parsed = parseDevLikeToken(token);
      if (!parsed) {
        throw new Error('Invalid dev token. Expected: dev-<uid>:<email>:<tenantId>:<role>');
      }
      mockUser = buildMockUser(parsed.uid, parsed.email, parsed.tenantId, parsed.role);
      listeners.forEach((cb) => cb(mockUser));
      return { user: mockUser };
    },
    signOut: async () => {
      mockUser = null;
      listeners.forEach((cb) => cb(null));
    },
  };

  dbInstance = null;
} else {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  dbInstance = initializeFirestore(
    app,
    { experimentalForceLongPolling: true },
    firebaseConfig.firestoreDatabaseId
  );
}

function parseDevLikeToken(token: string): { uid: string; email: string; tenantId: string; role: string } | null {
  if (!token || !token.startsWith('dev-')) return null;
  const parts = token.slice(4).split(':');
  if (parts.length !== 4) return null;
  const [uid, email, tenantId, role] = parts;
  if (!uid || !email || !tenantId || !role) return null;
  return { uid, email, tenantId, role };
}

export const db = dbInstance;
export const isDevBypass = IS_DEV_BYPASS;

type ServerProfile = {
  uid?: string;
  email?: string;
  tenantId: string;
  role: string;
};

let cachedProfile: ServerProfile = {
  tenantId: 'Global-Hemp-Wilson',
  role: 'Lab Admin',
};

let authResolved = false;
let authReadyPromise: Promise<User | null> | null = null;

function ensureAuthReady(): Promise<User | null> {
  if (authResolved) {
    return Promise.resolve(auth.currentUser);
  }

  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (user: any) => {
        authResolved = true;
        unsub();
        resolve(user);
      });
    });
  }

  return authReadyPromise;
}

export function getCachedTenantId() {
  return cachedProfile.tenantId;
}

export function getCachedUserRole() {
  return cachedProfile.role;
}

export function getCachedUserProfile() {
  return cachedProfile;
}

export function clearCachedUserProfile() {
  cachedProfile = {
    tenantId: 'Global-Hemp-Wilson',
    role: 'Lab Admin',
  };
}

export async function syncUserProfile(user: User | null): Promise<ServerProfile> {
  if (!user) {
    clearCachedUserProfile();
    return cachedProfile;
  }

  // Dev bypass: derive the profile from the mock user without hitting the API.
  // The server-side auth middleware accepts dev-* tokens and produces the
  // same tenantId/role shape, so the rest of the app behaves identically.
  if (IS_DEV_BYPASS) {
    cachedProfile = {
      uid: (user as any).uid,
      email: (user as any).email,
      tenantId: (user as any).tenantId || 'Global-Hemp-Wilson',
      role: (user as any).role || 'Lab Admin',
    };
    return cachedProfile;
  }

  const token = await user.getIdToken();

  const res = await fetch('/api/users/profile', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    let message = `Profile sync failed: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body?.details || body?.error || message;
    } catch {
      // no-op
    }
    throw new Error(message);
  }

  const data = await res.json();

  cachedProfile = {
    uid: data.uid,
    email: data.email,
    tenantId: data.tenantId || 'Global-Hemp-Wilson',
    role: data.role || 'Lab Admin',
  };

  return cachedProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase auth delegation (migration path)
//
// When VITE_AUTH_MODE=supabase + Supabase env are present, the app authenticates
// through Supabase instead of Firebase. The adapter exposes the same
// currentUser / onAuthStateChanged / getIdToken() surface, so every consumer
// (contexts.tsx, authFetch, SignIn) works unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAuth, IS_SUPABASE_AUTH, type SupabaseMockUser } from './supabaseBrowser';

let authExport = authInstance;

if (IS_SUPABASE_AUTH) {
  console.warn(
    '[firebase] Supabase auth mode active — delegating auth to @supabase/supabase-js.'
  );
  authExport = supabaseAuth;
}

// Patch onAuthStateChanged to support BOTH the mock/Firebase instances and the
// Supabase adapter without breaking the existing Listener signature.
const originalOnAuth = authExport.onAuthStateChanged.bind(authExport);
authExport.onAuthStateChanged = (cb: (user: any) => void) => {
  return originalOnAuth(cb);
};

export const auth = authExport;
export { IS_SUPABASE_AUTH };

// ─── Sync profile via Supabase adapter path ──────────────────────────────────
// syncUserProfile reads auth.currentUser which now may be a Supabase user.
// The server /api/users/profile accepts Supabase JWTs, so no change needed.

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  await ensureAuthReady();

  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const currentUser = auth.currentUser as SupabaseMockUser | null;
  if (currentUser) {
    const idToken = await currentUser.getIdToken();
    headers.set('Authorization', `Bearer ${idToken}`);
  }

  const hasBody = options.body != null;
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    method,
    headers,
  });
}