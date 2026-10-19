import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && key)

// Yalnızca herkese açık (publishable/anon) anahtar kullanılır. Veriler RLS ile korunur.
export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'mutu-akademi-auth',
  },
  realtime: { params: { eventsPerSecond: 20 } },
})
