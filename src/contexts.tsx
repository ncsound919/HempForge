import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, syncUserProfile, authFetch } from './lib/firebase';
import { COARecord } from './types';


// ─────────────────────────────────────────────────────────────────────────────
// User Context
// ─────────────────────────────────────────────────────────────────────────────

interface UserContextType {
  user: User | null;
  loading: boolean;
  userSyncError: string | null;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userSyncError, setUserSyncError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!active) return;

      setLoading(true);
      setUserSyncError(null);

      try {
        if (currentUser) {
          await syncUserProfile(currentUser);
        }

        if (!active) return;
        setUser(currentUser);
      } catch (e: any) {
        if (!active) return;
        console.error('Profile sync failed:', e);
        setUser(currentUser);
        setUserSyncError(e?.message || 'Failed to synchronize user profile.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ user, loading, userSyncError }),
    [user, loading, userSyncError]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}


// ─────────────────────────────────────────────────────────────────────────────
// COA Context
// ─────────────────────────────────────────────────────────────────────────────

interface COAContextType {
  coas: COARecord[];
  coasLoading: boolean;
  coasError: string | null;
  refreshCoas: (options?: { silent?: boolean }) => Promise<void>;
  addCoasOptimistic: (newCoas: COARecord[]) => void;
}

const COAContext = createContext<COAContextType | undefined>(undefined);

export function useCOAs() {
  const context = useContext(COAContext);
  if (!context) {
    throw new Error('useCOAs must be used within a COAProvider');
  }
  return context;
}

function dedupeCoasById(items: COARecord[]) {
  const seen = new Set<string>();
  const result: COARecord[] = [];

  for (const item of items) {
    if (!item?.id) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

export function COAProvider({ children }: { children: ReactNode }) {
  const { user, loading: userLoading } = useUser();
  const [coas, setCoas] = useState<COARecord[]>([]);
  const [coasLoading, setCoasLoading] = useState(false);
  const [coasError, setCoasError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchCoas = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      const requestId = ++requestIdRef.current;

      if (userLoading) return;

      if (!user) {
        setCoas([]);
        setCoasError(null);
        setCoasLoading(false);
        return;
      }

      if (!silent) {
        setCoasLoading(true);
      }
      setCoasError(null);

      try {
        const res = await authFetch('/api/coas');

        if (!res.ok) {
          let message = `Failed to fetch COAs: ${res.status} ${res.statusText}`;

          try {
            const errBody = await res.json();
            message =
              errBody?.details ||
              errBody?.error ||
              message;
          } catch {
            // ignore JSON parse failure
          }

          throw new Error(message);
        }

        const data = await res.json();

        if (requestIdRef.current !== requestId) return;

        setCoas(Array.isArray(data) ? dedupeCoasById(data) : []);
      } catch (e: any) {
        if (requestIdRef.current !== requestId) return;
        console.error('Error loading COAs:', e);
        setCoasError(e?.message || 'Network error loading COAs');
      } finally {
        if (requestIdRef.current === requestId && !silent) {
          setCoasLoading(false);
        }
      }
    },
    [user, userLoading]
  );

  useEffect(() => {
    void fetchCoas();
  }, [fetchCoas]);

  const addCoasOptimistic = useCallback(
    (newCoas: COARecord[]) => {
      setCoas((prev) => dedupeCoasById([...newCoas, ...prev]));
      void fetchCoas({ silent: true });
    },
    [fetchCoas]
  );

  const value = useMemo(
    () => ({
      coas,
      coasLoading,
      coasError,
      refreshCoas: fetchCoas,
      addCoasOptimistic,
    }),
    [coas, coasLoading, coasError, fetchCoas, addCoasOptimistic]
  );

  return <COAContext.Provider value={value}>{children}</COAContext.Provider>;
}
