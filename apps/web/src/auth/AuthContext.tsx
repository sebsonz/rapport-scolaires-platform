import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export type AccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type SchoolRole = 'CENTRAL_ADMIN' | 'CATEGORY_1' | 'CATEGORY_2';

export interface UserProfile {
  user_id: string;
  full_name: string;
  email: string;
}

export interface AccessRequest {
  id: string;
  user_id: string;
  status: AccessStatus;
  requested_at: string;
  review_note: string | null;
}

export interface Membership {
  id: string;
  user_id: string;
  department_id: string | null;
  role: SchoolRole;
}

interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  accessRequest: AccessRequest | null;
  memberships: Membership[];
  loading: boolean;
  accessError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccess: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accessRequest, setAccessRequest] = useState<AccessRequest | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  const loadAccess = useCallback(async (currentSession: Session | null) => {
    setSession(currentSession);
    setAccessError(null);
    if (!currentSession || !supabase) {
      setProfile(null);
      setAccessRequest(null);
      setMemberships([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const userId = currentSession.user.id;
    const [profileResult, requestResult, membershipResult] = await Promise.all([
      supabase.from('user_profiles').select('user_id,full_name,email').eq('user_id', userId).maybeSingle(),
      supabase.from('access_requests').select('id,user_id,status,requested_at,review_note').eq('user_id', userId).maybeSingle(),
      supabase.from('school_memberships').select('id,user_id,department_id,role').eq('user_id', userId),
    ]);

    if (profileResult.error || requestResult.error || membershipResult.error) {
      setAccessError(
        profileResult.error?.message ??
        requestResult.error?.message ??
        membershipResult.error?.message ??
        'Impossible de charger les autorisations du compte.',
      );
    }

    setProfile(profileResult.data as UserProfile | null);
    setAccessRequest(requestResult.data as AccessRequest | null);
    setMemberships((membershipResult.data ?? []) as Membership[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAccessError('Supabase n’est pas configuré. Vérifie les variables VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) void loadAccess(nextSession);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAccessError(error.message);
      void loadAccess(data.session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadAccess]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase n’est pas configuré.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    if (!supabase) throw new Error('Supabase n’est pas configuré.');
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const refreshAccess = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    await loadAccess(data.session);
  }, [loadAccess]);

  const value = useMemo(() => ({
    session, profile, accessRequest, memberships, loading, accessError,
    signIn, signUp, signOut, refreshAccess,
  }), [session, profile, accessRequest, memberships, loading, accessError, signIn, signUp, signOut, refreshAccess]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé dans AuthProvider.');
  return value;
}
