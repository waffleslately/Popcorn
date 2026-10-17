import { createClient } from '@supabase/supabase-js';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const isSupabaseConfigured = Boolean(
  rawUrl &&
  rawKey &&
  rawUrl !== 'https://placeholder.supabase.co' &&
  !rawUrl.includes('your-project')
);

if (!isSupabaseConfigured) {
  console.info(
    '[Popcorn] Supabase credentials not configured. Guest mode is fully operational.'
  );
}

// Fallback to a valid format dummy URL so createClient does not throw on import
export const supabase = createClient(
  isSupabaseConfigured ? rawUrl! : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? rawKey! : 'placeholder-anon-key',
  {
    auth: {
      persistSession: isSupabaseConfigured,
      autoRefreshToken: isSupabaseConfigured,
    },
  }
);
