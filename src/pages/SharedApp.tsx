import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Home, CalendarDays, BookOpenCheck, Bell, Menu as MenuIcon, Plus, Radio, WifiOff, ChevronLeft, ChevronRight, RefreshCw,
  BellRing, Send, Smartphone, Search, Activity, Megaphone, Info, Upload, Download, Users, GraduationCap, ClipboardCheck, BarChart3, Settings, ShieldCheck,
} from 'lucide-react'
import { publicClient } from '@/lib/publicClient'
import {
  addDays, dateKey, formatDayLong, formatDayShort, fromIstanbul, monthGrid, MONTHS, relativeTime, startOfMonth, startOfWeek, timeHM, WEEKDAYS, WEEKDAYS_SHORT,
} from '@/lib/time'
import { matchesSearch, TONE_COLOR } from '@/lib/format'
import { errorMessage } from '@/lib/errors'
import { shared, ACTION_TEXT, type SharedEvent, type SharedLesson } from '@/lib/sharedApi'
import { Badge, Button, Card, EmptyState, Input, PageLoader, Segmented, Toggle } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { Countdown } from '@/components/Countdown'
import { NotificationPrompt } from '@/components/NotificationPrompt'
import { usePush } from '@/hooks/usePush'
import { SharedLessonForm } from '@/components/shared/SharedLessonForm'
import { SharedLessonSheet, sharedStatus } from '@/components/shared/SharedLessonSheet'
import { ImportSheet, ExportSheet } from '@/components/shared/SharedImportExport'
import {
  useStaffData, StaffDashboard, StudentsScreen, StudentProfile, InstructorsScreen, InstructorProfile, ReportsScreen, AttendanceScreen, type Screen,
} from '@/components/staff/StaffViews'
import { StudentFormSheet, InstructorFormSheet } from '@/components/staff/StaffForms'

type AppScreen = Screen | { kind: 'ayarlar' }

type Tab = 'ana' | 'takvim' | 'dersler' | 'ogrenciler' | 'bildirimler' | 'menu'
type Live = 'connecting' | 'live' | 'offline'
type Announcement = { id: string; title: string; body: string; created_at: string }

const TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'ana', label: 'Ana Sayfa', icon: Home },
  { id: 'takvim', label: 'Takvim', icon: CalendarDays },
  { id: 'dersler', label: 'Dersler', icon: BookOpenCheck },
  { id: 'ogrenciler', label: 'Öğrenciler', icon: Users },
  { id: 'menu', label: 'Menü', icon: MenuIcon },
]

/** Değişiklik yayını: bir telefondaki işlem tüm açık telefonlarda listeyi yeniler (kişisel veri taşımaz) */
function useLiveTick() {
  const [tick, setTick] = useState(0)
  const [live, setLive] = useState<Live>('connecting')
  useEffect(() => {
    let wasLive = false, isLive = false, disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let ch: ReturnType<typeof publicClient.channel> | null = null
    const bump = () => setTick((t) => t + 1)
    const connect = () => {
      if (disposed) return
      const c = publicClient.channel('public-schedule').on('broadcast', { event: 'changed' }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(bump, 200)
      })
      ch = c
      c.subscribe((s) => {
        if (disposed || ch !== c) return
        if (s === 'SUBSCRIBED') { if (wasLive) bump(); wasLive = true; isLive = true; setLive('live') }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          isLive = false
          setLive(navigator.onLine ? 'connecting' : 'offline')
          if (navigator.onLine && !retry) retry = setTimeout(reconnect, 3000)
        }
      })
    }
    const reconnect = () => {
      if (retry) { clearTimeout(retry); retry = null }
      if (disposed) return
      const old = ch; ch = null; isLive = false
      if (old) void publicClient.removeChannel(old).then(connect, connect)
      else connect()
    }
    connect()
    const onOnline = () => { setLive('connecting'); bump(); reconnect() }
    const onOffline = () => { isLive = false; setLive('offline') }
    const onVisible = () => { if (document.visibilityState === 'visible') { bump(); if (!isLive) reconnect() } }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      if (retry) clearTimeout(retry)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      if (ch) void publicClient.removeChannel(ch)
    }
  }, [])
  return { tick, live, refresh: () => setTick((t) => t + 1) }
}

/** Tarih aralığındaki ortak dersler (yayın geldikçe sunucudan yeniden alınır) */
function useShared(from: string, to: string, tick: number) {
  const [data, setData] = useState<SharedLesson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  useEffect(() => {
    const n = ++seq.current
    setError(null)
    shared.list(fromIstanbul(from).toISOString(), fromIstanbul(to).toISOString())
      .then((d) => { if (n === seq.current) setData(d ?? []) })
      .catch((e) => { if (n === seq.current) setError(errorMessage(e)) })
  }, [from, to, tick])
  return { data, error, loading: data === null && !error }
}

