import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, CalendarDays, Radio, WifiOff, RefreshCw, Lock, BellRing, Activity, Megaphone, Send } from 'lucide-react'
import { publicClient, type PublicLesson } from '@/lib/publicClient'
import { addDays, dateKey, formatDayLong, fromIstanbul, relativeTime, startOfWeek, timeHM, WEEKDAYS } from '@/lib/time'
import { Button, Card, EmptyState, PageLoader, Segmented } from '@/components/ui'
import { Countdown } from '@/components/Countdown'
import { NotificationPrompt } from '@/components/NotificationPrompt'
import { usePush } from '@/hooks/usePush'
import { useToast } from '@/components/ui/Toast'
import { errorMessage } from '@/lib/errors'

type View = 'gun' | 'hafta'
type Live = 'connecting' | 'live' | 'offline'

const STATUS: Record<PublicLesson['status'], { label: string; cls: string }> = {
  planlandi: { label: 'Planlandı', cls: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' },
  tamamlandi: { label: 'Tamamlandı', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  iptal: { label: 'İptal', cls: 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400' },
  ertelendi: { label: 'Ertelendi', cls: 'bg-amber-50 text-amber-700' },
}

/**
 * Girişsiz ORTAK DERS PROGRAMI (salt okunur).
 * Oturum beklemeden açılır; yalnızca ders saati, kurs ve kısaltılmış isim gösterilir.
 * Değişiklikler Supabase Realtime yayınıyla anında gelir; yeniden bağlanınca sunucudan tekrar alınır.
 */
type PublicActivity = { id: number; created_at: string; kind: string; course_name: string | null; starts_at: string | null; old_starts_at: string | null }
type Announcement = { id: string; title: string; body: string; created_at: string }

const ACT_TEXT: Record<string, string> = {
  olusturuldu: 'yeni ders eklendi', kaldirildi: 'ders kaldırıldı', tamamlandi: 'ders tamamlandı', iptal: 'ders iptal edildi',
  ertelendi: 'ders ertelendi', saat: 'ders saati değişti', basladi: 'ders başladı', program: 'haftalık program güncellendi', guncellendi: 'ders güncellendi',
}
function activityText(a: PublicActivity) {
  const when = a.starts_at ? ` (${formatDayLong(dateKey(a.starts_at)).split(',')[0]} ${timeHM(a.starts_at)})` : ''
  return `${a.course_name ?? 'Program'}: ${ACT_TEXT[a.kind] ?? 'güncellendi'}${a.kind === 'program' ? '' : when}`
}

export function PublicSchedulePage() {
  const today = dateKey()
  const [view, setView] = useState<View>('gun')
  const [cursor, setCursor] = useState(today)
  const [lessons, setLessons] = useState<PublicLesson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState<Live>('connecting')
  const reqSeq = useRef(0)
  const [activities, setActivities] = useState<PublicActivity[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  // Herkese açık son hareketler ve duyurular (kişisel veri içermez); hata olursa sessizce eski liste kalır
  const loadExtras = useCallback(async () => {
    const [a, n] = await Promise.all([
      publicClient.rpc('get_public_activities', { p_limit: 8 }),
      publicClient.rpc('get_public_announcements', { p_limit: 3 }),
    ])
    if (!a.error) setActivities((a.data as PublicActivity[]) ?? [])
    if (!n.error) setAnnouncements((n.data as Announcement[]) ?? [])
  }, [])

  const [from, to] = useMemo(() => {
    if (view === 'gun') return [cursor, addDays(cursor, 1)]
    const s = startOfWeek(cursor)
    return [s, addDays(s, 7)]
  }, [view, cursor])

  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    setError(null)
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Sunucu yanıt vermedi')), 12_000))
    try {
      const res = await Promise.race([
        publicClient.rpc('get_public_schedule', { p_from: fromIstanbul(from).toISOString(), p_to: fromIstanbul(to).toISOString() }),
        timeout,
      ])
      if (seq !== reqSeq.current) return
      if (res.error) throw res.error
      setLessons((res.data as PublicLesson[]) ?? [])
    } catch (e) {
      if (seq !== reqSeq.current) return
      setError(errorMessage(e))
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])
  useEffect(() => { void loadExtras().catch(() => undefined) }, [loadExtras])

  // Gerçek zamanlı: kişisel veri taşımayan "program değişti" yayını
  const loadRef = useRef(async () => { await Promise.all([load(), loadExtras().catch(() => undefined)]) })
  loadRef.current = async () => { await Promise.all([load(), loadExtras().catch(() => undefined)]) }
  useEffect(() => {
    let wasLive = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const ch = publicClient
      .channel('public-schedule')
      .on('broadcast', { event: 'changed' }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void loadRef.current(), 250)
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          if (wasLive) void loadRef.current() // yeniden bağlandı: kaçırılan değişiklikleri al
          wasLive = true
          setLive('live')
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          setLive(navigator.onLine ? 'connecting' : 'offline')
        }
      })
    const onOnline = () => { setLive('connecting'); void loadRef.current() }
    const onOffline = () => setLive('offline')
    const onVisible = () => { if (document.visibilityState === 'visible') void loadRef.current() }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      void publicClient.removeChannel(ch)
    }
  }, [])

  const now = Date.now()
  const next = view === 'gun' && cursor === today
    ? lessons.find((l) => l.status === 'planlandi' && !l.started && new Date(l.starts_at).getTime() > now)
    : undefined
  const byDay = useMemo(() => {
    const m = new Map<string, PublicLesson[]>()
    for (const l of lessons) m.set(dateKey(l.starts_at), [...(m.get(dateKey(l.starts_at)) ?? []), l])
    return m
  }, [lessons])
  const days = view === 'gun' ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const move = (d: number) => setCursor(addDays(cursor, view === 'gun' ? d : d * 7))

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-[#0b0f14]">
      <header className="safe-top sticky top-0 z-20 border-b border-slate-200/60 bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b0f14]/90">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <span className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" width={32} height={32} />
            <span className="leading-none">
              <span className="block text-[15px] font-extrabold tracking-[0.14em]">MUTU</span>
              <span className="block text-[10px] font-semibold tracking-[0.32em] text-brand-600">AKADEMİ</span>
            </span>
          </span>
          <span className={clsx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
            live === 'live' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : live === 'offline' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}>
            {live === 'offline' ? <WifiOff className="size-3.5" /> : <Radio className={clsx('size-3.5', live === 'live' && 'animate-pulse')} />}
            {live === 'live' ? 'Canlı' : live === 'offline' ? 'Çevrimdışı' : 'Bağlanıyor'}
          </span>
        </div>
      </header>

      <main className="safe-bottom mx-auto max-w-3xl px-4 pb-10 pt-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Ders Programı</h1>
        <p className="text-sm text-slate-500">{view === 'gun' ? formatDayLong(cursor) : `${formatDayLong(from).split(',')[0]} – ${formatDayLong(addDays(from, 6)).split(',')[0]}`}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Segmented value={view} onChange={setView} options={[{ value: 'gun', label: 'Gün' }, { value: 'hafta', label: 'Hafta' }]} />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" className="h-11 w-11 px-0" onClick={() => move(-1)} aria-label="Önceki"><ChevronLeft className="size-4" /></Button>
            <Button size="sm" variant="secondary" className="h-11" onClick={() => setCursor(today)}>Bugün</Button>
            <Button size="sm" variant="secondary" className="h-11 w-11 px-0" onClick={() => move(1)} aria-label="Sonraki"><ChevronRight className="size-4" /></Button>
          </div>
        </div>

        {announcements.map((a) => (
          <Card key={a.id} className="mt-4 flex gap-3 border-brand-100 bg-brand-50/60 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-brand-600"><Megaphone className="size-5" /></span>
            <span className="min-w-0 flex-1 text-sm">
              <b className="block">{a.title}</b>
              <span className="block whitespace-pre-line text-slate-600">{a.body}</span>
              <span className="mt-1 block text-xs text-slate-400">{relativeTime(a.created_at)}</span>
            </span>
          </Card>
        ))}

        {next && (
          <div className="brand-gradient mt-4 rounded-[1.5rem] p-5 text-white shadow-lg shadow-brand-600/15">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Sıradaki ders · <Countdown to={next.starts_at} /></p>
            <p className="mt-1 text-xl font-bold">{next.student_label ?? 'Ders'}</p>
            <p className="text-sm opacity-90">{next.course_name ?? ''}{next.instructor_label ? ` · ${next.instructor_label}` : ''} · {timeHM(next.starts_at)}–{timeHM(next.ends_at)}</p>
          </div>
        )}

        {error && (
          <Card className="mt-4 flex items-center gap-3 border-red-200 p-4 text-sm dark:border-red-500/30">
            <span className="flex-1 text-red-700 dark:text-red-300">Program alınamadı: {error}</span>
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => { setLoading(true); void load() }}>Yeniden dene</Button>
          </Card>
        )}

        {loading ? (
          <div className="mt-4"><PageLoader /></div>
        ) : (
          <div className="mt-4 space-y-5">
            {days.map((d) => {
              const items = byDay.get(d) ?? []
              if (view === 'hafta' && items.length === 0) return null
              return (
                <section key={d}>
                  {view === 'hafta' && <h2 className={clsx('mb-2 px-1 text-xs font-bold uppercase tracking-wide', d === today ? 'text-brand-600' : 'text-slate-500')}>{d === today ? 'Bugün · ' : ''}{WEEKDAYS[(new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7]} {Number(d.slice(8))}.{d.slice(5, 7)}</h2>}
                  {items.length === 0 ? (
                    <Card><EmptyState icon={<CalendarDays className="size-6" />} title="Bu gün ders yok" /></Card>
                  ) : (
                    <div className="space-y-2.5">
                      {items.map((l) => (
                        <Card key={l.id} className="flex items-center gap-3 p-3.5" style={{ contentVisibility: 'auto' }}>
                          <span className="h-11 w-1.5 shrink-0 rounded-full" style={{ background: l.instructor_color ?? l.course_color ?? '#29a8df' }} />
                          <span className="w-14 shrink-0">
                            <span className="block text-base font-bold tabular-nums">{timeHM(l.starts_at)}</span>
                            <span className="block text-xs tabular-nums text-slate-500">{timeHM(l.ends_at)}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={clsx('block truncate font-semibold', l.status === 'iptal' && 'text-slate-400 line-through')}>{l.student_label ?? 'Ders'}</span>
                            <span className="block truncate text-xs text-slate-500">{l.course_name ?? '—'}{l.instructor_label ? ` · ${l.instructor_label}` : ''}</span>
                          </span>
                          <span className={clsx('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', l.started && l.status === 'planlandi' ? 'bg-accent-50 text-accent-700' : STATUS[l.status].cls)}>
                            {l.started && l.status === 'planlandi' ? 'Devam ediyor' : STATUS[l.status].label}
                          </span>
                        </Card>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
            {view === 'hafta' && lessons.length === 0 && <Card><EmptyState icon={<CalendarDays className="size-6" />} title="Bu hafta ders yok" /></Card>}
          </div>
        )}

        {activities.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-slate-500"><Activity className="size-3.5" /> Son hareketler</h2>
            <Card className="divide-y divide-slate-100 px-4">
              {activities.map((a) => (
                <p key={a.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">{activityText(a)}</span>
                  <span className="shrink-0 text-xs text-slate-400">{relativeTime(a.created_at)}</span>
                </p>
              ))}
            </Card>
          </section>
        )}

        <PublicPushCard />

        <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <Lock className="size-3.5" /> Öğrenci iletişim ve ödeme bilgileri bu ekranda gösterilmez.
        </p>
        <p className="mt-2 text-center"><Link to="/yonetim" className="inline-block min-h-[44px] px-3 py-3 text-xs font-medium text-slate-400">Yönetim</Link></p>
      </main>
      <NotificationPrompt mode="public" />
    </div>
  )
}

function PublicPushCard() {
  const push = usePush(undefined, 'public')
  const toast = useToast()
  const [testing, setTesting] = useState(false)
  if (!push.checked || !push.support.ok || push.permission === 'denied') return null
  if (push.subscribed) {
    const sendTest = async () => {
      setTesting(true)
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!sub) throw new Error('Bu cihazda bildirim aboneliği bulunamadı.')
        const { error } = await publicClient.rpc('send_public_test_push', { p_endpoint: sub.endpoint })
        if (error) throw error
        toast.success('Test bildirimi gönderildi. Birkaç saniye içinde gelmesi gerekir.')
      } catch (e) { toast.error(errorMessage(e)) } finally { setTesting(false) }
    }
    return (
      <Card className="mt-6 flex items-center gap-3 p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><BellRing className="size-5" /></span>
        <span className="flex-1 text-sm"><b className="block">Bildirimler açık</b><span className="text-slate-500">Dersten 1 saat önce hatırlatma alacaksınız.</span></span>
        <Button size="sm" variant="secondary" loading={testing} icon={<Send className="size-4" />} onClick={sendTest}>Test et</Button>
      </Card>
    )
  }
  return (
    <Card className="mt-6 flex items-center gap-3 p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15"><BellRing className="size-5" /></span>
      <span className="flex-1 text-sm"><b className="block">Ders hatırlatmaları</b><span className="text-slate-500">Dersten 1 saat önce bildirim alın.</span></span>
      <Button size="sm" loading={push.busy} onClick={async () => { try { await push.enable(); toast.success('Bildirimler etkinleştirildi') } catch (e) { toast.error(errorMessage(e)) } }}>Etkinleştir</Button>
    </Card>
  )
}
