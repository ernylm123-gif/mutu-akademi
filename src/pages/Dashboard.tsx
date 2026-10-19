import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck2, CalendarClock, CheckCircle2, UserPlus, Users, UserX, Plus, Activity, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAuditLogs, useLessons, useNotifications, useStudents, useInstallments, useSettings } from '@/lib/api'
import { addDays, dateKey, formatDayLong, fromIstanbul, relativeTime } from '@/lib/time'
import { formatMoney } from '@/lib/format'
import { Button, Card, EmptyState, ErrorBox, PageLoader, SectionTitle, Stat } from '@/components/ui'
import { LessonRow, LessonSheet } from '@/components/forms/LessonActions'
import { StudentFormSheet } from '@/components/forms/StudentForm'
import { LessonFormSheet } from '@/components/forms/LessonForm'

const TABLE_LABEL: Record<string, string> = {
  students: 'Öğrenci', lessons: 'Ders', attendance: 'Yoklama', payments: 'Ödeme', installments: 'Taksit',
  instructors: 'Eğitmen', courses: 'Kurs', profiles: 'Kullanıcı', weekly_schedules: 'Program', app_settings: 'Ayarlar',
}
const ACTION_LABEL = { insert: 'eklendi', update: 'güncellendi', delete: 'silindi' }