function LessonCard({ l, onOpen, showDate }: { l: SharedLesson; onOpen: (l: SharedLesson) => void; showDate?: boolean }) {
  const st = sharedStatus(l)
  const faded = l.status === 'iptal' || l.status === 'ertelendi'
  return (
    <button data-testid="ders-kart" onClick={() => onOpen(l)} className="card flex w-full items-center gap-3 p-3.5 text-left active:scale-[.99]">
      <span className="h-12 w-1.5 shrink-0 rounded-full" style={{ background: TONE_COLOR[st.tone] }} />
      <span className="w-14 shrink-0">
        <span className="block text-base font-bold tabular-nums">{timeHM(l.starts_at)}</span>
        <span className="block text-xs tabular-nums text-slate-500">{showDate ? formatDayShort(dateKey(l.starts_at)) : timeHM(l.ends_at)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate font-semibold', faded && 'text-slate-400 line-through')}>{l.course_name}{l.title ? ` · ${l.title}` : ''}</span>
        <span className="block truncate text-xs text-slate-500">{[l.student_label, l.instructor_name, l.room].filter(Boolean).join(' · ') || '—'}</span>
      </span>
      <Badge tone={st.tone}>{st.label}</Badge>
    </button>
  )
}

export function SharedApp() {
  const toast = useToast()
  const today = dateKey()
  const [tab, setTab] = useState<Tab>('ana')
  const { tick, live, refresh } = useLiveTick()
  const [selected, setSelected] = useState<SharedLesson | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SharedLesson | null>(null)
  const [formDate, setFormDate] = useState<string | undefined>(undefined)
  const [undo, setUndo] = useState<{ l: SharedLesson; ids: string[] } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [exportRange, setExportRange] = useState<[string, string] | null>(null)
  const [presetStudent, setPresetStudent] = useState<string | null>(null)
  const [lessonsWhich, setLessonsWhich] = useState<'yaklasan' | 'gecmis'>('yaklasan')
  const [quickAdd, setQuickAdd] = useState<'ogrenci' | 'egitmen' | null>(null)

  // Yetkili cihaz: korumalı öğrenci/eğitmen modülleri aynı arayüzde açılır
  // Öğrenci/eğitmen yönetimi herkese açık ortak çalışma alanındadır (hassas veri yok)
  const isStaff = true
  const sdata = useStaffData(isStaff, tick)
  const staffCtx = isStaff && sdata.students && sdata.instructors ? { students: sdata.students, instructors: sdata.instructors, reload: sdata.reload } : null

  // Alt ekranlar (öğrenci profili vb.) tarayıcı/telefon "geri" hareketiyle kapanır
  const [screen, setScreen] = useState<AppScreen | null>(null)
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setScreen((e.state as { mutuScreen?: AppScreen } | null)?.mutuScreen ?? null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const nav = useCallback((s: AppScreen) => { window.history.pushState({ mutuScreen: s }, ''); setScreen(s); window.scrollTo(0, 0) }, [])
  const goBack = useCallback(() => window.history.back(), [])
  const goTab = (t: Tab) => { if (screen) { setScreen(null); window.history.replaceState(null, '') } setTab(t); window.scrollTo(0, 0) }

  // Öneriler ve Ana Sayfa için yakın dönem (son 31 gün – gelecek 31 gün)
  const near = useShared(addDays(today, -31), addDays(today, 31), tick)
  const suggestions = useMemo(() => {
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].slice(0, 30)
    const ls = near.data ?? []
    return { courses: uniq(ls.map((l) => l.course_name)), instructors: uniq(ls.map((l) => l.instructor_name)), students: uniq(ls.map((l) => l.student_label)), rooms: uniq(ls.map((l) => l.room)) }
  }, [near.data])

  // Açık detay, yayınla gelen güncel haliyle yenilenir
  useEffect(() => {
    if (!selected) return
    const fresh = near.data?.find((x) => x.id === selected.id)
    if (fresh && fresh.version !== selected.version) setSelected(fresh)
  }, [near.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const reloadSelected = useCallback(() => {
    refresh()
    // Yalnızca aynı ders hâlâ açıksa güncelle (kapatılan/silinen ders yeniden açılmasın)
    if (selected) shared.get(selected.id).then((d) => d && setSelected((cur) => (cur?.id === d.id ? d : cur))).catch(() => undefined)
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bildirime dokununca: /?ders=<id>
  const openById = useCallback((id: string) => {
    shared.get(id).then((d) => { if (d) setSelected(d); else toast.error('Ders bulunamadı (silinmiş olabilir).') }).catch((e) => toast.error(errorMessage(e)))
  }, [toast])
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const id = p.get('ders')
    if (id && /^[0-9a-f-]{36}$/i.test(id)) { openById(id); window.history.replaceState(null, '', window.location.pathname) }
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== 'NAVIGATE') return
      const u = new URL(e.data.url, window.location.origin)
      const did = u.searchParams.get('ders')
      if (did) openById(did)
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [openById])

  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 10_000); return () => clearTimeout(t) }, [undo])

  const openNew = (date?: string, studentId?: string) => { setEditing(null); setFormDate(date); setPresetStudent(studentId ?? null); setFormOpen(true) }
  const openStudent = (id: string) => nav({ kind: 'ogrenci', id })

  const renderScreen = (s: AppScreen) => {
    if (s.kind === 'ayarlar') return <SettingsScreen onBack={goBack} onImport={() => setImportOpen(true)} onExport={() => setExportRange([startOfWeek(today), addDays(startOfWeek(today), 35)])} />
    switch (s.kind) {
      case 'ogrenciler': return <StudentsScreen data={sdata} onNav={nav} onBack={goBack} />
      case 'ogrenci': return <StudentProfile key={s.id} id={s.id} data={sdata} tick={tick} onBack={goBack} onOpenLesson={openById} onAddLesson={(sid) => openNew(undefined, sid)} />
      case 'egitmenler': return <InstructorsScreen data={sdata} onNav={nav} onBack={goBack} />
      case 'egitmen': return <InstructorProfile key={s.id} id={s.id} data={sdata} tick={tick} onBack={goBack} onOpenLesson={openById} onNav={nav} />
      case 'raporlar': return <ReportsScreen data={sdata} onBack={goBack} />
      case 'yoklama': return <AttendanceScreen data={sdata} tick={tick} onBack={goBack} onOpenLesson={openById} />
    }
  }

  return (
    <div className="min-h-dvh bg-[#f8fafc] lg:pb-0">
      <header className="safe-top sticky top-0 z-20 border-b border-slate-200/60 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <button onClick={() => goTab('ana')} className="flex items-center gap-2.5" aria-label="Ana sayfa">
            <img src="/logo.png" alt="" width={32} height={32} />
            <span className="leading-none">
              <span className="block text-[15px] font-extrabold tracking-[0.14em]">MUTU</span>
              <span className="block text-[10px] font-semibold tracking-[0.32em] text-brand-600">AKADEMİ</span>
            </span>
          </button>
          <span className={clsx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
            live === 'live' ? 'bg-emerald-50 text-emerald-700' : live === 'offline' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}>
            {live === 'offline' ? <WifiOff className="size-3.5" /> : <Radio className={clsx('size-3.5', live === 'live' && 'animate-pulse')} />}
            {live === 'live' ? 'Canlı' : live === 'offline' ? 'Çevrimdışı' : 'Bağlanıyor'}
          </span>
        </div>
      </header>

      <main className="pb-nav mx-auto max-w-3xl px-4 pt-4">
        {screen ? renderScreen(screen) : (
          <>
            {tab === 'ana' && <HomeTab data={near.data} error={near.error} onOpen={setSelected} onAdd={() => openNew()} onRetry={refresh} tick={tick}
              staffSlot={isStaff ? <StaffDashboard tick={tick} onNav={nav} onAddStudent={() => setQuickAdd('ogrenci')} onAddInstructor={() => setQuickAdd('egitmen')} onAddLesson={() => openNew()} onImport={() => setImportOpen(true)} /> : null} />}
            {tab === 'takvim' && <CalendarTab tick={tick} onOpen={setSelected} onAdd={openNew} onExport={(f, t) => setExportRange([f, t])} onImport={() => setImportOpen(true)} />}
            {tab === 'dersler' && <LessonsTab key={lessonsWhich} initial={lessonsWhich} tick={tick} onOpen={setSelected} />}
            {tab === 'ogrenciler' && <StudentsScreen data={sdata} onNav={nav} />}
            {tab === 'bildirimler' && <NotificationsTab tick={tick} onOpenId={openById} />}
            {tab === 'menu' && <MenuTab onNav={nav}
              onTab={(t, which) => { if (which) setLessonsWhich(which); goTab(t) }} />}
          </>
        )}
      </main>

      <button onClick={() => openNew(tab === 'ana' ? undefined : undefined)} aria-label="Ders ekle"
        className="fixed right-4 z-30 flex h-14 items-center gap-2 rounded-full bg-brand-600 px-5 text-base font-semibold text-white shadow-lg shadow-brand-600/30 active:scale-95"
        style={{ bottom: 'calc(5.25rem + env(safe-area-inset-bottom))' }}>
        <Plus className="size-5" /> Ders Ekle
      </button>

      {undo && (
        <div className="fixed inset-x-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"
          style={{ bottom: 'calc(9.5rem + env(safe-area-inset-bottom))' }} role="status">
          <span className="flex-1">"{undo.l.course_name}"{undo.ids.length > 1 ? ` (${undo.ids.length} ders)` : ''} silindi.</span>
          <button className="min-h-11 px-2 font-bold text-cyan-300" onClick={() => {
            const u = undo; setUndo(null)
            const p = u.ids.length > 1 ? shared.undeleteMany(u.ids) : shared.undelete(u.l.id)
            p.then(() => { toast.success('Ders geri getirildi'); refresh() }).catch((e) => toast.error(errorMessage(e)))
          }}>Geri al</button>
        </div>
      )}
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} onDone={refresh} />
      <ExportSheet open={!!exportRange} onClose={() => setExportRange(null)} from={exportRange?.[0] ?? today} to={exportRange?.[1] ?? addDays(today, 7)} />

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => { if (t.id === 'dersler') setLessonsWhich('yaklasan'); goTab(t.id) }} aria-current={!screen && tab === t.id ? 'page' : undefined}
              className={clsx('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', !screen && tab === t.id ? 'text-brand-600' : 'text-slate-500')}>
              <t.icon className="size-6" />{t.label}
            </button>
          ))}
        </div>
      </nav>

      <SharedLessonSheet lesson={selected} onClose={() => setSelected(null)} onChanged={() => { reloadSelected(); if (isStaff) sdata.reload() }}
        onEdit={(l) => { setSelected(null); setEditing(l); setPresetStudent(null); setFormOpen(true) }}
        onDeleted={(l, ids) => setUndo({ l, ids })} onOpen={openById} staffStudents={isStaff ? sdata.students : null} onOpenStudent={openStudent} />
      <SharedLessonForm open={formOpen} onClose={() => setFormOpen(false)} editing={editing} defaultDate={formDate} suggestions={suggestions}
        onSaved={() => { refresh(); if (isStaff) sdata.reload() }} staffCtx={staffCtx} presetStudentId={presetStudent} />
      {isStaff && (
        <>
          <StudentFormSheet open={quickAdd === 'ogrenci'} onClose={() => setQuickAdd(null)} instructors={sdata.instructors ?? []}
            courses={[...new Set((sdata.students ?? []).flatMap((s) => s.course_names ?? []))]} onSaved={(s) => { sdata.reload(); nav({ kind: 'ogrenci', id: s.id }) }} />
          <InstructorFormSheet open={quickAdd === 'egitmen'} onClose={() => setQuickAdd(null)} courses={[...new Set((sdata.instructors ?? []).flatMap((i) => i.course_names ?? []))]}
            onSaved={(i) => { sdata.reload(); nav({ kind: 'egitmen', id: i.id }) }} />
        </>
      )}
      <NotificationPrompt mode="public" />
    </div>
  )
}

