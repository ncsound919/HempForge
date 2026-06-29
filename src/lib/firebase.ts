import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, type User } from 'firebase/auth';
import { initializeFirestore, setLogLevel } from 'firebase/firestore';
import rawFirebaseConfig from '../../firebase-applet-config.json';

const firebaseConfig = rawFirebaseConfig as any;

setLogLevel('error');

const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(
  app,
  {
    experimentalForceLongPolling: true,
  },
  firebaseConfig.firestoreDatabaseId
);

export const auth = getAuth(app);

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
      const unsub = onAuthStateChanged(auth, (user) => {
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

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  await ensureAuthReady();

  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const currentUser = auth.currentUser;
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
