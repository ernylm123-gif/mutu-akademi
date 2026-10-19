import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/db'

interface AuthState {
  session: Session | null
  profile: Profile | null
  instructorId: string | null
  loading: boolean
  profileError: string | null
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
  can: {
    admin: boolean
    staff: boolean
    instructor: boolean
    students: boolean
    lessons: boolean
    payments: boolean
  }
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [instructorId, setInstructorId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null)
      setInstructorId(null)
      return
    }
    const [{ data, error }, inst] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('instructors').select('id').eq('profile_id', uid).maybeSingle(),
    ])
    if (error) {
      setProfileError(error.message)
    } else {
      setProfileError(null)
      setProfile(data as Profile | null)
      setInstructorId((inst.data as { id: string } | null)?.id ?? null)
    }
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session?.user.id)
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Supabase önerisi: callback içinde doğrudan await yapma
        setTimeout(() => void loadProfile(s?.user.id), 0)
      }
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  // Kendi profilim değişirse (ör. yönetici yetkimi değiştirdi) anında güncelle
  useEffect(() => {
    const uid = session?.user.id
    if (!uid) return
    const ch = supabase
      .channel(`profile-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, () => {
        void loadProfile(uid)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [session?.user.id, loadProfile])

  const signOut = useCallback(async () => {
    // Bu cihazın push aboneliğini kaldır (bağlantısı kesilen cihaza bildirim gitmesin)
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
      const sub = await reg?.pushManager?.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
    } catch { /* yoksay */ }
    await supabase.auth.signOut()
    setProfile(null)
    setInstructorId(null)
  }, [])

  const value = useMemo<AuthState>(() => {
    const ok = !!profile && profile.is_active && profile.approved
    const role = ok ? profile!.role : null
    const perms = profile?.permissions ?? {}
    const admin = role === 'admin'
    return {
      session,
      profile,
      instructorId,
      loading,
      profileError,
      refreshProfile: () => loadProfile(session?.user.id),
      signOut,
      can: {
        admin,
        staff: role === 'admin' || role === 'personel',
        instructor: role === 'egitmen',
        students: admin || (role === 'personel' && !!perms.students),
        lessons: admin || (role === 'personel' && !!perms.lessons),
        payments: admin || (role === 'personel' && !!perms.payments),
      },
    }
  }, [session, profile, instructorId, loading, profileError, loadProfile, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
