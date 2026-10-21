import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/db'

/** Açılış kontrolleri için üst süre: hiçbir adım sonsuza kadar beklemez */
const STEP_TIMEOUT = 12_000

export type BootError = { kind: 'network' | 'server'; message: string } | null

interface AuthState {
  session: Session | null
  profile: Profile | null
  instructorId: string | null
  /** Oturum ve (varsa) profil kontrolü tamamlanana kadar true */
  loading: boolean
  /** Profil sunucudan alınamadıysa (ağ/sunucu hatası) dolu */
  bootError: BootError
  /** @deprecated bootError kullanın */
  profileError: string | null
  refreshProfile: () => Promise<void>
  retry: () => Promise<void>
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

function withTimeout<T>(p: PromiseLike<T>, ms = STEP_TIMEOUT, label = 'İstek'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} zaman aşımına uğradı`)), ms)
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

function isAuthError(e: { code?: string; message?: string; status?: number } | null | undefined) {
  if (!e) return false
  return e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt|token|refresh/i.test(e.message ?? '')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [instructorId, setInstructorId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState<BootError>(null)
  const loadSeq = useRef(0)

  /**
   * Profili GÜNCEL oturuma göre yükler (kapanıştaki eski oturum değil).
   * Her zaman sonlanır: başarı, yetkisiz (profil yok) veya hata.
   */
  const loadProfile = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const { data: s } = await withTimeout(supabase.auth.getSession(), STEP_TIMEOUT, 'Oturum kontrolü')
      const uid = s.session?.user.id
      if (seq !== loadSeq.current) return
      setSession(s.session)
      if (!uid) {
        setProfile(null)
        setInstructorId(null)
        setBootError(null)
        return
      }
      const run = () =>
        Promise.all([
          supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
          supabase.from('instructors').select('id').eq('profile_id', uid).maybeSingle(),
        ])
      let [{ data, error }, inst] = await withTimeout(run(), STEP_TIMEOUT, 'Profil yükleme')
      if (error && isAuthError(error)) {
        // Erişim belirteci süresi dolmuş olabilir: bir kez yenile ve tekrar dene
        const { error: rErr } = await withTimeout(supabase.auth.refreshSession(), STEP_TIMEOUT, 'Oturum yenileme')
        if (rErr) {
          // Yenileme anahtarı geçersiz: bu cihazın oturumu artık yok (yetkisiz duruma düş)
          await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
          if (seq !== loadSeq.current) return
          setSession(null)
          setProfile(null)
          setInstructorId(null)
          setBootError(null)
          return
        }
        ;[{ data, error }, inst] = await withTimeout(run(), STEP_TIMEOUT, 'Profil yükleme')
      }
      if (seq !== loadSeq.current) return
      if (error) throw error
      setProfile((data as Profile | null) ?? null)
      setInstructorId((inst.data as { id: string } | null)?.id ?? null)
      setBootError(null)
    } catch (e) {
      if (seq !== loadSeq.current) return
      const msg = (e as Error)?.message ?? String(e)
      const network = !navigator.onLine || /fetch|network|zaman aşımı|timeout|load failed/i.test(msg)
      setBootError({ kind: network ? 'network' : 'server', message: msg })
    }
  }, [])

  useEffect(() => {
    let active = true
    void loadProfile().finally(() => active && setLoading(false))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Supabase önerisi: callback içinde doğrudan await yapma
        setTimeout(() => void loadProfile(), 0)
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
        void loadProfile()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [session?.user.id, loadProfile])

  const retry = useCallback(async () => {
    setBootError(null)
    setLoading(true)
    await loadProfile()
    setLoading(false)
  }, [loadProfile])

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
      bootError,
      profileError: bootError?.message ?? null,
      refreshProfile: loadProfile,
      retry,
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
  }, [session, profile, instructorId, loading, bootError, loadProfile, retry, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