// ---------------------------------------------------------------------------
function HomeTab({ data, error, onOpen, onAdd, onRetry, tick, staffSlot }: { data: SharedLesson[] | null; error: string | null; onOpen: (l: SharedLesson) => void; onAdd: () => void; onRetry: () => void; tick: number; staffSlot?: React.ReactNode }) {
  const today = dateKey()
  const now = Date.now()
  const todays = (data ?? []).filter((l) => dateKey(l.starts_at) === today)
  const active = todays.filter((l) => l.status !== 'ertelendi')
  const next = (data ?? []).find((l) => l.status === 'planlandi' && !l.started_at && new Date(l.starts_at).getTime() > now)
  const running = (data ?? []).filter((l) => l.status === 'planlandi' && (l.started_at || (new Date(l.starts_at).getTime() <= now && new Date(l.ends_at).getTime() > now)))
  const pending = (data ?? []).filter((l) => l.status === 'planlandi' && new Date(l.ends_at).getTime() <= now)
  const [events, setEvents] = useState<SharedEvent[]>([])
  const [ann, setAnn] = useState<Announcement[]>([])
  useEffect(() => {
    shared.events(6).then(setEvents).catch(() => undefined)
    publicClient.rpc('get_public_announcements', { p_limit: 2 }).then((r) => { if (!r.error) setAnn((r.data as Announcement[]) ?? []) })
  }, [tick])
  return (
    <div>
      <p className="text-sm text-slate-500">{formatDayLong(today)}</p>
      <h1 className="text-2xl font-extrabold tracking-tight">Ders Programı</h1>
      {ann.map((a) => (
        <Card key={a.id} className="mt-3 flex gap-3 border-brand-100 bg-brand-50/60 p-4">
          <Megaphone className="size-5 shrink-0 text-brand-600" />
          <span className="text-sm"><b className="block">{a.title}</b>{a.body}</span>
        </Card>
      ))}
      {error && (
        <Card className="mt-4 flex items-center gap-3 border-red-200 p-4 text-sm">
          <span className="flex-1 text-red-700">Program alınamadı: {error}</span>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={onRetry}>Yeniden dene</Button>
        </Card>
      )}
      {staffSlot ?? (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {[['Bugün', active.length], ['Tamamlanan', todays.filter((l) => l.status === 'tamamlandi').length], ['Devam eden', running.length], ['Bekleyen', pending.length]].map(([k, v]) => (
            <Card key={k as string} className="p-3 text-center"><p className="text-xl font-bold tabular-nums">{v}</p><p className="text-[11px] text-slate-500">{k}</p></Card>
          ))}
        </div>
      )}
      {next && (
        <button onClick={() => onOpen(next)} className="brand-gradient mt-4 w-full rounded-[1.5rem] p-5 text-left text-white shadow-lg shadow-brand-600/15">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Sıradaki ders · <Countdown to={next.starts_at} /></p>
          <p className="mt-1 text-xl font-bold">{next.course_name}</p>
          <p className="text-sm opacity-90">{[next.student_label, next.instructor_name].filter(Boolean).join(' · ')} · {dateKey(next.starts_at) === today ? '' : `${formatDayShort(dateKey(next.starts_at))} `}{timeHM(next.starts_at)}–{timeHM(next.ends_at)}</p>
        </button>
      )}
      <Button size="lg" block className="mt-4 h-14 text-base" icon={<Plus className="size-5" />} onClick={onAdd}>Ders Ekle</Button>
      <h2 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-slate-500">Bugünün dersleri</h2>
      {data === null && !error ? <PageLoader rows={3} /> : todays.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="size-6" />} title="Bugün ders yok" text="Yeni ders eklemek için Ders Ekle'ye dokunun." /></Card>
      ) : <div className="space-y-2.5">{todays.map((l) => <LessonCard key={l.id} l={l} onOpen={onOpen} />)}</div>}
      {pending.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-amber-700">Süresi doldu – tamamlanmayı bekliyor</h2>
          <div className="space-y-2.5">{pending.slice(0, 5).map((l) => <LessonCard key={l.id} l={l} onOpen={onOpen} showDate />)}</div>
        </>
      )}
      {events.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><Activity className="size-3.5" />Son hareketler</h2>
          <Card className="divide-y divide-slate-100 px-4">
            {events.map((e) => <EventRow key={e.id} e={e} />)}
          </Card>
        </>
      )}
    </div>
  )
}