export function DashboardPage() {
  const { profile, can, instructorId, session } = useAuth()
  const navigate = useNavigate()
  const today = dateKey()
  const from = fromIstanbul(today).toISOString()
  const to = fromIstanbul(addDays(today, 8)).toISOString()
  const lessonsQ = useLessons(from, to, { instructorId: can.instructor ? instructorId : null })
  const studentsQ = useStudents()
  const auditQ = useAuditLogs(can.admin, 12)
  const notifQ = useNotifications(session?.user.id)
  const instQ = useInstallments(undefined, can.payments)
  const { data: settings } = useSettings()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quickStudent, setQuickStudent] = useState(false)
  const [quickLesson, setQuickLesson] = useState(false)

  const lessons = lessonsQ.data ?? []
  const todays = useMemo(() => lessons.filter((l) => dateKey(l.starts_at) === today), [lessons, today])
  const upcoming = useMemo(
    () => lessons.filter((l) => dateKey(l.starts_at) > today && l.status === 'planlandi').slice(0, 6),
    [lessons, today],
  )
  const stats = {
    active: studentsQ.data?.filter((s) => s.is_active).length ?? 0,
    pending: todays.filter((l) => l.status === 'planlandi').length,
    done: todays.filter((l) => l.status === 'tamamlandi').length,
    absent: todays.filter((l) => l.attendance?.status === 'katilmadi').length,
  }
  const lowCredit = (studentsQ.data ?? []).filter((s) => s.is_active && s.total_lessons > 0 && s.remaining_lessons <= (settings?.low_credit_threshold ?? 2))
  const overdue = (instQ.data ?? []).filter((i) => i.status === 'gecikti')
  const selected = lessons.find((l) => l.id === selectedId) ?? null
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  const greet = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar'

  if (lessonsQ.isLoading || studentsQ.isLoading) return <PageLoader />

  return (
    <div>
      <div className="brand-gradient relative mb-5 overflow-hidden rounded-[1.75rem] p-5 text-white shadow-lg shadow-brand-600/20">
        <img src="/logo.png" alt="" className="pointer-events-none absolute -right-6 -top-6 size-36 opacity-25" />
        <p className="text-sm opacity-90">{formatDayLong(today)}</p>
        <h1 className="mt-1 text-2xl font-extrabold">{greet}, {profile?.full_name?.split(' ')[0] || 'hoş geldiniz'}</h1>
        <p className="mt-1 text-sm opacity-90">Bugün {todays.length} ders var · {stats.pending} bekliyor</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {can.students && (
            <Button size="sm" className="bg-white/95 text-brand-700 hover:bg-white" icon={<UserPlus className="size-4" />} onClick={() => setQuickStudent(true)}>Hızlı öğrenci</Button>
          )}
          {can.lessons && (
            <Button size="sm" className="bg-white/20 text-white ring-1 ring-white/40 hover:bg-white/30" icon={<Plus className="size-4" />} onClick={() => setQuickLesson(true)}>Hızlı ders</Button>
          )}
        </div>
      </div>

      {lessonsQ.error && <ErrorBox error={lessonsQ.error} onRetry={() => lessonsQ.refetch()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Aktif öğrenci" value={stats.active} icon={<Users className="size-5" />} tone="brand" onClick={() => navigate('/ogrenciler')} />
        <Stat label="Bekleyen ders (bugün)" value={stats.pending} icon={<CalendarClock className="size-5" />} tone="sun" onClick={() => navigate('/takvim')} />
        <Stat label="Tamamlanan (bugün)" value={stats.done} icon={<CheckCircle2 className="size-5" />} tone="green" />
        <Stat label="Gelmeyen (bugün)" value={stats.absent} icon={<UserX className="size-5" />} tone="accent" />
      </div>

      <div className="mt-2 grid gap-x-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <SectionTitle action={<Button size="sm" variant="ghost" onClick={() => navigate('/takvim')}>Takvim</Button>}>Bugünkü dersler</SectionTitle>
          {todays.length === 0 ? (
            <Card><EmptyState icon={<CalendarCheck2 className="size-6" />} title="Bugün ders yok" text="Yeni ders oluşturmak için Hızlı ders butonunu kullanın." /></Card>
          ) : (
            <div className="space-y-2.5">{todays.map((l) => <LessonRow key={l.id} lesson={l} onClick={() => setSelectedId(l.id)} />)}</div>
          )}

          <SectionTitle>Yaklaşan dersler</SectionTitle>
          {upcoming.length === 0 ? (
            <Card className="p-4 text-sm text-slate-500">Önümüzdeki 7 günde planlı ders yok.</Card>
          ) : (
            <div className="space-y-2.5">{upcoming.map((l) => <LessonRow key={l.id} lesson={l} showDate showAttendance={false} onClick={() => setSelectedId(l.id)} />)}</div>
          )}
        </div>

        <div>
          {(lowCredit.length > 0 || overdue.length > 0) && (
            <>
              <SectionTitle>Dikkat gerektirenler</SectionTitle>
              <Card className="divide-y divide-slate-100 dark:divide-white/10">
                {lowCredit.slice(0, 5).map((s) => (
                  <button key={s.id} onClick={() => navigate(`/ogrenciler/${s.id}`)} className="flex w-full items-center gap-3 p-3.5 text-left">
                    <AlertTriangle className="size-4 text-amber-500" />
                    <span className="flex-1 truncate text-sm font-medium">{s.full_name}</span>
                    <span className="text-xs font-semibold text-amber-600">{s.remaining_lessons} hak kaldı</span>
                  </button>
                ))}
                {overdue.slice(0, 5).map((i) => (
                  <button key={i.id} onClick={() => navigate(`/ogrenciler/${i.student_id}`)} className="flex w-full items-center gap-3 p-3.5 text-left">
                    <AlertTriangle className="size-4 text-red-500" />
                    <span className="flex-1 truncate text-sm font-medium">{studentsQ.data?.find((s) => s.id === i.student_id)?.full_name ?? 'Öğrenci'}</span>
                    <span className="text-xs font-semibold text-red-600">{formatMoney(i.amount - i.covered)} gecikmiş</span>
                  </button>
                ))}
              </Card>
            </>
          )}

          <SectionTitle>Son işlemler</SectionTitle>
          <Card className="divide-y divide-slate-100 dark:divide-white/10">
            {can.admin
              ? (auditQ.data ?? []).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 p-3.5">
                    <Activity className="size-4 shrink-0 text-brand-500" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <b>{TABLE_LABEL[a.table_name] ?? a.table_name}</b> {ACTION_LABEL[a.action]}
                      {(() => {
                        const d = (a.new_data ?? a.old_data) as Record<string, unknown> | null
                        const n = d?.full_name ?? d?.name
                        return n ? ` – ${String(n)}` : ''
                      })()}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{relativeTime(a.created_at)}</span>
                  </div>
                ))
              : (notifQ.data ?? []).slice(0, 8).map((n) => (
                  <div key={n.id} className="flex items-center gap-3 p-3.5">
                    <Activity className="size-4 shrink-0 text-brand-500" />
                    <span className="min-w-0 flex-1 truncate text-sm"><b>{n.title}</b> {n.body}</span>
                    <span className="shrink-0 text-xs text-slate-400">{relativeTime(n.created_at)}</span>
                  </div>
                ))}
            {((can.admin ? auditQ.data : notifQ.data) ?? []).length === 0 && <p className="p-4 text-sm text-slate-500">Henüz işlem yok.</p>}
          </Card>
        </div>
      </div>

      <LessonSheet lesson={selected} onClose={() => setSelectedId(null)} />
      <StudentFormSheet open={quickStudent} onClose={() => setQuickStudent(false)} quick onSaved={(s) => navigate(`/ogrenciler/${s.id}`)} />
      <LessonFormSheet open={quickLesson} onClose={() => setQuickLesson(false)} />
    </div>
  )
}
