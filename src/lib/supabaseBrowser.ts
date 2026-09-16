/**
 * supabaseBrowser.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Browser-side Supabase auth. Provides a Firebase-shaped adapter so the rest
 * of the app (contexts.tsx, authFetch, SignIn) keeps working unchanged:
 *
 *   auth.currentUser        → { uid, email, getIdToken(): Supabase JWT, ... }
 *   auth.onAuthStateChanged → fires on sign-in/out
 *   auth.signInWithEmailPassword(email, password)
 *   auth.signOut()
 *
 * Enabled when VITE_AUTH_MODE=supabase AND the Supabase URL + anon key are
 * present in the client env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Shared ecosystem identity (Overlay365 IdP, auth-only). When its browser-safe
// anon key is present the auth client targets the shared project; otherwise it
// falls back to the legacy app project (VITE_SUPABASE_URL/ANON_KEY), so
// behavior is unchanged until the ecosystem vars are provisioned.
const ecosystemUrl =
  (import.meta.env?.VITE_ECOSYSTEM_SUPABASE_URL as string) ||
  'https://hjjgsbejhkwiyghncobe.supabase.co';
const ecosystemAnonKey = (import.meta.env?.VITE_ECOSYSTEM_SUPABASE_ANON_KEY as string) || '';

export const IS_ECOSYSTEM_AUTH = ecosystemAnonKey.length > 40;

const url = IS_ECOSYSTEM_AUTH
  ? ecosystemUrl
  : (import.meta.env?.VITE_SUPABASE_URL as string) || '';
const anonKey = IS_ECOSYSTEM_AUTH
  ? ecosystemAnonKey
  : (import.meta.env?.VITE_SUPABASE_ANON_KEY as string) || '';
const authMode = (import.meta.env?.VITE_AUTH_MODE as string) || '';

export const IS_SUPABASE_AUTH =
  (IS_ECOSYSTEM_AUTH || authMode === 'supabase') &&
  url.includes('.supabase.co') &&
  anonKey.length > 40;

export const SUPABASE_AUTH_PROJECT = url;

type Listener = (user: SupabaseMockUser | null) => void;

export interface SupabaseMockUser {
  uid: string;
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  isAnonymous: boolean;
  phoneNumber: null;
  photoURL: null;
  providerId: string;
  metadata: { creationTime?: string; lastSignInTime?: string };
  providerData: unknown[];
  refreshToken: string;
  accessToken: string;
  tenantId: string;
  role: string;
  appMetadata: Record<string, unknown>;
  delete: () => Promise<void>;
  getIdToken: () => Promise<string>;
  getIdTokenResult: () => Promise<unknown>;
  toJSON: () => Record<string, unknown>;
}

class SupabaseAuthAdapter {
  private sb: SupabaseClient | null = null;
  private user: SupabaseMockUser | null = null;
  private listeners = new Set<Listener>();
  // Set once the initial persisted-session check has resolved, so subscribers
  // that attach afterwards still get the current (possibly null) state.
  private initialized = false;

  constructor() {
    if (!IS_SUPABASE_AUTH) return;
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    // Restore a persisted session on boot.
    this.sb.auth.getSession().then(({ data }) => {
      const session = data.session;
      this.initialized = true;
      if (session?.user) {
        this.setUser(session);
      } else {
        this.emit(null);
      }
    });
    // Listen for auth changes from the Supabase client.
    this.sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        this.setUser(session);
      } else {
        this.user = null;
        this.emit(null);
      }
    });
  }

  private setUser(session: any) {
    const user = session.user;
    const meta = (user.user_metadata || {}) as Record<string, any>;
    const appMeta = (user.app_metadata || {}) as Record<string, any>;
    const mock: SupabaseMockUser = {
      uid: user.id,
      id: user.id,
      email: user.email,
      displayName: meta.full_name || user.email,
      emailVerified: !!user.email_confirmed_at,
      isAnonymous: false,
      phoneNumber: null,
      photoURL: meta.avatar_url || null,
      providerId: 'supabase',
      metadata: { creationTime: user.created_at, lastSignInTime: user.last_sign_in_at },
      providerData: [],
      refreshToken: session.refresh_token,
      accessToken: session.access_token,
      tenantId: (appMeta.tenant_id as string) || meta.tenant_id || 'Global-Hemp-Wilson',
      role: (appMeta.role as string) || meta.role || 'Lab Admin',
      appMetadata: appMeta,
      delete: async () => {
        await this.sb?.auth.signOut();
        this.user = null;
        this.emit(null);
      },
      getIdToken: async () => session.access_token,
      getIdTokenResult: async () => ({ token: session.access_token }),
      toJSON: () => ({
        uid: user.id,
        email: user.email,
        tenantId: mock.tenantId,
        role: mock.role,
      }),
    };
    this.user = mock;
    this.emit(mock);
  }

  get currentUser() {
    return this.user;
  }

  onAuthStateChanged(cb: Listener) {
    this.listeners.add(cb);
    // Always report the CURRENT state once the initial session check has run,
    // including null (signed out). Reporting only truthy users left consumers
    // (UserProvider) stuck on "Initializing Workspace..." forever.
    if (this.initialized) cb(this.user);
    return () => this.listeners.delete(cb);
  }

  async signInWithEmailPassword(email: string, password: string) {
    if (!this.sb) throw new Error('Supabase auth is not configured');
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.session) this.setUser(data.session);
    return { user: this.user };
  }

  async signUp(email: string, password: string) {
    if (!this.sb) throw new Error('Supabase auth is not configured');
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) throw error;
    if (data.session) this.setUser(data.session);
    return { user: this.user };
  }

  async signInWithGoogle() {
    if (!this.sb) throw new Error('Supabase auth is not configured');
    const { error } = await this.sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }

  async signOut() {
    this.user = null;
    this.emit(null);
    await this.sb?.auth.signOut();
  }

  private emit(user: SupabaseMockUser | null) {
    this.listeners.forEach((cb) => cb(user));
  }
}

export const supabaseAuth = new SupabaseAuthAdapter();