function EventRow({ e, onOpen }: { e: SharedEvent; onOpen?: (id: string) => void }) {
  return (
    <button disabled={!onOpen || !e.lesson_id} onClick={() => e.lesson_id && onOpen?.(e.lesson_id)} className="flex w-full items-start justify-between gap-3 py-2.5 text-left text-sm">
      <span className="min-w-0">
        <b>{ACTION_TEXT[e.action] ?? e.action}</b>{e.course_name ? `: ${e.course_name}` : ''}
        {e.starts_at && <span className="text-slate-500"> ({formatDayShort(dateKey(e.starts_at))} {timeHM(e.starts_at)})</span>}
      </span>
      <span className="shrink-0 text-xs text-slate-400">{relativeTime(e.created_at)}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
type CalView = 'gun' | 'hafta' | 'ay'
function CalendarTab({ tick, onOpen, onAdd, onExport, onImport }: {
  tick: number; onOpen: (l: SharedLesson) => void; onAdd: (date?: string) => void; onExport: (from: string, to: string) => void; onImport: () => void
}) {
  const today = dateKey()
  const [view, setView] = useState<CalView>('gun')
  const [cursor, setCursor] = useState(today)
  const [from, to] = useMemo(() => {
    if (view === 'gun') return [cursor, addDays(cursor, 1)]
    if (view === 'hafta') { const s = startOfWeek(cursor); return [s, addDays(s, 7)] }
    const g = monthGrid(cursor); return [g[0], addDays(g[41], 1)]
  }, [view, cursor])
  const { data, error, loading } = useShared(from, to, tick)
  const move = (d: number) => setCursor(view === 'gun' ? addDays(cursor, d) : view === 'hafta' ? addDays(cursor, d * 7) : (() => { const m = new Date(`${startOfMonth(cursor)}T12:00:00Z`); m.setUTCMonth(m.getUTCMonth() + d); return m.toISOString().slice(0, 10) })())
  const byDay = useMemo(() => { const m = new Map<string, SharedLesson[]>(); for (const l of data ?? []) m.set(dateKey(l.starts_at), [...(m.get(dateKey(l.starts_at)) ?? []), l]); return m }, [data])
  const title = view === 'gun' ? formatDayLong(cursor) : view === 'hafta' ? `${formatDayShort(from)} – ${formatDayShort(addDays(from, 6))}` : `${MONTHS[Number(cursor.slice(5, 7)) - 1]} ${cursor.slice(0, 4)}`
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Takvim</h1>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} onClick={onImport}>Yükle</Button>
          <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => onExport(from, to)}>Dışa aktar</Button>
        </div>
      </div>
      <p className="text-sm text-slate-500">{title}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={setView} options={[{ value: 'gun', label: 'Gün' }, { value: 'hafta', label: 'Hafta' }, { value: 'ay', label: 'Ay' }]} />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" className="h-11 w-11 px-0" onClick={() => move(-1)} aria-label="Önceki"><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="secondary" className="h-11" onClick={() => setCursor(today)}>Bugün</Button>
          <Button size="sm" variant="secondary" className="h-11 w-11 px-0" onClick={() => move(1)} aria-label="Sonraki"><ChevronRight className="size-4" /></Button>
        </div>
        <Input type="date" aria-label="Tarihe git" value={cursor} onChange={(e) => e.target.value && setCursor(e.target.value)} className="h-11 w-40 text-sm" />
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">Program alınamadı: {error}</p>}
      <div className="mt-4">
        {loading ? <PageLoader /> : view === 'ay' ? (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-100 text-center text-xs font-semibold text-slate-500">{WEEKDAYS_SHORT.map((w) => <div key={w} className="py-2">{w}</div>)}</div>
            <div className="grid grid-cols-7">
              {monthGrid(cursor).map((d) => {
                const items = (byDay.get(d) ?? []).filter((l) => l.status !== 'ertelendi')
                return (
                  <button key={d} onClick={() => { setCursor(d); setView('gun') }} className={clsx('flex min-h-[64px] flex-col items-center gap-1 border-b border-r border-slate-100 p-1.5', d.slice(0, 7) !== cursor.slice(0, 7) && 'opacity-40')}>
                    <span className={clsx('grid size-7 place-items-center rounded-full text-sm font-semibold', d === today && 'bg-brand-600 text-white')}>{Number(d.slice(8))}</span>
                    {items.length > 0 && <span className="rounded-full bg-brand-50 px-1.5 text-[11px] font-bold text-brand-700">{items.length}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {(view === 'gun' ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(from, i))).map((d) => {
              const items = byDay.get(d) ?? []
              if (view === 'hafta' && items.length === 0) return null
              return (
                <section key={d}>
                  {view === 'hafta' && <h2 className={clsx('mb-2 px-1 text-xs font-bold uppercase tracking-wide', d === today ? 'text-brand-600' : 'text-slate-500')}>{WEEKDAYS[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]} {formatDayShort(d)}</h2>}
                  {items.length === 0 ? (
                    <Card><EmptyState icon={<CalendarDays className="size-6" />} title="Bu gün ders yok" action={<Button icon={<Plus className="size-4" />} onClick={() => onAdd(d)}>Bu güne ders ekle</Button>} /></Card>
                  ) : <div className="space-y-2.5">{items.map((l) => <LessonCard key={l.id} l={l} onOpen={onOpen} />)}</div>}
                </section>
              )
            })}
            {view === 'hafta' && (data ?? []).length === 0 && <Card><EmptyState icon={<CalendarDays className="size-6" />} title="Bu hafta ders yok" /></Card>}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
function LessonsTab({ tick, onOpen, initial = 'yaklasan' }: { tick: number; onOpen: (l: SharedLesson) => void; initial?: 'yaklasan' | 'gecmis' }) {
  const today = dateKey()
  const [which, setWhich] = useState<'yaklasan' | 'gecmis'>(initial)
  const [q, setQ] = useState('')
  const range = which === 'yaklasan' ? [today, addDays(today, 60)] : [addDays(today, -60), addDays(today, 1)]
  const { data, error, loading } = useShared(range[0], range[1], tick)
  const now = Date.now()
  const list = (data ?? []).filter((l) => (which === 'yaklasan' ? new Date(l.ends_at).getTime() >= now || l.status === 'planlandi' : new Date(l.starts_at).getTime() < now)
    && matchesSearch([l.course_name, l.student_label, l.instructor_name, l.room, l.title], q))
  const shown = which === 'gecmis' ? [...list].reverse() : list
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Dersler</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented value={which} onChange={setWhich} options={[{ value: 'yaklasan', label: 'Yaklaşan' }, { value: 'gecmis', label: 'Geçmiş' }]} />
      </div>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kurs, öğrenci, eğitmen ara…" className="pl-10" />
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">Dersler alınamadı: {error}</p>}
      <div className="mt-4 space-y-2.5">
        {loading ? <PageLoader /> : shown.length === 0 ? <Card><EmptyState icon={<BookOpenCheck className="size-6" />} title={q ? 'Aramaya uyan ders yok' : which === 'yaklasan' ? 'Yaklaşan ders yok' : 'Geçmiş ders yok'} /></Card>
          : shown.map((l) => <LessonCard key={l.id} l={l} onOpen={onOpen} showDate />)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
const PREF_ITEMS: { key: string; label: string }[] = [
  { key: 'lesson_60', label: 'Dersten 1 saat önce' },
  { key: 'lesson_15', label: 'Dersten 15 dakika önce' },
  { key: 'lesson_start', label: 'Ders başladığında' },
  { key: 'lesson_end15', label: 'Bitişe 15 dakika kala' },
  { key: 'lesson_end', label: 'Ders bitiş saatinde' },
  { key: 'pub_time', label: 'Ders ertelendiğinde' },
  { key: 'pub_cancel', label: 'Ders iptal edildiğinde' },
  { key: 'pub_done', label: 'Ders tamamlandığında' },
]

async function currentEndpoint(): Promise<string | null> {
  try { const reg = await navigator.serviceWorker.ready; return (await reg.pushManager.getSubscription())?.endpoint ?? null } catch { return null }
}

function NotificationsTab({ tick, onOpenId }: { tick: number; onOpenId: (id: string) => void }) {
  const toast = useToast()
  const push = usePush(undefined, 'public')
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null)
  const [events, setEvents] = useState<SharedEvent[] | null>(null)
  const [testing, setTesting] = useState(false)
  useEffect(() => { shared.events(40).then(setEvents).catch(() => setEvents([])) }, [tick])
  useEffect(() => {
    if (!push.subscribed) { setPrefs(null); return }
    void currentEndpoint().then(async (ep) => {
      if (!ep) return
      try { setPrefs(((await shared.getPrefs(ep)) ?? {}) as Record<string, boolean>) } catch { setPrefs({}) }
    })
  }, [push.subscribed])
  const setPref = async (key: string, val: boolean) => {
    const next = { ...(prefs ?? {}), [key]: val }
    setPrefs(next)
    try { const ep = await currentEndpoint(); if (!ep) throw new Error('Bu cihazda bildirim aboneliği bulunamadı.'); await shared.setPrefs(ep, next); toast.success('Bildirim tercihi kaydedildi') }
    catch (e) { toast.error(errorMessage(e)); setPrefs(prefs) }
  }
  const test = async () => {
    setTesting(true)
    try { const ep = await currentEndpoint(); if (!ep) throw new Error('Bu cihazda bildirim aboneliği bulunamadı.'); const { error } = await publicClient.rpc('send_public_test_push', { p_endpoint: ep }); if (error) throw error; toast.success('Test bildirimi gönderildi; birkaç saniye içinde gelmeli.') }
    catch (e) { toast.error(errorMessage(e)) } finally { setTesting(false) }
  }
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Bildirimler</h1>
      <Card className="mt-4 p-4">
        {!push.checked ? <p className="text-sm text-slate-500">Kontrol ediliyor…</p>
          : !push.support.ok ? (
            <p className="flex gap-2 text-sm text-slate-600"><Info className="size-4 shrink-0 text-brand-600" />
              {push.support.reason === 'ios-not-installed' ? 'iPhone\'da bildirim almak için önce Safari\'de Paylaş → "Ana Ekrana Ekle" ile uygulamayı kurun ve ana ekrandaki simgeden açın.' : 'Bu tarayıcı bildirimleri desteklemiyor.'}</p>
          ) : push.permission === 'denied' ? (
            <p className="text-sm text-slate-600">Bildirim izni kapalı. Telefon ayarlarından Mutu Akademi için bildirimlere izin verin.</p>
          ) : push.subscribed ? (
            <div className="flex items-center gap-3">
              <BellRing className="size-6 text-emerald-600" />
              <span className="flex-1 text-sm"><b className="block">Bildirimler açık</b>Ders hatırlatmaları bu telefona gelir.</span>
              <Button size="sm" variant="secondary" loading={testing} icon={<Send className="size-4" />} onClick={() => void test()}>Test et</Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <BellRing className="size-6 text-brand-600" />
              <span className="flex-1 text-sm"><b className="block">Ders bildirimleri kapalı</b>Dersten önce ve program değişince haber alın.</span>
              <Button size="sm" loading={push.busy} onClick={async () => { try { await push.enable(); toast.success('Bildirimler etkinleştirildi') } catch (e) { toast.error(errorMessage(e)) } }}>Etkinleştir</Button>
            </div>
          )}
      </Card>
      {push.subscribed && prefs && (
        <Card className="mt-3 divide-y divide-slate-100 px-4">
          {PREF_ITEMS.map((p) => <div key={p.key} className="py-1"><Toggle checked={prefs[p.key] !== false} onChange={(v) => void setPref(p.key, v)} label={p.label} /></div>)}
          <div className="py-1"><Toggle checked={!!prefs.grupla} onChange={(v) => void setPref('grupla', v)} label="Bildirimleri grupla" description="Aynı türdeki bildirimler kilit ekranında birikmez." /></div>
          <div className="py-1"><Toggle checked={!!prefs.quiet_enabled} onChange={(v) => void setPref('quiet_enabled', v)} label="Sessiz saatler (22.00–08.00)" description="Bu saatlerde hatırlatma gelmez; erteleme ve iptal yine bildirilir." /></div>
        </Card>
      )}
      <h2 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-slate-500">Son işlemler</h2>
      {events === null ? <PageLoader rows={3} /> : events.length === 0 ? <Card><EmptyState icon={<Activity className="size-6" />} title="Henüz işlem yok" /></Card> : (
        <Card className="divide-y divide-slate-100 px-4">{events.map((e) => <EventRow key={e.id} e={e} onOpen={onOpenId} />)}</Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function BackTitle({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <button onClick={onBack} aria-label="Geri" className="-ml-2 grid size-11 place-items-center rounded-full text-slate-600 active:bg-slate-100"><ChevronLeft className="size-5" /></button>
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
    </div>
  )
}

function MenuTab({ onNav, onTab }: { onNav: (s: AppScreen) => void; onTab: (t: Tab, which?: 'yaklasan' | 'gecmis') => void }) {
  const items: { label: string; icon: typeof Home; on: () => void }[] = [
    { label: 'Ana Sayfa', icon: Home, on: () => onTab('ana') },
    { label: 'Takvim', icon: CalendarDays, on: () => onTab('takvim') },
    { label: 'Dersler', icon: BookOpenCheck, on: () => onTab('dersler') },
    { label: 'Öğrenciler', icon: Users, on: () => onTab('ogrenciler') },
    { label: 'Eğitmenler', icon: GraduationCap, on: () => onNav({ kind: 'egitmenler' }) },
    { label: 'Yoklama', icon: ClipboardCheck, on: () => onNav({ kind: 'yoklama' }) },
    { label: 'Raporlar', icon: BarChart3, on: () => onNav({ kind: 'raporlar' }) },
    { label: 'Bildirimler', icon: Bell, on: () => onTab('bildirimler') },
    { label: 'Ayarlar', icon: Settings, on: () => onNav({ kind: 'ayarlar' }) },
  ]
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Menü</h1>
      <Card className="mt-4 divide-y divide-slate-100">
        {items.map((it) => (
          <button key={it.label} onClick={it.on} className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
            <it.icon className="size-5 text-brand-600" />
            <span className="flex-1 font-semibold">{it.label}</span>
            <ChevronRight className="size-4 text-slate-300" />
          </button>
        ))}
      </Card>
      <p className="mt-6 text-center text-xs text-slate-400">MUTU AKADEMİ · sürüm {__APP_VERSION__}</p>
    </div>
  )
}

function SettingsScreen({ onBack, onImport, onExport }: { onBack: () => void; onImport: () => void; onExport: () => void }) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  return (
    <div>
      <BackTitle title="Ayarlar" onBack={onBack} />
      <Card className="divide-y divide-slate-100">
        <button onClick={onImport} className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
          <Upload className="size-5 text-brand-600" /><span className="flex-1"><b className="block">Program yükle</b><span className="text-sm text-slate-500">Excel veya CSV</span></span><ChevronRight className="size-4 text-slate-300" />
        </button>
        <button onClick={onExport} className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
          <Download className="size-5 text-brand-600" /><span className="flex-1"><b className="block">Programı dışa aktar</b><span className="text-sm text-slate-500">PDF, Excel, CSV</span></span><ChevronRight className="size-4 text-slate-300" />
        </button>
      </Card>
      {!standalone && (
        <Card className="mt-3 p-4">
          <p className="flex items-center gap-2 font-semibold"><Smartphone className="size-5 text-brand-600" />Uygulama olarak kur</p>
          <p className="mt-1 text-sm text-slate-600">{ios ? 'Safari\'de Paylaş → "Ana Ekrana Ekle".' : 'Tarayıcı menüsünden "Uygulamayı yükle".'}</p>
        </Card>
      )}
      <p className="mt-3 flex gap-2 px-1 text-xs text-slate-500"><ShieldCheck className="size-4 shrink-0 text-brand-600" />Program, öğrenci ve eğitmen bilgileri bağlantıya sahip herkesçe görülebilir. Telefon, veli, ödeme veya sağlık bilgisi yazmayın.</p>
      <p className="mt-6 text-center text-xs text-slate-400">MUTU AKADEMİ · sürüm {__APP_VERSION__}</p>
    </div>
  )
}
