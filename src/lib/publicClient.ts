import { createClient } from '@supabase/supabase-js'

// Girişsiz ortak program için ayrı istemci: oturum kullanmaz, oturum yenilemesini beklemez.
// Yalnızca herkese açık (publishable) anahtarla salt okunur get_public_schedule() çağrılır.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const publicClient = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'mutu-public' },
  realtime: { params: { eventsPerSecond: 5 } },
})

export interface PublicLesson {
  id: string
  starts_at: string
  ends_at: string
  status: 'planlandi' | 'tamamlandi' | 'ertelendi' | 'iptal'
  started: boolean
  student_label: string | null
  course_name: string | null
  course_color: string | null
  instructor_label: string | null
  instructor_color: string | null
}
