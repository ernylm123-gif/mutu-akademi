import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CalendarCheck2, CalendarClock, CheckCircle2, UserPlus, Plus, ClipboardCheck, Wallet, AlertTriangle, Timer,
  ChevronRight, Radio, Hourglass, Upload,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useActivities, useAllSchedules, useInstallments, useLessons, useSettings, useStudents } from '@/lib/api'
import { addDays, dateKey, formatDayLong, fromIstanbul, timeHM, WEEKDAYS } from '@/lib/time'
import { formatMoney } from '@/lib/format'
import type { LessonWithRelations } from '@/types/db'
import { Card, EmptyState, ErrorBox, PageLoader, SectionTitle, Stat } from '@/components/ui'
import { LessonRow, LessonSheet, type LessonMode } from '@/components/forms/LessonActions'
import { StudentFormSheet } from '@/components/forms/StudentForm'
import { LessonFormSheet } from '@/components/forms/LessonForm'
import { ActivityList } from '@/components/ActivityList'
import { Countdown } from '@/components/Countdown'

export function DashboardPage() {
  const { profile, can, instructorId } = useAuth()
  const navigate = useNavigate()
  const today = dateKey()
  const from = fromIstanbul(addDays(today, -7)).toISOString()
  const to = fromIstanbul(addDays(today, 8)).toISOString()
  const lessonsQ = useLessons(from, to, { instructorId: can.instructor ? instructorId : null })
  const studentsQ = useStudents()
  const activitiesQ = useActivities(8)
  const instQ = useInstallments(undefined, can.payments)
  const schedulesQ = useAllSchedules(can.staff)
  const { data: settings } = useSettings()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quickStudent, setQuickStudent] = useState(false)
  const [quickLesson, setQuickLesson] = useState(false)

  const now = Date.now()
  const lessons = lessonsQ.data ?? []
  const todays = useMemo(() => lessons.filter((l) => dateKey(l.starts_at) === today), [lessons, today])
  const active = (l: LessonWithRelations) => l.status === 'planlandi'
  const next = useMemo(
    () => lessons.find((l) => active(l) && !l.started_at && new Date(l.starts_at).getTime() > now) ?? null,
    [lessons, now],
  )
  const running = todays.filter((l) => active(l) && (l.started_at || (new Date(l.starts_at).getTime() <= now && new Date(l.ends_at).getTime() > now)))
  const stats = {
    today: todays.filter((l) => l.status !== 'ertelendi').length,
    soon: todays.filter((l) => active(l) && !l.started_at && new Date(l.starts_at).getTime() > now && new Date(l.starts_at).getTime() - now <= 3600_000).length,
    done: todays.filter((l) => l.status === 'tamamlandi').length,
    pending: todays.filter((l) => active(l)).length,
  }

  // Dikkat gerektirenler
  const threshold = settings?.low_credit_threshold ?? 3
  const lowCredit = (studentsQ.data ?? []).filter((s) => s.is_active && s.total_lessons > 0 && s.remaining_lessons <= threshold)
  const overdue = (instQ.data ?? []).filter((i) => i.status === 'gecikti')
  const missingAttendance = lessons.filter((l) => active(l) && new Date(l.ends_at).getTime() < now)
  const scheduleConflicts = useMemo(() => {
    const list = schedulesQ.data ?? []
    const out: string[] = []
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      if (a.weekday !== b.weekday || !a.instructor_id || a.instructor_id !== b.instructor_id) continue
      const as = toMin(a.start_time), bs = toMin(b.start_time)
      if (as < bs + b.duration_minutes && bs < as + a.duration_minutes) {
        const sa = studentsQ.data?.find((s) => s.id === a.student_id)?.full_name ?? '?'
        const sb = studentsQ.data?.find((s) => s.id === b.student_id)?.full_name ?? '?'
        out.push(`${WEEKDAYS[a.weekday - 1]} ${a.start_time.slice(0, 5)}: ${sa} / ${sb}`)
      }
    }
    return out
  }, [schedulesQ.data, studentsQ.data])

  const selected = lessons.find((l) => l.id === selectedId) ?? null
  const [sheetMode, setSheetMode] = useState<LessonMode>('view')
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  const greet = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar'

  const takeAttendance = () => {
    const target = missingAttendance[0] ?? running[0] ?? todays.find((l) => active(l))
    if (target) setSelectedId(target.id)
    else navigate('/takvim')
  }

  if (lessonsQ.isLoading || studentsQ.isLoading) return <PageLoader />

  const attentionCount = lowCredit.length + overdue.length + missingAttendance.length + scheduleConflicts.length

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{formatDayLong(today)}</p>
          <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{greet}{profile?.full_name ? `, ${profile.full_name.split(/[ ·]/)[0]}` : ''}</h1>
        </div>
      </div>

      {lessonsQ.error && <ErrorBox error={lessonsQ.error} onRetry={() => lessonsQ.refetch()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Bugünkü dersler" value={stats.today} icon={<CalendarCheck2 className="size-5" />} tone="brand" onClick={() => navigate('/takvim')} />
        <Stat label="Başlamak üzere (1 sa)" value={stats.soon} icon={<Timer className="size-5" />} tone="sun" />
        <Stat label="Tamamlanan" value={stats.done} icon={<CheckCircle2 className="size-5" />} tone="green" />
        <Stat label="Bekleyen" value={stats.pending} icon={<Hourglass className="size-5" />} tone="accent" />
      </div>

      {/* Sıradaki ders */}
      {next ? (
        <button onClick={() => navigate(`/ders/${next.id}`)} className="brand-gradient mt-4 flex w-full items-center gap-4 rounded-[1.5rem] p-5 text-left text-white shadow-lg shadow-brand-600/15">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Sıradaki ders · <Countdown to={next.starts_at} /></p>
            <p className="mt-1 truncate text-xl font-bold">{next.student?.full_name}</p>
            <p className="truncate text-sm opacity-90">{next.course?.name ?? 'Ders'} · {next.instructor?.full_name ?? 'Eğitmen yok'}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-extrabold tabular-nums">{timeHM(next.starts_at)}</p>
            <p className="text-xs opacity-80">{dateKey(next.starts_at) === today ? 'bugün' : formatDayLong(dateKey(next.starts_at)).split(',')[0]}</p>
          </div>
          <ChevronRight className="size-5 opacity-70" />
        </button>
      ) : null}

      {/* Hızlı işlemler */}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          { label: 'Yeni öğrenci', icon: UserPlus, show: can.students, onClick: () => setQuickStudent(true) },
          { label: 'Yeni ders', icon: Plus, show: can.lessons, onClick: () => setQuickLesson(true) },
          { label: 'Yoklama', icon: ClipboardCheck, show: can.lessons || can.instructor, onClick: takeAttendance },
          { label: 'Ders ertele', icon: CalendarClock, show: can.lessons, onClick: () => (next ? (setSheetMode('postpone'), setSelectedId(next.id)) : navigate('/dersler')) },
          { label: 'Program yükle', icon: Upload, show: can.lessons, onClick: () => navigate('/program-yukle') },
          { label: 'Ödeme ekle', icon: Wallet, show: can.payments, onClick: () => navigate('/odemeler?yeni=1') },
        ].filter((q) => q.show).map((q) => (
          <button key={q.label} onClick={q.onClick} className="card flex min-h-[84px] flex-col items-center justify-center gap-1.5 p-2 text-center transition active:scale-[.97]">
            <span className="grid size-10 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><q.icon className="size-5" /></span>
            <span className="text-xs font-semibold leading-tight">{q.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-2 grid gap-x-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <SectionTitle action={<Link to="/takvim" className="text-sm font-semibold text-brand-600">Takvim</Link>}>Bugünün programı</SectionTitle>
          {todays.length === 0 ? (
            <Card><EmptyState icon={<CalendarClock className="size-6" />} title="Bugün ders yok" text={can.lessons ? 'Yeni ders için "Ders oluştur"a dokunun.' : undefined} /></Card>
          ) : (
            <div className="space-y-2.5">{todays.map((l) => <LessonRow key={l.id} lesson={l} onClick={() => setSelectedId(l.id)} />)}</div>
          )}

          {attentionCount > 0 && (
            <>
              <SectionTitle>Dikkat gerektirenler</SectionTitle>
              <Card className="divide-y divide-slate-100 dark:divide-white/10">
                {missingAttendance.slice(0, 5).map((l) => (
                  <button key={l.id} onClick={() => setSelectedId(l.id)} className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-3 text-left">
                    <ClipboardCheck className="size-4 shrink-0 text-accent-600" />
                    <span className="flex-1 truncate text-sm font-medium">{l.student?.full_name} – yoklama alınmadı</span>
                    <span className="text-xs text-slate-500">{dateKey(l.starts_at) === today ? timeHM(l.starts_at) : dateKey(l.starts_at).slice(5).split('-').reverse().join('.')}</span>
                  </button>
                ))}
                {lowCredit.slice(0, 5).map((s) => (
                  <button key={s.id} onClick={() => navigate(`/ogrenciler/${s.id}`)} className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-3 text-left">
                    <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                    <span className="flex-1 truncate text-sm font-medium">{s.full_name}</span>
                    <span className="text-xs font-semibold text-amber-600">{s.remaining_lessons} hak kaldı</span>
                  </button>
                ))}
                {overdue.slice(0, 5).map((i) => (
                  <button key={i.id} onClick={() => navigate(`/ogrenciler/${i.student_id}`)} className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-3 text-left">
                    <Wallet className="size-4 shrink-0 text-red-500" />
                    <span className="flex-1 truncate text-sm font-medium">{studentsQ.data?.find((s) => s.id === i.student_id)?.full_name ?? 'Öğrenci'}</span>
                    <span className="text-xs font-semibold text-red-600">{formatMoney(i.amount - i.covered)} gecikmiş</span>
                  </button>
                ))}
                {scheduleConflicts.slice(0, 3).map((c) => (
                  <div key={c} className="flex min-h-[52px] items-center gap-3 px-3.5 py-3">
                    <AlertTriangle className="size-4 shrink-0 text-red-500" />
                    <span className="flex-1 truncate text-sm font-medium">Program çakışması: {c}</span>
                  </div>
                ))}
              </Card>
            </>
          )}
        </div>

        <div>
          <SectionTitle action={<Link to="/aktiviteler" className="text-sm font-semibold text-brand-600">Tümü</Link>}>
            <span className="flex items-center gap-2"><Radio className="size-4 text-emerald-500" /> Canlı aktiviteler</span>
          </SectionTitle>
          <Card><ActivityList items={activitiesQ.data ?? []} compact empty="Diğer cihazlardan yapılan işlemler burada anında görünür." /></Card>
        </div>
      </div>

      <LessonSheet lesson={selected} initialMode={sheetMode} onClose={() => { setSelectedId(null); setSheetMode('view') }} />
      <StudentFormSheet open={quickStudent} onClose={() => setQuickStudent(false)} quick onSaved={(s) => navigate(`/ogrenciler/${s.id}`)} />
      <LessonFormSheet open={quickLesson} onClose={() => setQuickLesson(false)} />
    </div>
  )
}

function toMin(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
