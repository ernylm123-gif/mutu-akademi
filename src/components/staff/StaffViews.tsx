import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Clock, Download, GraduationCap, Lock, Pencil, Phone, Plus, Search, Upload,
  UserPlus, Users, AlertTriangle, CheckCircle2, BarChart3, ClipboardCheck,
} from 'lucide-react'
import { addDays, dateKey, formatDayShort, MONTHS, timeHM, WEEKDAYS } from '@/lib/time'
import { matchesSearch, telHref } from '@/lib/format'
import { errorMessage } from '@/lib/errors'
import { shared, type SharedAttendance } from '@/lib/sharedApi'
import {
  staff, hm, exportTable, ATT_LABEL, ATT_ORDER, STATUS_LABEL,
  type Dashboard, type InstructorStats, type Overview, type Package, type ReportRow, type StaffInstructor, type StaffLesson, type StaffStudent, type StudentStats, type Availability, type WeeklySlot,
} from '@/lib/staffApi'
import { Badge, Button, Card, EmptyState, Field, Input, PageLoader, Segmented, Select, Sheet } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { StudentFormSheet, InstructorFormSheet } from './StaffForms'

export type Screen =
  | { kind: 'ogrenciler' } | { kind: 'ogrenci'; id: string } | { kind: 'egitmenler' } | { kind: 'egitmen'; id: string }
  | { kind: 'raporlar' } | { kind: 'yoklama' }

