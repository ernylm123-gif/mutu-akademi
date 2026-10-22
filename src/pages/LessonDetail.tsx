import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Play, Check, UserX, CalendarClock, Ban, Clock4, Phone, MessageCircle, User, GraduationCap, BookOpen, RotateCcw, Save } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useLesson, useActivities, useDbMutation, lessonRpc, updateVersioned, useSettings } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { dateKey, formatDayLong, minutesBetween, timeHM } from '@/lib/time'
import { ATTENDANCE_STATUS, LESSON_STATUS, LESSON_TYPE, telHref, waHref } from '@/lib/format'
import { consumesCredit } from '@/lib/rules'
import type { AttendanceStatus } from '@/types/db'
import { Badge, Button, Card, EmptyState, PageLoader, SectionTitle, Textarea } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { LessonSheet, type LessonMode } from '@/components/forms/LessonActions'
import { ActivityList } from '@/components/ActivityList'
import { Countdown } from '@/components/Countdown'

export function LessonDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can, instructorId } = useAuth()
  const { data: l, isLoading } = useLesson(id)
  const { data: history } = useActivities(30, id)
  const { data: settings } = useSettings()
  // Ertelenmiş dersin yeni tarihli kaydı (eski ve yeni tarih birlikte görünür)
  const { data: movedTo } = useQuery({
    queryKey: ['lesson', 'moved', id, l?.status],
    enabled: !!id && l?.status === 'ertelendi',
    queryFn: async () => {
      const { data, error } = await supabase.from('lessons').select('id, starts_at').eq('rescheduled_from', id!).order('id').limit(1).maybeSingle()
      if (error) throw error
      return data as { id: string; starts_at: string } | null
    },
  })
  const [mode, setMode] = useState<LessonMode | null>(null)
  const [notes, setNotes] = useState('')
  useEffect(() => setNotes(l?.notes ?? ''), [l?.id, l?.notes])

  const inv = ['lessons', 'lesson', 'student-lessons', 'students', 'student', 'activities']
  const start = useDbMutation(() => lessonRpc.start(l!), { success: 'Ders başladı', invalidate: inv })
  const mark = useDbMutation((s: AttendanceStatus) => lessonRpc.mark(l!, s), {
    success: (_r, s) => (s === 'katildi' ? 'Ders tamamlandı' : s === 'katilmadi' ? 'Öğrenci gelmedi olarak işaretlendi' : 'İzinli olarak işaretlendi'),
    invalidate: inv,
  })
  const clear = useDbMutation(() => lessonRpc.clear(l!), { success: 'Yoklama geri alındı', invalidate: inv })
  const saveNotes = useDbMutation(() => updateVersioned('lessons', l!.id, l!.version, { notes: notes.trim() || null }), { success: 'Not kaydedildi', invalidate: inv })

  if (isLoading) return <PageLoader />
  if (!l) return <EmptyState title="Ders bulunamadı" text="Ders silinmiş veya bu cihazın erişim yetkisi yok." action={<Button onClick={() => navigate('/takvim')}>Takvime git</Button>} />

  const canAct = can.lessons || (!!instructorId && l.instructor_id === instructorId)
  const st = LESSON_STATUS[l.status]
  const att = l.attendance ? ATTENDANCE_STATUS[l.attendance.status] : null
  const planned = l.status === 'planlandi'
  const running = planned && !!l.started_at
  const upcoming = planned && new Date(l.starts_at).getTime() > Date.now()
  const busy = start.isPending || mark.isPending || clear.isPending
  const credit = consumesCredit(l.status, l.attendance?.status, settings?.absence_consumes_credit ?? true)
  const color = l.instructor?.color ?? '#29a8df'

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back title={l.student?.full_name ?? 'Ders'} subtitle={formatDayLong(dateKey(l.starts_at))} />

      <Card className="overflow-hidden">
        <div className="flex items-stretch">
          <span className="w-1.5" style={{ background: color }} />
          <div className="flex-1 p-5">
            <div className="flex flex-wrap items-center gap-2">
              {running ? <Badge tone="accent">Devam ediyor</Badge> : <Badge tone={st.tone}>{st.label}</Badge>}
              {att && <Badge tone={att.tone}>{att.label}</Badge>}
              {credit && <Badge tone="slate">Ders hakkından düştü</Badge>}
            </div>
            <p className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight">{timeHM(l.starts_at)}–{timeHM(l.ends_at)}</p>
            <p className="text-sm text-slate-500">{minutesBetween(l.starts_at, l.ends_at)} dakika{upcoming && <> · <Countdown to={l.starts_at} /></>}</p>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              <Link to={l.student ? `/ogrenciler/${l.student.id}` : '#'} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5"><User className="size-4 text-slate-400" /><span className="truncate font-medium">{l.student?.full_name ?? '—'}</span></Link>
              <span className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5"><GraduationCap className="size-4 text-slate-400" /><span className="truncate">{l.instructor?.full_name ?? 'Eğitmen yok'}</span></span>
              <span className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5"><BookOpen className="size-4 text-slate-400" /><span className="truncate">{l.course?.name ?? 'Kurs yok'}</span></span>
            </div>
            {(l.title || l.room || l.lesson_type !== 'bireysel') && (
              <p className="mt-3 text-sm text-slate-600">{[l.title, LESSON_TYPE[l.lesson_type], l.room?.name].filter(Boolean).join(' · ')}</p>
            )}
            {l.student && can.lessons && !l.group_id && <p className="mt-3 text-sm text-slate-500">Kalan ders hakkı: <b className="text-slate-900">{l.student.remaining_lessons}</b></p>}
            {l.group_id && <p className="mt-3 text-sm text-slate-500">Grup dersi – öğrenciler ve yoklamalar için "Tamamla / yoklama".</p>}
            {l.status_reason && <p className="mt-1 text-sm text-slate-500">{l.status === 'ertelendi' ? 'Erteleme nedeni' : l.status === 'iptal' ? 'İptal nedeni' : 'Not'}: {l.status_reason}</p>}
            {l.rescheduled_from && <p className="mt-1 text-sm"><Link className="font-semibold text-brand-600" to={`/ders/${l.rescheduled_from}`}>← Ertelenen eski ders kaydı</Link></p>}
            {movedTo && <p className="mt-1 text-sm"><Link className="font-semibold text-brand-600" to={`/ders/${movedTo.id}`}>Yeni tarih: {formatDayLong(dateKey(movedTo.starts_at))} {timeHM(movedTo.starts_at)} →</Link></p>}
            {l.instructor_note && <p className="mt-1 text-sm text-slate-600"><b>Eğitmen notu:</b> {l.instructor_note}</p>}
            {l.student?.phone && can.staff && (
              <div className="mt-4 flex gap-2">
                <a href={telHref(l.student.phone)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-50 text-sm font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"><Phone className="size-4" /> Ara</a>
                <a href={waHref(l.student.phone)} target="_blank" rel="noopener noreferrer" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-50 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><MessageCircle className="size-4" /> WhatsApp</a>
              </div>
            )}
          </div>
        </div>
      </Card>

      {canAct && (
        <>
          <SectionTitle>Hızlı işlemler</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {planned && !running && <Button size="lg" icon={<Play className="size-5" />} loading={start.isPending} disabled={busy} onClick={() => start.mutate(undefined)}>Dersi başlat</Button>}
            {(planned || l.status === 'tamamlandi') && (
              <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700" icon={<Check className="size-5" />} disabled={busy || new Date(l.starts_at).getTime() > Date.now() + 3600_000}
                onClick={() => setMode('complete')}>{l.status === 'tamamlandi' ? 'Yoklamayı düzenle' : 'Tamamla / yoklama'}</Button>
            )}
            {!l.group_id && planned && l.attendance?.status !== 'katilmadi' && new Date(l.starts_at).getTime() <= Date.now() + 3600_000 && (
              <Button size="lg" variant="danger" icon={<UserX className="size-5" />} disabled={busy} onClick={() => mark.mutate('katilmadi')}>Öğrenci gelmedi</Button>
            )}
            {can.lessons && planned && (
              <>
                <Button size="lg" variant="secondary" icon={<CalendarClock className="size-5" />} onClick={() => setMode('postpone')}>Ertele</Button>
                <Button size="lg" variant="secondary" icon={<Clock4 className="size-5" />} onClick={() => setMode('edit')}>Saati değiştir</Button>
                <Button size="lg" variant="secondary" className="text-red-600" icon={<Ban className="size-5" />} onClick={() => setMode('cancel')}>İptal</Button>
              </>
            )}
            {can.lessons && l.status === 'iptal' && <Button size="lg" variant="secondary" icon={<RotateCcw className="size-5" />} onClick={() => setMode('view')}>İptali geri al…</Button>}
            {!l.group_id && l.attendance && <Button size="lg" variant="ghost" icon={<RotateCcw className="size-5" />} disabled={busy} onClick={() => clear.mutate(undefined)}>Yoklamayı geri al</Button>}
          </div>
        </>
      )}

      <SectionTitle>Ders notları</SectionTitle>
      <Card className="p-3">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bu ders hakkında not…" disabled={!can.lessons} />
        {can.lessons && notes !== (l.notes ?? '') && (
          <div className="mt-2 flex justify-end"><Button size="sm" icon={<Save className="size-4" />} loading={saveNotes.isPending} onClick={() => saveNotes.mutate(undefined)}>Notu kaydet</Button></div>
        )}
      </Card>

      <SectionTitle>İşlem geçmişi</SectionTitle>
      <Card><ActivityList items={history ?? []} compact empty="Bu ders için kayıtlı işlem yok." /></Card>

      <LessonSheet lesson={mode ? l : null} initialMode={mode ?? 'view'} onClose={() => setMode(null)} />
    </div>
  )
}
