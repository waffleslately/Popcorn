import { create } from 'zustand';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Session, User } from '@supabase/supabase-js';

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;

  /** Initialise listener (call once at app start) */
  initAuth: () => void;
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<Profile, 'display_name' | 'bio' | 'is_private' | 'username'>>) => Promise<{ error: string | null }>;
  deleteAccount: () => Promise<{ error: string | null }>;
  /** Preferred display name: display_name → username → null */
  displayName: () => string | null;
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio, is_private')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data as Profile;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  loading: true,
  error: null,

  displayName: () => {
    const { profile } = get();
    if (!profile) return null;
    return profile.display_name || profile.username;
  },

  initAuth: () => {
    if (!isSupabaseConfigured) {
      set({ loading: false });
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const profile = session ? await fetchProfile(session.user.id) : null;
      set({ session, user: session?.user ?? null, profile, loading: false });
    });

    // Listen for auth state changes
    supabase.auth.onAuthStateChange(async (_event, session) => {
      const profile = session ? await fetchProfile(session.user.id) : null;
      set({ session, user: session?.user ?? null, profile, loading: false });
    });
  },

  signInWithMagicLink: async (email: string) => {
    if (!isSupabaseConfigured) {
      const msg = 'Supabase credentials are not configured yet on this deployment.';
      set({ error: msg });
      return { error: msg };
    }
    set({ error: null });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      set({ error: error.message });
      return { error: error.message };
    }
    return { error: null };
  },

  signInWithGoogle: async () => {
    if (!isSupabaseConfigured) {
      const msg = 'Supabase credentials are not configured yet on this deployment.';
      set({ error: msg });
      return { error: msg };
    }
    set({ error: null });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      set({ error: error.message });
      return { error: error.message };
    }
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null });
  },

  updateProfile: async (patch) => {
    const { user } = get();
    if (!user) return { error: 'Not signed in' };
    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', user.id);
    if (error) return { error: error.message };
    const profile = await fetchProfile(user.id);
    set({ profile });
    return { error: null };
  },

  deleteAccount: async () => {
    const { session } = get();
    if (!session) return { error: 'Not signed in' };
    // Call a server-side edge function or admin route to delete all user data
    // and then sign out locally.
    const res = await fetch('/api/auth/delete-account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.error || 'Failed to delete account' };
    }
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null });
    return { error: null };
  },
}));
