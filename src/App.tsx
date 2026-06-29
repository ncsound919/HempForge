import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { Loader2, ShieldCheck } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import COAIntake from './components/COAIntake';
import AgentChat from './components/AgentChat';
import Settings from './components/Settings';
import Vault from './components/Vault';
import ResearchLab from './components/ResearchLab';
import LabWorkspace from './components/LabWorkspace';
import PublicCOAVerifierPage from './components/PublicCOAVerifierPage';
import SignIn from './components/SignIn';
import NotFound from './components/NotFound';
import WorkflowDashboard from './components/WorkflowDashboard';
import { UserProvider, COAProvider, useUser, useCOAs } from './contexts';


// ─── Public layout ───────────────────────────────────────────────────────────
// Rendered without auth, sidebar, or any provider-dependent state.
function PublicShell() {
  return (
    <Routes>
      <Route path="/verify/:coaId" element={<PublicCOAVerifierPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}


// ─── Auth gate ────────────────────────────────────────────────────────────────
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useUser();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0A0F0D] text-white flex-col space-y-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="flex flex-col items-center"
        >
          <ShieldCheck className="w-16 h-16 text-emerald-400 mb-4" />
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
          <h2 className="mt-4 text-xl font-medium tracking-tight text-slate-200">
            Initializing Workspace...
          </h2>
        </motion.div>
      </div>
    );
  }

  if (!user) return <SignIn />;

  return <>{children}</>;
}


// ─── Authenticated app shell ──────────────────────────────────────────────────
function AppShell() {
  const { userSyncError } = useUser();
  const { coas, coasLoading, coasError } = useCOAs();

  return (
    <div className="flex bg-[#0A0F0D] text-slate-200 min-h-screen font-sans border-8 border-[#1A221E]">
      <Sidebar />

      <main className="flex-1 flex flex-col p-8 overflow-y-auto h-screen bg-white/5 relative">
        <div className="max-w-6xl mx-auto w-full flex-1 relative">

          {/* Sync / load error banners */}
          {userSyncError && (
            <div className="mb-4 p-4 bg-orange-900/50 border border-orange-500/50 rounded-lg text-orange-200">
              Warning: {userSyncError}
            </div>
          )}

          {coasError && (
            <div className="mb-4 p-4 bg-red-900/50 border border-red-500/50 rounded-lg text-red-200 flex justify-between items-center">
              <span>Error loading COAs: {coasError}</span>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-1.5 bg-red-800 hover:bg-red-700 rounded text-sm font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Scoped COA loading overlay — only covers main content area */}
          {coasLoading && coas.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-50 pointer-events-none">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
          )}

          <Routes>
            <Route path="/"               element={<Dashboard coas={coas} />} />
            <Route path="/intake"         element={<COAIntake />} />
            <Route path="/agent"          element={<AgentChat />} />
            <Route path="/agent-workspace" element={<LabWorkspace />} />
            <Route path="/vault"          element={<Vault />} />
            <Route path="/lab"            element={<ResearchLab />} />
            <Route path="/settings"       element={<Settings />} />
            <Route path="/workflows"       element={<WorkflowDashboard />} />
            {/* Authenticated users CAN view a public COA page — no sidebar ambiguity */}
            <Route path="/verify/:coaId"  element={<PublicCOAVerifierPage />} />
            <Route path="*"               element={<NotFound />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}


// ─── Route-aware top-level splitter ──────────────────────────────────────────
// Uses React Router's useLocation so the public/private split is based on
// actual router state, not window.location, which breaks on SPA navigation.
function AppContent() {
  const location = useLocation();
  const isPublicVerifyRoute = location.pathname.startsWith('/verify/');

  if (isPublicVerifyRoute) {
    return <PublicShell />;
  }

  return (
    <UserProvider>
      <COAProvider>
        <AuthGate>
          <AppShell />
        </AuthGate>
      </COAProvider>
    </UserProvider>
  );
}


// ─── Root ─────────────────────────────────────────────────────────────────────
// UserProvider / COAProvider are NOT here — they only mount for authenticated
// routes. The public verify route needs no Firebase state at all.
export default function App() {
  return <AppContent />;
}

