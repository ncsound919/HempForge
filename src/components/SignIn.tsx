import React, { useState, useEffect } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, isDevBypass, IS_SUPABASE_AUTH } from '../lib/firebase';
import { supabaseAuth } from '../lib/supabaseBrowser';

// In development the dev-token form is always available regardless of
// whether `firebase-applet-config.json` looks populated. This matches the
// server-side posture (authMiddleware accepts dev-* tokens whenever
// NODE_ENV !== "production") and prevents the "click Google sign-in and
// everything 401s" trap when the Admin SDK is not configured.
const isDevelopment =
  typeof import.meta !== 'undefined' &&
  ((import.meta as any)?.env?.DEV === true ||
    (import.meta as any)?.env?.MODE === 'development');

export default function SignIn() {
  const [token, setToken] = useState('dev-alice:alice@hempforge.test:Global-Hemp-Wilson:Lab Admin');
  const [devError, setDevError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const showDevForm = isDevBypass || isDevelopment;

  const friendlyGoogleError = (raw: string): string => {
    if (/auth\/popup-closed-by-user/i.test(raw))
      return 'Popup closed before sign-in completed. Try again and keep the popup open.';
    if (/auth\/popup-blocked/i.test(raw))
      return 'Browser blocked the sign-in popup. Allow popups for this site and retry.';
    if (/auth\/unauthorized-domain/i.test(raw))
      return 'This site is not authorized for Google sign-in (unauthorized-domain). The deployment URL must be added in Firebase console → Authentication → Authorized domains.';
    if (/auth\/operation-not-allowed/i.test(raw))
      return 'Google sign-in is not enabled in Firebase console → Authentication → Sign-in method.';
    if (/auth\/invalid-api-key|auth\/app-not-authorized/i.test(raw))
      return 'Firebase config rejected (invalid API key). The deployed config does not match this project.';
    if (/auth\/network-request-failed/i.test(raw))
      return 'Network error reaching Google. Check your connection and retry.';
    if (/redirect.*not allowed|redirect_to|validation_failed/i.test(raw))
      return 'Login redirect rejected. The site URL must be allowlisted (Supabase Auth → URL Configuration).';
    return raw;
  };

  const signInWithGoogle = () => {
    setAuthError(null);
    if (IS_SUPABASE_AUTH) {
      supabaseAuth.signInWithGoogle().catch((err: any) => {
        const msg = err?.message || String(err);
        console.warn('Google sign-in failed:', msg);
        setAuthError(friendlyGoogleError(msg));
      });
      return;
    }
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).catch((err: any) => {
      // Firebase Auth rejects the popup when only the local mock is wired
      // up, when the domain is unauthorized, or when the provider is off.
      // Surface that visibly — a silent console.warn left users stranded.
      const msg = err?.message || String(err);
      console.warn('Google sign-in failed:', msg);
      setAuthError(friendlyGoogleError(msg));
    });
  };

  const signInWithEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      await supabaseAuth.signInWithEmailPassword(email, password);
    } catch (err: any) {
      setAuthError(err?.message || String(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      await supabaseAuth.signUp(email, password);
      setAuthError('Account created — check your inbox to confirm your email, then sign in.');
    } catch (err: any) {
      setAuthError(err?.message || String(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const signInWithDevToken = async () => {
    setDevError(null);
    try {
      await (auth as any).signInWithCustomToken(token);
      // Persist that the user explicitly chose dev-bypass so subsequent
      // SPA navigations don't lose the bypass state if the page is
      // reloaded without ?devBypass=1 in the URL.
      try {
        localStorage.setItem('hf.devBypass', '1');
      } catch {
        // localStorage may be unavailable; non-fatal.
      }
    } catch (err: any) {
      const message = err?.message || String(err);
      setDevError(message);
      console.error('Dev sign-in failed:', err);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#0A0F0D] text-white flex-col space-y-4 p-6">
      <div className="flex flex-col items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-white">HempForge</h1>
        <p className="text-xs text-slate-400 uppercase tracking-widest">
          Compliance Intelligence Workspace
        </p>
      </div>

      <button
        onClick={signInWithGoogle}
        className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] font-bold py-2 px-6 rounded"
      >
        Sign in with Google
      </button>

      {authError && !IS_SUPABASE_AUTH && (
        <div className="text-[11px] text-red-300 max-w-md text-center">{authError}</div>
      )}

      {IS_SUPABASE_AUTH && (
        <form
          onSubmit={signInWithEmail}
          className="flex flex-col space-y-2 items-center border border-emerald-700/40 p-4 rounded bg-black/40 max-w-xl"
        >
          <span className="text-xs uppercase tracking-wider text-emerald-400">
            Email & Password (Supabase)
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@lab.com"
            required
            className="bg-black/40 text-emerald-200 border border-emerald-700/30 px-2 py-1 rounded text-xs w-[28rem] font-mono"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            required
            className="bg-black/40 text-emerald-200 border border-emerald-700/30 px-2 py-1 rounded text-xs w-[28rem] font-mono"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={authBusy}
              className="bg-emerald-700 hover:bg-emerald-600 text-white font-medium py-1 px-3 rounded text-sm disabled:opacity-50"
            >
              {authBusy ? 'Signing in…' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={signUp}
              disabled={authBusy}
              className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-1 px-3 rounded text-sm disabled:opacity-50"
            >
              Create Account
            </button>
          </div>
          {authError && (
            <div className="text-[11px] text-red-300 max-w-md text-center">{authError}</div>
          )}
        </form>
      )}

      {showDevForm && (
        <div className="flex flex-col space-y-2 items-center border border-emerald-700/40 p-4 rounded bg-black/40 max-w-xl">
          <span className="text-xs uppercase tracking-wider text-emerald-400">
            Dev Bypass (token-only auth — no Firebase required)
          </span>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            spellCheck={false}
            className="bg-black/40 text-emerald-200 border border-emerald-700/30 px-2 py-1 rounded text-xs w-[28rem] font-mono"
          />
          <button
            onClick={signInWithDevToken}
            className="bg-emerald-700 hover:bg-emerald-600 text-white font-medium py-1 px-3 rounded text-sm"
          >
            Sign in with dev token
          </button>
          {devError && (
            <div className="text-[11px] text-red-300 max-w-md text-center">
              {devError}
            </div>
          )}
          <div className="text-[10px] text-slate-500 max-w-md text-center leading-relaxed pt-1">
            Format: <span className="font-mono text-emerald-300">dev-uid:email:tenantId:role</span>.
            Token-only auth is honored by the server whenever
            <span className="font-mono"> NODE_ENV !== "production" </span>.
          </div>
        </div>
      )}
    </div>
  );
}