const monthKey = (d = dateKey()) => `${d.slice(0, 7)}-01`
const shiftMonth = (m: string, n: number) => { const d = new Date(`${m}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7) + '-01' }
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const pct = (a: number, b: number) => (b > 0 ? `%${Math.round((a / b) * 100)}` : '—')
const dmy = (iso: string) => dateKey(iso).split('-').reverse().join('.')

/** Yetkili cihaz verileri: öğrenciler, eğitmenler ve liste özetleri (yayın geldikçe yenilenir) */
export function useStaffData(enabled: boolean, tick: number) {
  const [students, setStudents] = useState<StaffStudent[] | null>(null)
  const [instructors, setInstructors] = useState<StaffInstructor[] | null>(null)
  const [overview, setOverview] = useState<Map<string, Overview>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    Promise.all([staff.students(), staff.instructors(), staff.overview()])
      .then(([s, i, o]) => { if (!alive) return; setStudents(s); setInstructors(i); setOverview(new Map(o.map((x) => [x.id, x]))); setError(null) })
      .catch((e) => alive && setError(errorMessage(e)))
    return () => { alive = false }
  }, [enabled, tick, n])
  return { students, instructors, overview, error, reload: useCallback(() => setN((x) => x + 1), []) }
}
export type StaffData = ReturnType<typeof useStaffData>

export function StaffLock() {
  return (
    <Card className="mt-4 p-5 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-600"><Lock className="size-5" /></span>
      <p className="mt-3 font-bold">Bu bölüm yalnızca yetkili cihazlarda açılır</p>
      <p className="mt-1 text-sm text-slate-500">Öğrenci ve eğitmen bilgileri korunur. Yöneticinizden bu cihaza özel tek kullanımlık bağlantıyı isteyip bu cihazda açın.</p>
    </Card>
  )
}

function Header({ title, onBack, action }: { title: string; onBack?: () => void; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {onBack && <button onClick={onBack} aria-label="Geri" className="-ml-2 grid size-11 place-items-center rounded-full text-slate-600 active:bg-slate-100"><ArrowLeft className="size-5" /></button>}
      <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight">{title}</h1>
      {action}
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'red' | 'amber' | 'green' }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={clsx('mt-0.5 text-lg font-bold tabular-nums', tone === 'red' && 'text-red-600', tone === 'amber' && 'text-amber-600', tone === 'green' && 'text-emerald-600')}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </Card>
  )
}

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="secondary" className="h-11 w-11 px-0" aria-label="Önceki ay" onClick={() => onChange(shiftMonth(month, -1))}><ChevronLeft className="size-4" /></Button>
      <span className="min-w-28 text-center text-sm font-bold">{monthLabel(month)}</span>
      <Button size="sm" variant="secondary" className="h-11 w-11 px-0" aria-label="Sonraki ay" onClick={() => onChange(shiftMonth(month, 1))}><ChevronRight className="size-4" /></Button>
    </div>
  )
}

function Bars({ data }: { data: { label: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex h-36 items-end gap-2" role="img" aria-label={data.map((d) => `${d.label}: ${d.text}`).join(', ')}>
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] font-semibold tabular-nums text-slate-500">{d.text}</span>
          <div className="w-full rounded-t-lg bg-brand-500/85" style={{ height: `${Math.max(3, (d.value / max) * 96)}px` }} />
          <span className="text-[11px] text-slate-500">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function ExportButtons({ onExport }: { onExport: (k: 'pdf' | 'xlsx' | 'csv') => Promise<void> }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (k: 'pdf' | 'xlsx' | 'csv') => {
    setBusy(k)
    try { await onExport(k) } catch (e) { toast.error(`Dışa aktarılamadı: ${errorMessage(e)}`) } finally { setBusy(null) }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" loading={busy === 'pdf'} icon={<Download className="size-4" />} onClick={() => void run('pdf')}>PDF</Button>
      <Button size="sm" variant="secondary" loading={busy === 'xlsx'} icon={<Download className="size-4" />} onClick={() => void run('xlsx')}>Excel</Button>
      <Button size="sm" variant="secondary" loading={busy === 'csv'} icon={<Download className="size-4" />} onClick={() => void run('csv')}>CSV</Button>
    </div>
  )
}

function LessonRow({ l, onOpen, extra }: { l: StaffLesson; onOpen: (id: string) => void; extra?: ReactNode }) {
  const faded = l.status === 'iptal' || l.status === 'ertelendi'
  return (
    <button onClick={() => onOpen(l.id)} className="flex w-full items-center gap-3 py-2.5 text-left text-sm">
      <span className="w-20 shrink-0 tabular-nums"><b className="block">{formatDayShort(dateKey(l.starts_at))}</b><span className="text-xs text-slate-500">{timeHM(l.starts_at)}–{timeHM(l.ends_at)}</span></span>
      <span className={clsx('min-w-0 flex-1 truncate', faded && 'text-slate-400 line-through')}>{l.course_name}<span className="block truncate text-xs text-slate-500">{[l.student_label, l.instructor_name].filter(Boolean).join(' · ')}</span></span>
      {extra ?? <Badge tone={l.status === 'tamamlandi' ? 'green' : l.status === 'iptal' ? 'red' : l.status === 'ertelendi' ? 'amber' : 'brand'}>{STATUS_LABEL[l.status]}</Badge>}
    </button>
  )
}

const attTone = (a: SharedAttendance | null | undefined) => (a === 'katilmadi' ? 'red' : a === 'izinli' ? 'amber' : a ? 'green' : 'slate')

// ---------------------------------------------------------------------------
// Ana sayfa paneli
export function StaffDashboard({ tick, onNav, onAddStudent, onAddInstructor, onAddLesson, onImport }: {
  tick: number; onNav: (s: Screen) => void; onAddStudent: () => void; onAddInstructor: () => void; onAddLesson: () => void; onImport: () => void
}) {
  const [d, setD] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { staff.dashboard().then((x) => { setD(x); setError(null) }).catch((e) => setError(errorMessage(e))) }, [tick])
  return (
    <section className="mt-4">
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Akademi istatistikleri alınamadı: {error}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button onClick={() => onNav({ kind: 'ogrenciler' })} className="text-left"><Tile label="Aktif öğrenci" value={d?.active_students ?? '…'} /></button>
        <button onClick={() => onNav({ kind: 'egitmenler' })} className="text-left"><Tile label="Eğitmen" value={d?.instructors ?? '…'} /></button>
        <Tile label="Bugünkü ders" value={d?.today ?? '…'} sub={d ? `${d.today_completed} tamamlandı` : undefined} />
        <Tile label="Yaklaşan (7 gün)" value={d?.upcoming ?? '…'} />
        <Tile label="Bu ay verilen eğitim" value={d ? hm(d.month_taught_min) : '…'} sub={d ? `${d.month_completed} ders tamamlandı` : undefined} />
        <Tile label="Bu ay ertelenen" value={d?.month_postponed ?? '…'} tone={d && d.month_postponed > 0 ? 'amber' : undefined} />
        <button onClick={() => onNav({ kind: 'yoklama' })} className="text-left"><Tile label="Yoklama bekleyen" value={d?.needs_attendance ?? '…'} tone={d && d.needs_attendance > 0 ? 'amber' : undefined} /></button>
        <button onClick={() => onNav({ kind: 'ogrenciler' })} className="text-left"><Tile label="Hakkı azalan" value={d?.low_credit.length ?? '…'} tone={d && d.low_credit.length > 0 ? 'red' : undefined} sub={d ? `${d.low_credit_threshold} ders ve altı` : undefined} /></button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          { label: 'Öğrenci', icon: <UserPlus className="size-5" />, on: onAddStudent },
          { label: 'Eğitmen', icon: <GraduationCap className="size-5" />, on: onAddInstructor },
          { label: 'Ders', icon: <Plus className="size-5" />, on: onAddLesson },
          { label: 'Program Yükle', icon: <Upload className="size-5" />, on: onImport },
        ].map((a) => (
          <button key={a.label} onClick={a.on} className="card flex min-h-[4.5rem] flex-col items-center justify-center gap-1 p-2 text-xs font-semibold text-slate-700 active:scale-[.98]">
            <span className="text-brand-600">{a.icon}</span>{a.label === 'Program Yükle' ? a.label : `+ ${a.label}`}
          </button>
        ))}
      </div>
      {d && d.low_credit.length > 0 && (
        <Card className="mt-3 divide-y divide-slate-100 px-4">
          <p className="flex items-center gap-1.5 py-2.5 text-xs font-bold uppercase tracking-wide text-red-700"><AlertTriangle className="size-3.5" />Ders hakkı azalan öğrenciler</p>
          {d.low_credit.slice(0, 5).map((s) => (
            <button key={s.id} onClick={() => onNav({ kind: 'ogrenci', id: s.id })} className="flex w-full items-center justify-between py-2.5 text-sm">
              <span className="font-medium">{s.name}</span><Badge tone={s.remaining <= 0 ? 'red' : 'amber'}>{s.remaining} ders kaldı</Badge>
            </button>
          ))}
        </Card>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Öğrenciler
export function StudentsScreen({ data, onNav, onBack }: { data: StaffData; onNav: (s: Screen) => void; onBack: () => void }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'aktif' | 'pasif' | 'az' | 'tum'>('aktif')
  const [course, setCourse] = useState('')
  const [instr, setInstr] = useState('')
  const [adding, setAdding] = useState(false)
  const courses = useMemo(() => [...new Set((data.students ?? []).flatMap((s) => s.course_names ?? []))].sort((a, b) => a.localeCompare(b, 'tr')), [data.students])
  const list = (data.students ?? []).filter((s) => {
    const o = data.overview.get(s.id)
    if (filter === 'aktif' && !s.is_active) return false
    if (filter === 'pasif' && s.is_active) return false
    if (filter === 'az' && !(s.is_active && o && o.purchased > 0 && o.remaining <= 2)) return false
    if (course && !(s.course_names ?? []).includes(course)) return false
    if (instr && !(s.instructor_ids ?? []).includes(instr)) return false
    return matchesSearch([s.full_name, s.public_label, s.phone, ...(s.course_names ?? [])], q)
  })
  return (
    <div>
      <Header title="Öğrenciler" onBack={onBack} action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Öğrenci Ekle</Button>} />
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, telefon veya kurs ara…" className="pl-10" />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Segmented value={filter} onChange={setFilter} options={[{ value: 'aktif', label: 'Aktif' }, { value: 'az', label: 'Hakkı azalan' }, { value: 'pasif', label: 'Pasif' }, { value: 'tum', label: 'Tümü' }]} />
        <Select aria-label="Kurs filtresi" value={course} onChange={(e) => setCourse(e.target.value)} className="h-11 w-auto text-sm"><option value="">Tüm kurslar</option>{courses.map((c) => <option key={c}>{c}</option>)}</Select>
        <Select aria-label="Eğitmen filtresi" value={instr} onChange={(e) => setInstr(e.target.value)} className="h-11 w-auto text-sm"><option value="">Tüm eğitmenler</option>{(data.instructors ?? []).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}</Select>
      </div>
      {data.error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">Öğrenciler alınamadı: {data.error}</p>}
      <div className="mt-3 space-y-2">
        {data.students === null && !data.error ? <PageLoader /> : list.length === 0 ? (
          <Card><EmptyState icon={<Users className="size-6" />} title={q || course || instr || filter !== 'aktif' ? 'Filtreye uyan öğrenci yok' : 'Henüz öğrenci yok'}
            action={<Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Öğrenci Ekle</Button>} /></Card>
        ) : list.map((s) => {
          const o = data.overview.get(s.id)
          return (
            <button key={s.id} data-testid="ogrenci-kart" onClick={() => onNav({ kind: 'ogrenci', id: s.id })} className="card flex w-full items-center gap-3 p-3.5 text-left active:scale-[.99]">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{s.full_name.slice(0, 1).toLocaleUpperCase('tr-TR')}</span>
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate font-semibold', !s.is_active && 'text-slate-400')}>{s.full_name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[(s.course_names ?? []).join(', '), o?.next_at ? `Sonraki: ${formatDayShort(dateKey(o.next_at))} ${timeHM(o.next_at)}` : null, o ? `Bu ay ${hm(o.month_min)}` : null].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              {o && o.purchased > 0 && <Badge tone={o.remaining <= 0 ? 'red' : o.remaining <= 2 ? 'amber' : 'slate'}>{o.remaining} hak</Badge>}
            </button>
          )
        })}
      </div>
      <StudentFormSheet open={adding} onClose={() => setAdding(false)} instructors={data.instructors ?? []} courses={courses}
        onSaved={(s) => { data.reload(); onNav({ kind: 'ogrenci', id: s.id }) }} />
    </div>
  )
}

type StudentTab = 'genel' | 'program' | 'gecmis' | 'yoklama' | 'haklar' | 'istatistik'
export function StudentProfile({ id, data, tick, onBack, onOpenLesson, onAddLesson }: {
  id: string; data: StaffData; tick: number; onBack: () => void; onOpenLesson: (id: string) => void; onAddLesson: (studentId: string) => void
}) {
  const s = data.students?.find((x) => x.id === id) ?? null
  const [tab, setTab] = useState<StudentTab>('genel')
  const [month, setMonth] = useState(monthKey())
  const [st, setSt] = useState<StudentStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [weekly, setWeekly] = useState<WeeklySlot[]>([])
  useEffect(() => {
    let alive = true
    staff.studentStats(id, month).then((x) => { if (alive) { setSt(x); setError(null) } }).catch((e) => alive && setError(errorMessage(e)))
    staff.weekly(id).then((w) => alive && setWeekly(w)).catch(() => undefined)
    return () => { alive = false }
  }, [id, month, tick])
  if (!s) return <div><Header title="Öğrenci" onBack={onBack} />{data.students === null ? <PageLoader /> : <Card><EmptyState title="Öğrenci bulunamadı" /></Card>}</div>
  const iname = (iid: string | null) => data.instructors?.find((i) => i.id === iid)?.full_name ?? '—'
  const now = Date.now()
  const m = st?.month
  const exportMonth = async (k: 'pdf' | 'xlsx' | 'csv') => {
    if (!st || !m) return
    const summary: (string | number)[][] = [
      ['Planlanan ders', m.planned], ['Katıldığı ders', m.attended], ['Aldığı eğitim', hm(m.attended_min)], ['Ertelenen', m.postponed],
      ['İptal', m.cancelled], ['Devamsızlık', m.absent], ['İzinli', m.excused], ['Kalan ders hakkı', st.credits.remaining],
    ]
    const lessons = st.lessons.map((l) => [dmy(l.starts_at), `${timeHM(l.starts_at)}–${timeHM(l.ends_at)}`, l.course_name, l.instructor_name ?? '—', STATUS_LABEL[l.status], l.my_att ? ATT_LABEL[l.my_att] : '—'])
    if (k === 'pdf') {
      const { downloadPdf } = await import('@/lib/pdf')
      await downloadPdf(`ogrenci-${s.public_label}-${month.slice(0, 7)}`, `Öğrenci: ${s.full_name}`, monthLabel(month), [
        { title: 'Aylık özet', headers: ['Ölçüt', 'Değer'], rows: summary, widths: ['*', 120] },
        { title: 'Dersler', headers: ['Tarih', 'Saat', 'Kurs', 'Eğitmen', 'Durum', 'Yoklama'], rows: lessons },
      ])
    } else await exportTable(k, `ogrenci-${s.public_label}-${month.slice(0, 7)}`, 'Öğrenci raporu', monthLabel(month),
      ['Tarih', 'Saat', 'Kurs', 'Eğitmen', 'Durum', 'Yoklama'], [...lessons, [], ...summary.map((r) => [String(r[0]), String(r[1]), '', '', '', ''])])
  }
  return (
    <div>
      <Header title={s.full_name} onBack={onBack} action={<Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Düzenle</Button>} />
      <div className="-mx-4 mb-3 overflow-x-auto px-4">
        <div className="flex w-max gap-1.5">
          {([['genel', 'Genel'], ['program', 'Ders Programı'], ['gecmis', 'Ders Geçmişi'], ['yoklama', 'Yoklama'], ['haklar', 'Ders Hakları'], ['istatistik', 'İstatistikler']] as [StudentTab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={clsx('h-10 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold', tab === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>{label}</button>
          ))}
        </div>
      </div>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">İstatistikler alınamadı: {error}</p>}
      {(tab === 'gecmis' || tab === 'yoklama' || tab === 'istatistik' || tab === 'program') && <div className="mb-3 flex justify-end"><MonthNav month={month} onChange={setMonth} /></div>}
      {!st ? <PageLoader /> : tab === 'genel' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Kalan ders hakkı" value={st.credits.remaining} sub={`${st.credits.purchased} alındı · ${st.credits.used} kullanıldı`} tone={st.credits.remaining <= 0 ? 'red' : st.credits.remaining <= 2 ? 'amber' : undefined} />
            <Tile label="Toplam eğitim" value={hm(st.total.attended_min)} sub={`${st.total.attended} derse katıldı`} />
            <Tile label="Bu ay" value={hm(st.this_month.attended_min)} sub={`${st.this_month.attended} ders`} />
            <Tile label="Bu hafta" value={hm(st.week.attended_min)} sub={`${st.week.attended} ders`} />
            <Tile label="Devam oranı" value={pct(st.total.attended, st.total.completed)} sub={`${st.total.absent} devamsızlık`} />
            <Tile label="Planlanan ders" value={st.total.planned} sub={`${st.total.completed} tamamlandı`} />
            <Tile label="Ertelenen" value={st.total.postponed} />
            <Tile label="İptal" value={st.total.cancelled} />
          </div>
          <Card className="divide-y divide-slate-100 px-4 text-sm">
            <Row k="Sonraki ders" v={st.next ? <button className="font-semibold text-brand-700" onClick={() => onOpenLesson(st.next!.id)}>{formatDayShort(dateKey(st.next.starts_at))} {timeHM(st.next.starts_at)} · {st.next.course_name}</button> : '—'} />
            <Row k="Son tamamlanan" v={st.last ? <button className="font-semibold" onClick={() => onOpenLesson(st.last!.id)}>{formatDayShort(dateKey(st.last.starts_at))} · {st.last.course_name}{st.last.attendance ? ` · ${ATT_LABEL[st.last.attendance]}` : ''}</button> : '—'} />
            <Row k="Telefon" v={s.phone ? <a href={telHref(s.phone)} className="flex items-center gap-1 font-semibold text-brand-700"><Phone className="size-3.5" />{s.phone}</a> : '—'} />
            <Row k="Veli" v={[s.guardian_name, s.guardian_phone].filter(Boolean).join(' · ') || '—'} />
            <Row k="Kayıt tarihi" v={s.registered_at ? s.registered_at.split('-').reverse().join('.') : '—'} />
            <Row k="Kurslar" v={(s.course_names ?? []).join(', ') || '—'} />
            <Row k="Eğitmen" v={(s.instructor_ids ?? []).map(iname).join(', ') || '—'} />
            <Row k="Ders paketi" v={s.package_name || '—'} />
            <Row k="Varsayılan süre" v={`${s.default_duration} dk`} />
            <Row k="Programda görünen ad" v={s.public_label} />
            <Row k="Durum" v={<Badge tone={s.is_active ? 'green' : 'slate'}>{s.is_active ? 'Aktif' : 'Pasif'}</Badge>} />
          </Card>
          {s.notes && <Card className="p-4 text-sm"><p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Notlar</p><p className="whitespace-pre-wrap">{s.notes}</p></Card>}
          <Button block icon={<Plus className="size-4" />} onClick={() => onAddLesson(s.id)}>Bu öğrenciye ders ekle</Button>
        </div>
      ) : tab === 'program' ? (
        <div className="space-y-3">
          <Card className="p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Haftalık program</p>
            {weekly.length === 0 ? <p className="text-sm text-slate-500">Haftalık düzenli ders tanımlı değil.</p> : (
              <ul className="space-y-1 text-sm">{weekly.map((w) => <li key={w.id}><b>{WEEKDAYS[w.weekday - 1]}</b> {w.start_time.slice(0, 5)} · {w.duration_minutes} dk{w.instructor_id ? ` · ${iname(w.instructor_id)}` : ''}</li>)}</ul>
            )}
          </Card>
          <LessonList title={`${monthLabel(month)} – planlanan dersler`} lessons={st.lessons.filter((l) => l.status === 'planlandi')} onOpen={onOpenLesson} empty="Bu ay planlanan ders yok." />
          <Button block icon={<Plus className="size-4" />} onClick={() => onAddLesson(s.id)}>Ders ekle</Button>
        </div>
      ) : tab === 'gecmis' ? (
        <LessonList title={`${monthLabel(month)} – geçmiş dersler`} lessons={st.lessons.filter((l) => new Date(l.starts_at).getTime() < now || l.status !== 'planlandi').reverse()} onOpen={onOpenLesson} empty="Bu ay geçmiş ders yok." />
      ) : tab === 'yoklama' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <Tile label="Katıldı" value={m!.attended - m!.late - m!.early} tone="green" /><Tile label="Gelmedi" value={m!.absent} tone={m!.absent ? 'red' : undefined} />
            <Tile label="İzinli" value={m!.excused} /><Tile label="Geç geldi" value={m!.late} /><Tile label="Erken ayrıldı" value={m!.early} />
          </div>
          <LessonList title="Yoklama kayıtları" lessons={st.lessons.filter((l) => l.status === 'tamamlandi')} onOpen={onOpenLesson} empty="Bu ay yoklaması alınmış ders yok."
            extra={(l) => <Badge tone={attTone(l.my_att)}>{l.my_att ? ATT_LABEL[l.my_att] : '—'}</Badge>} />
        </div>
      ) : tab === 'haklar' ? (
        <CreditsPanel student={s} credits={st.credits} tick={tick} onChanged={data.reload} />
      ) : (
        <div className="space-y-3">
          <Card className="p-4">
            <p className="text-sm text-slate-500">Öğrenci: <b className="text-slate-900">{s.full_name}</b> · {monthLabel(month)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Tile label="Planlanan ders" value={m!.planned} /><Tile label="Katıldığı ders" value={m!.attended} />
              <Tile label="Aldığı eğitim" value={hm(m!.attended_min)} sub={`Planlanan süre ${hm(m!.scheduled_min)}`} />
              <Tile label="Ertelenen" value={m!.postponed} /><Tile label="Devamsızlık" value={m!.absent} tone={m!.absent ? 'red' : undefined} />
              <Tile label="Kalan ders hakkı" value={st.credits.remaining} />
            </div>
            <p className="mt-2 text-xs text-slate-500">İptal edilen ve ertelenen dersler eğitim süresine eklenmez; ertelenen dersin yeni tarihi ayrı sayılır.</p>
          </Card>
          <Card className="p-4">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><BarChart3 className="size-3.5" />Son 6 ay – aldığı eğitim</p>
            <Bars data={st.history.map((h) => ({ label: MONTHS[Number(h.month.slice(5, 7)) - 1].slice(0, 3), value: h.attended_min, text: hm(h.attended_min) }))} />
          </Card>
          <Card className="divide-y divide-slate-100 px-4 text-sm">
            <p className="py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500">Kurs bazında toplam eğitim</p>
            {st.by_course.length === 0 ? <p className="py-3 text-slate-500">Henüz tamamlanan ders yok.</p>
              : st.by_course.map((c) => <Row key={c.course} k={c.course} v={`${hm(c.attended_min)} · ${c.attended} ders`} />)}
          </Card>
          <ExportButtons onExport={exportMonth} />
        </div>
      )}
      <StudentFormSheet open={editing} onClose={() => setEditing(false)} student={s} instructors={data.instructors ?? []}
        courses={[...new Set((data.students ?? []).flatMap((x) => x.course_names ?? []))]} onSaved={() => data.reload()} />
    </div>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-slate-500">{k}</span><span className="min-w-0 text-right">{v}</span></div>
}

function LessonList({ title, lessons, onOpen, empty, extra }: { title: string; lessons: StaffLesson[]; onOpen: (id: string) => void; empty: string; extra?: (l: StaffLesson) => ReactNode }) {
  return (
    <Card className="divide-y divide-slate-100 px-4">
      <p className="py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500">{title} ({lessons.length})</p>
      {lessons.length === 0 ? <p className="py-3 text-sm text-slate-500">{empty}</p> : lessons.map((l) => <LessonRow key={l.id} l={l} onOpen={onOpen} extra={extra?.(l)} />)}
    </Card>
  )
}

function CreditsPanel({ student, credits, tick, onChanged }: { student: StaffStudent; credits: StudentStats['credits']; tick: number; onChanged: () => void }) {
  const toast = useToast()
  const [pkgs, setPkgs] = useState<Package[] | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('Ders paketi')
  const [count, setCount] = useState(8)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => { staff.packages(student.id).then(setPkgs).catch(() => setPkgs([])) }, [student.id, tick, n])
  const add = async () => {
    setBusy(true)
    try { await staff.addPackage(student.id, name.trim() || 'Ders paketi', Math.round(count), note); toast.success('Ders paketi eklendi'); setOpen(false); setN((x) => x + 1); onChanged() }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const voidPkg = async (p: Package) => {
    try { await staff.voidPackage(p.id, 'Hatalı kayıt'); toast.success('Paket iptal edildi'); setN((x) => x + 1); onChanged() } catch (e) { toast.error(errorMessage(e)) }
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Satın alınan" value={credits.purchased} /><Tile label="Kullanılan" value={credits.used} />
        <Tile label="Kalan" value={credits.remaining} tone={credits.remaining <= 0 ? 'red' : credits.remaining <= 2 ? 'amber' : 'green'} />
      </div>
      <p className="text-xs text-slate-500">Kullanılan hak, tamamlanan derslerin yoklamasından hesaplanır (katıldı, geç geldi, erken ayrıldı ve ayarlara göre gelmedi). İzinli dersler hak düşürmez; aynı ders iki kez düşülmez.</p>
      <Button block icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Ders paketi ekle</Button>
      <Card className="divide-y divide-slate-100 px-4 text-sm">
        <p className="py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500">Paket ve düzeltme geçmişi</p>
        {pkgs === null ? <PageLoader rows={2} /> : pkgs.length === 0 ? <p className="py-3 text-slate-500">Kayıt yok.</p> : pkgs.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className={clsx('min-w-0', p.is_void && 'text-slate-400 line-through')}><b>{p.name}</b><span className="block text-xs text-slate-500">{p.purchased_at.split('-').reverse().join('.')}{p.note ? ` · ${p.note}` : ''}</span></span>
            <span className="flex items-center gap-2"><Badge tone={p.lesson_count > 0 ? 'green' : 'red'}>{p.lesson_count > 0 ? '+' : ''}{p.lesson_count}</Badge>
              {!p.is_void && <button className="min-h-10 px-1 text-xs font-semibold text-slate-500" onClick={() => void voidPkg(p)}>İptal</button>}</span>
          </div>
        ))}
      </Card>
      <Sheet open={open} onClose={() => setOpen(false)} title="Ders paketi ekle"
        footer={<div className="flex gap-2"><Button variant="secondary" block onClick={() => setOpen(false)}>Vazgeç</Button><Button block loading={busy} disabled={count < 1} onClick={() => void add()}>Ekle</Button></div>}>
        <div className="grid gap-4">
          <Field label="Paket adı"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Ders sayısı"><Input type="number" inputMode="numeric" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>
          <Field label="Not"><Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </Sheet>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Eğitmenler
export function InstructorsScreen({ data, onNav, onBack }: { data: StaffData; onNav: (s: Screen) => void; onBack: () => void }) {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [showPassive, setShowPassive] = useState(false)
  const courses = useMemo(() => [...new Set((data.instructors ?? []).flatMap((i) => i.course_names ?? []))], [data.instructors])
  const list = (data.instructors ?? []).filter((i) => (showPassive || i.is_active) && matchesSearch([i.full_name, i.public_label, i.specialty, ...(i.course_names ?? [])], q))
  return (
    <div>
      <Header title="Eğitmenler" onBack={onBack} action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Eğitmen Ekle</Button>} />
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, branş veya kurs ara…" className="pl-10" />
      </div>
      <div className="mt-2"><Segmented value={showPassive ? 'tum' : 'aktif'} onChange={(v) => setShowPassive(v === 'tum')} options={[{ value: 'aktif', label: 'Aktif' }, { value: 'tum', label: 'Tümü' }]} /></div>
      {data.error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">Eğitmenler alınamadı: {data.error}</p>}
      <div className="mt-3 space-y-2">
        {data.instructors === null && !data.error ? <PageLoader /> : list.length === 0 ? (
          <Card><EmptyState icon={<GraduationCap className="size-6" />} title={q ? 'Aramaya uyan eğitmen yok' : 'Henüz eğitmen yok'} action={<Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Eğitmen Ekle</Button>} /></Card>
        ) : list.map((i) => (
          <button key={i.id} data-testid="egitmen-kart" onClick={() => onNav({ kind: 'egitmen', id: i.id })} className="card flex w-full items-center gap-3 p-3.5 text-left active:scale-[.99]">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-cyan-50 text-sm font-bold text-cyan-700">{i.full_name.slice(0, 1).toLocaleUpperCase('tr-TR')}</span>
            <span className="min-w-0 flex-1"><span className={clsx('block truncate font-semibold', !i.is_active && 'text-slate-400')}>{i.full_name}</span>
              <span className="block truncate text-xs text-slate-500">{[i.specialty, (i.course_names ?? []).join(', ')].filter(Boolean).join(' · ') || '—'}</span></span>
            <ChevronRight className="size-4 text-slate-300" />
          </button>
        ))}
      </div>
      <InstructorFormSheet open={adding} onClose={() => setAdding(false)} courses={courses} onSaved={(i) => { data.reload(); onNav({ kind: 'egitmen', id: i.id }) }} />
    </div>
  )
}

export function InstructorProfile({ id, data, tick, onBack, onOpenLesson, onNav }: {
  id: string; data: StaffData; tick: number; onBack: () => void; onOpenLesson: (id: string) => void; onNav: (s: Screen) => void
}) {
  const ins = data.instructors?.find((x) => x.id === id) ?? null
  const [tab, setTab] = useState<'genel' | 'program' | 'istatistik'>('genel')
  const [month, setMonth] = useState(monthKey())
  const [st, setSt] = useState<InstructorStats | null>(null)
  const [av, setAv] = useState<Availability[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    let alive = true
    staff.instructorStats(id, month).then((x) => { if (alive) { setSt(x); setError(null) } }).catch((e) => alive && setError(errorMessage(e)))
    staff.availability(id).then((a) => alive && setAv(a)).catch(() => undefined)
    return () => { alive = false }
  }, [id, month, tick])
  if (!ins) return <div><Header title="Eğitmen" onBack={onBack} />{data.instructors === null ? <PageLoader /> : <Card><EmptyState title="Eğitmen bulunamadı" /></Card>}</div>
  const today = dateKey()
  const m = st?.month
  const exportMonth = async (k: 'pdf' | 'xlsx' | 'csv') => {
    if (!st || !m) return
    const summary: (string | number)[][] = [['Planlanan ders', m.planned], ['Tamamlanan ders', m.completed], ['Toplam eğitim süresi', hm(m.taught_min)], ['Ertelenen', m.postponed], ['İptal', m.cancelled]]
    const lessons = st.lessons.map((l) => [dmy(l.starts_at), `${timeHM(l.starts_at)}–${timeHM(l.ends_at)}`, l.course_name, l.student_label ?? '—', STATUS_LABEL[l.status]])
    if (k === 'pdf') {
      const { downloadPdf } = await import('@/lib/pdf')
      await downloadPdf(`egitmen-${ins.public_label}-${month.slice(0, 7)}`, `Eğitmen: ${ins.full_name}`, monthLabel(month), [
        { title: 'Aylık özet', headers: ['Ölçüt', 'Değer'], rows: summary, widths: ['*', 120] },
        { title: 'Dersler', headers: ['Tarih', 'Saat', 'Kurs', 'Öğrenci', 'Durum'], rows: lessons },
      ])
    } else await exportTable(k, `egitmen-${ins.public_label}-${month.slice(0, 7)}`, 'Eğitmen raporu', monthLabel(month),
      ['Tarih', 'Saat', 'Kurs', 'Öğrenci', 'Durum'], [...lessons, [], ...summary.map((r) => [String(r[0]), String(r[1]), '', '', ''])])
  }
  const todays = (st?.lessons ?? []).filter((l) => dateKey(l.starts_at) === today)
  return (
    <div>
      <Header title={ins.full_name} onBack={onBack} action={<Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Düzenle</Button>} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'genel', label: 'Genel' }, { value: 'program', label: 'Program' }, { value: 'istatistik', label: 'İstatistikler' }]} />
        {tab !== 'genel' && <MonthNav month={month} onChange={setMonth} />}
      </div>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">İstatistikler alınamadı: {error}</p>}
      {!st ? <PageLoader /> : tab === 'genel' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Bugün" value={hm(st.today.taught_min)} sub={`${st.today.planned} ders planlı`} />
            <Tile label="Bu hafta" value={hm(st.week.taught_min)} sub={`${st.week.completed} tamamlandı`} />
            <Tile label="Bu ay" value={hm(st.this_month.taught_min)} sub={`${st.this_month.completed} tamamlandı`} />
            <Tile label="Toplam" value={hm(st.total.taught_min)} sub={`${st.total.completed} ders`} />
            <Tile label="Tamamlanan" value={st.total.completed} /><Tile label="İptal" value={st.total.cancelled} />
            <Tile label="Ertelenen" value={st.total.postponed} /><Tile label="Öğrenci gelmedi" value={st.total.no_show} />
          </div>
          <Card className="divide-y divide-slate-100 px-4 text-sm">
            <Row k="Telefon" v={ins.phone ? <a href={telHref(ins.phone)} className="flex items-center gap-1 font-semibold text-brand-700"><Phone className="size-3.5" />{ins.phone}</a> : '—'} />
            <Row k="Branş" v={ins.specialty || '—'} />
            <Row k="Verdiği kurslar" v={(ins.course_names ?? []).join(', ') || '—'} />
            <Row k="Çalışma saatleri" v={av.length ? av.map((a) => `${WEEKDAYS[a.weekday - 1].slice(0, 3)} ${a.start_time.slice(0, 5)}–${a.end_time.slice(0, 5)}`).join(', ') : 'Tanımlı değil'} />
            <Row k="Programda görünen ad" v={ins.public_label} />
            <Row k="Durum" v={<Badge tone={ins.is_active ? 'green' : 'slate'}>{ins.is_active ? 'Aktif' : 'Pasif'}</Badge>} />
          </Card>
          <Card className="divide-y divide-slate-100 px-4 text-sm">
            <p className="py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500">Atanmış öğrenciler ({st.students.length})</p>
            {st.students.length === 0 ? <p className="py-3 text-slate-500">Öğrenci atanmadı.</p> : st.students.map((s) => (
              <button key={s.id} onClick={() => onNav({ kind: 'ogrenci', id: s.id })} className={clsx('flex w-full py-2.5 text-left font-medium', !s.is_active && 'text-slate-400')}>{s.name}</button>
            ))}
          </Card>
          {ins.notes && <Card className="p-4 text-sm"><p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Notlar</p><p className="whitespace-pre-wrap">{ins.notes}</p></Card>}
        </div>
      ) : tab === 'program' ? (
        <div className="space-y-3">
          {month === monthKey() && <LessonList title="Bugünün dersleri" lessons={todays} onOpen={onOpenLesson} empty="Bugün ders yok." />}
          {Array.from({ length: 6 }, (_, w) => w).map((w) => {
            const start = addDays(month, w * 7 - ((new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7))
            const ls = st.lessons.filter((l) => { const d = dateKey(l.starts_at); return d >= start && d < addDays(start, 7) })
            if (!ls.length) return null
            return <LessonList key={start} title={`${formatDayShort(start)} – ${formatDayShort(addDays(start, 6))} haftası`} lessons={ls} onOpen={onOpenLesson} empty="" />
          })}
          {st.lessons.length === 0 && <Card><EmptyState icon={<CalendarDays className="size-6" />} title="Bu ay ders yok" /></Card>}
        </div>
      ) : (
        <div className="space-y-3">
          <Card className="p-4">
            <p className="text-sm text-slate-500">Eğitmen: <b className="text-slate-900">{ins.full_name}</b> · {monthLabel(month)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Tile label="Planlanan ders" value={m!.planned} /><Tile label="Tamamlanan ders" value={m!.completed} />
              <Tile label="Toplam eğitim süresi" value={hm(m!.taught_min)} sub={`Planlanan ${hm(m!.scheduled_min)}`} />
              <Tile label="Ertelenen" value={m!.postponed} /><Tile label="İptal" value={m!.cancelled} />
              <Tile label="Öğrenci gelmedi" value={m!.no_show} />
            </div>
            <p className="mt-2 text-xs text-slate-500">Grup derslerinde süre bir kez sayılır. Öğrencinin gelmediği/izinli olduğu ders eğitim süresine eklenmez.</p>
          </Card>
          <Card className="p-4">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><BarChart3 className="size-3.5" />Son 6 ay – verilen eğitim</p>
            <Bars data={st.history.map((h) => ({ label: MONTHS[Number(h.month.slice(5, 7)) - 1].slice(0, 3), value: h.taught_min, text: hm(h.taught_min) }))} />
          </Card>
          <ExportButtons onExport={exportMonth} />
        </div>
      )}
      <InstructorFormSheet open={editing} onClose={() => setEditing(false)} instructor={ins} courses={ins.course_names ?? []} onSaved={() => data.reload()} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Raporlar
export function ReportsScreen({ data, onBack }: { data: StaffData; onBack: () => void }) {
  const today = dateKey()
  const [from, setFrom] = useState(monthKey())
  const [to, setTo] = useState(addDays(shiftMonth(monthKey(), 1), -1))
  const [student, setStudent] = useState('')
  const [instr, setInstr] = useState('')
  const [course, setCourse] = useState('')
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setRows(null)
    staff.report(from, to, { student: student || null, instructor: instr || null, course: course || null })
      .then((r) => { setRows(r); setError(null) }).catch((e) => { setError(errorMessage(e)); setRows([]) })
  }, [from, to, student, instr, course])
  const courses = useMemo(() => [...new Set([...(data.students ?? []).flatMap((s) => s.course_names ?? []), ...(rows ?? []).map((r) => r.course_name)])].sort((a, b) => a.localeCompare(b, 'tr')), [data.students, rows])
  const sum = useMemo(() => {
    const rs = rows ?? []
    const lessons = new Map<string, ReportRow>()
    for (const r of rs) if (!lessons.has(r.lesson_id)) lessons.set(r.lesson_id, r)
    const ls = [...lessons.values()]
    const byStudent = new Map<string, { name: string; planned: number; attended: number; absent: number; min: number }>()
    for (const r of rs) {
      const k = r.student_id ?? `etiket:${r.student_name ?? '—'}`
      const x = byStudent.get(k) ?? { name: r.student_name ?? '—', planned: 0, attended: 0, absent: 0, min: 0 }
      if (r.status === 'planlandi' || r.status === 'tamamlandi') x.planned++
      if (r.attended_min > 0) { x.attended++; x.min += r.attended_min }
      if (r.status === 'tamamlandi' && r.attendance === 'katilmadi') x.absent++
      byStudent.set(k, x)
    }
    const byInstr = new Map<string, { name: string; completed: number; min: number }>()
    for (const l of ls) {
      const k = l.instructor_id ?? `etiket:${l.instructor_name ?? '—'}`
      const x = byInstr.get(k) ?? { name: l.instructor_name ?? '—', completed: 0, min: 0 }
      if (l.status === 'tamamlandi') x.completed++
      x.min += l.taught_min
      byInstr.set(k, x)
    }
    return {
      planned: ls.filter((l) => l.status === 'planlandi' || l.status === 'tamamlandi').length, completed: ls.filter((l) => l.status === 'tamamlandi').length,
      postponed: ls.filter((l) => l.status === 'ertelendi').length, cancelled: ls.filter((l) => l.status === 'iptal').length,
      scheduled: ls.filter((l) => l.status === 'planlandi' || l.status === 'tamamlandi').reduce((a, l) => a + l.scheduled_min, 0),
      taught: ls.reduce((a, l) => a + l.taught_min, 0), attended: rs.reduce((a, r) => a + r.attended_min, 0),
      byStudent: [...byStudent.values()].sort((a, b) => b.min - a.min), byInstr: [...byInstr.values()].sort((a, b) => b.min - a.min),
    }
  }, [rows])
  const filterNote = [student && data.students?.find((s) => s.id === student)?.full_name, instr && data.instructors?.find((i) => i.id === instr)?.full_name, course].filter(Boolean).join(' · ')
  const doExport = async (k: 'pdf' | 'xlsx' | 'csv') => {
    const headers = ['Tarih', 'Saat', 'Kurs', 'Öğrenci', 'Eğitmen', 'Durum', 'Yoklama', 'Planlanan (dk)', 'Verilen eğitim (dk)', 'Öğrenci katılım (dk)']
    const data2 = (rows ?? []).map((r) => [dmy(r.starts_at), `${timeHM(r.starts_at)}–${timeHM(r.ends_at)}`, r.course_name, r.student_name ?? '—', r.instructor_name ?? '—',
      STATUS_LABEL[r.status] ?? r.status, r.attendance ? ATT_LABEL[r.attendance] : '—', r.scheduled_min, r.taught_min, r.attended_min])
    await exportTable(k, `rapor-${from}-${to}`, 'Ders raporu', `${from.split('-').reverse().join('.')} – ${to.split('-').reverse().join('.')}${filterNote ? ` · ${filterNote}` : ''}`, headers, data2)
  }
  return (
    <div>
      <Header title="Raporlar" onBack={onBack} />
      <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
        <Field label="Başlangıç"><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="Bitiş"><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-1">
          {[['Bu ay', monthKey(), addDays(shiftMonth(monthKey(), 1), -1)], ['Geçen ay', shiftMonth(monthKey(), -1), addDays(monthKey(), -1)], ['Son 7 gün', addDays(today, -6), today]].map(([l, a, b]) => (
            <Button key={l} size="sm" variant="secondary" onClick={() => { setFrom(a); setTo(b) }}>{l}</Button>
          ))}
        </div>
        <Field label="Öğrenci"><Select value={student} onChange={(e) => setStudent(e.target.value)}><option value="">Tümü</option>{(data.students ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>
        <Field label="Eğitmen"><Select value={instr} onChange={(e) => setInstr(e.target.value)}><option value="">Tümü</option>{(data.instructors ?? []).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}</Select></Field>
        <Field label="Kurs"><Select value={course} onChange={(e) => setCourse(e.target.value)}><option value="">Tümü</option>{courses.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      </Card>
      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">Rapor alınamadı: {error}</p>}
      {rows === null ? <PageLoader /> : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Planlanan ders" value={sum.planned} sub={`Planlanan süre ${hm(sum.scheduled)}`} /><Tile label="Tamamlanan" value={sum.completed} />
            <Tile label="Ertelenen" value={sum.postponed} /><Tile label="İptal" value={sum.cancelled} />
            <Tile label="Verilen eğitim" value={hm(sum.taught)} sub="Grup dersi bir kez" /><Tile label="Öğrenci katılım süresi" value={hm(sum.attended)} sub="Öğrenci başına toplam" />
          </div>
          <ExportButtons onExport={doExport} />
          <Card className="overflow-x-auto px-4 text-sm">
            <p className="py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500">Öğrenci bazında</p>
            {sum.byStudent.length === 0 ? <p className="pb-3 text-slate-500">Bu aralıkta ders yok.</p> : (
              <table className="w-full min-w-[28rem] text-left"><thead className="text-xs text-slate-500"><tr><th className="py-1.5">Öğrenci</th><th>Planlanan</th><th>Katıldı</th><th>Gelmedi</th><th>Süre</th></tr></thead>
                <tbody>{sum.byStudent.map((x) => <tr key={x.name} className="border-t border-slate-100"><td className="py-2 font-medium">{x.name}</td><td className="tabular-nums">{x.planned}</td><td className="tabular-nums">{x.attended}</td><td className="tabular-nums">{x.absent}</td><td className="tabular-nums">{hm(x.min)}</td></tr>)}</tbody></table>
            )}
          </Card>
          <Card className="overflow-x-auto px-4 text-sm">
            <p className="py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500">Eğitmen bazında</p>
            {sum.byInstr.length === 0 ? <p className="pb-3 text-slate-500">Bu aralıkta ders yok.</p> : (
              <table className="w-full min-w-[22rem] text-left"><thead className="text-xs text-slate-500"><tr><th className="py-1.5">Eğitmen</th><th>Tamamlanan</th><th>Verilen eğitim</th></tr></thead>
                <tbody>{sum.byInstr.map((x) => <tr key={x.name} className="border-t border-slate-100"><td className="py-2 font-medium">{x.name}</td><td className="tabular-nums">{x.completed}</td><td className="tabular-nums">{hm(x.min)}</td></tr>)}</tbody></table>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Yoklama: süresi dolan ve yoklaması alınmamış dersler + son yoklamalar (öğrenci başına)
export function AttendanceScreen({ data, tick, onBack, onOpenLesson }: { data: StaffData; tick: number; onBack: () => void; onOpenLesson: (id: string) => void }) {
  const toast = useToast()
  const today = dateKey()
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [marks, setMarks] = useState<Record<string, Record<string, SharedAttendance>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    staff.report(addDays(today, -30), today).then((r) => { setRows(r); setError(null) }).catch((e) => { setError(errorMessage(e)); setRows([]) })
  }, [today, tick, n])
  const lessons = useMemo(() => {
    const m = new Map<string, ReportRow[]>()
    for (const r of rows ?? []) if (r.status === 'planlandi' && new Date(r.ends_at).getTime() < Date.now() || r.status === 'tamamlandi') m.set(r.lesson_id, [...(m.get(r.lesson_id) ?? []), r])
    return [...m.values()].sort((a, b) => b[0].starts_at.localeCompare(a[0].starts_at))
  }, [rows])
  const pending = lessons.filter((g) => g[0].status === 'planlandi')
  const done = lessons.filter((g) => g[0].status === 'tamamlandi').slice(0, 30)
  const save = async (g: ReportRow[]) => {
    const id = g[0].lesson_id
    const att: Record<string, SharedAttendance> = {}
    for (const r of g) if (r.student_id) att[r.student_id] = marks[id]?.[r.student_id] ?? r.attendance ?? 'katildi'
    setBusy(id)
    try {
      const l = await shared.get(id)
      if (!l) throw new Error('Ders bulunamadı.')
      await staff.complete(l, att)
      toast.success('Yoklama kaydedildi')
      setN((x) => x + 1); data.reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const group = (g: ReportRow[], editable: boolean) => {
    const r0 = g[0]
    const linked = g.every((r) => r.student_id)
    return (
      <Card key={r0.lesson_id} className="p-4">
        <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => onOpenLesson(r0.lesson_id)}>
          <span><b className="block">{r0.course_name}</b><span className="text-xs text-slate-500">{formatDayShort(dateKey(r0.starts_at))} {timeHM(r0.starts_at)}–{timeHM(r0.ends_at)} · {r0.instructor_name ?? '—'}</span></span>
          {r0.status === 'tamamlandi' ? <Badge tone="green">Tamamlandı</Badge> : <Badge tone="amber">Yoklama bekliyor</Badge>}
        </button>
        {!linked ? (
          <p className="mt-2 text-sm text-slate-500">Bu ders kayıtlı öğrenciye bağlı değil ({r0.student_name ?? 'öğrenci yok'}). <button className="font-semibold text-brand-700" onClick={() => onOpenLesson(r0.lesson_id)}>Dersi aç</button></p>
        ) : (
          <div className="mt-3 space-y-2">
            {g.map((r) => {
              const cur = marks[r0.lesson_id]?.[r.student_id!] ?? r.attendance ?? 'katildi'
              return (
                <div key={r.student_id}>
                  <p className="mb-1 text-sm font-semibold">{r.student_name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ATT_ORDER.map((a) => (
                      <button key={a} disabled={!editable && r0.status !== 'tamamlandi'} onClick={() => setMarks((x) => ({ ...x, [r0.lesson_id]: { ...(x[r0.lesson_id] ?? {}), [r.student_id!]: a } }))}
                        aria-pressed={cur === a} className={clsx('min-h-10 rounded-full px-3 text-xs font-semibold', cur === a ? (a === 'katilmadi' ? 'bg-red-600 text-white' : a === 'izinli' ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white') : 'bg-slate-100 text-slate-700')}>
                        {ATT_LABEL[a]}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            {(r0.status === 'planlandi' || marks[r0.lesson_id]) && (
              <Button block loading={busy === r0.lesson_id} icon={<CheckCircle2 className="size-4" />} onClick={() => void save(g)}>{r0.status === 'tamamlandi' ? 'Yoklamayı güncelle' : 'Tamamla ve yoklamayı kaydet'}</Button>
            )}
          </div>
        )}
      </Card>
    )
  }
  return (
    <div>
      <Header title="Yoklama" onBack={onBack} />
      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">Yoklama listesi alınamadı: {error}</p>}
      {rows === null ? <PageLoader /> : (
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700"><Clock className="size-3.5" />Yoklama bekleyen ({pending.length})</p>
          {pending.length === 0 ? <Card><EmptyState icon={<ClipboardCheck className="size-6" />} title="Yoklama bekleyen ders yok" /></Card> : pending.map((g) => group(g, true))}
          <p className="pt-2 text-xs font-bold uppercase tracking-wide text-slate-500">Son 30 gün – alınan yoklamalar</p>
          {done.length === 0 ? <Card><EmptyState title="Kayıt yok" /></Card> : done.map((g) => group(g, true))}
        </div>
      )}
    </div>
  )
}
