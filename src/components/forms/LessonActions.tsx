import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Check, X, Clock3, CalendarClock, Ban, RotateCcw, Trash2, Phone, User } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDbMutation, lessonRpc, updateVersioned, useInstructors, useSettings } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { dateKey, formatDayLong, fromIstanbul, minutesBetween, timeHM } from '@/lib/time'
import { ATTENDANCE_STATUS, LESSON_STATUS, telHref } from '@/lib/format'
import { consumesCredit } from '@/lib/rules'
import type { AttendanceStatus, LessonWithRelations } from '@/types/db'
import { Badge, Button, Field, Input, Select, Sheet, Textarea } from '@/components/ui'

export function AttendanceButtons({ lesson, compact }: { lesson: LessonWithRelations; compact?: boolean }) {
  const { can, instructorId } = useAuth()
  const allowed = can.lessons || (!!instructorId && lesson.instructor_id === instructorId)
  const mark = useDbMutation(
    ({ status }: { status: AttendanceStatus }) => lessonRpc.mark(lesson, status),
    { success: (_r, v) => `Yoklama kaydedildi: ${ATTENDANCE_STATUS[v.status].label}`, invalidate: ['lessons', 'student-lessons', 'students', 'student'] },
  )
  if (!allowed || lesson.status === 'ertelendi') return null
  const current = lesson.attendance?.status
  const opts: { s: AttendanceStatus; icon: typeof Check; cls: string }[] = [
    { s: 'katildi', icon: Check, cls: 'data-[on=true]:bg-emerald-600 data-[on=true]:text-white text-emerald-700 bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-300' },
    { s: 'katilmadi', icon: X, cls: 'data-[on=true]:bg-red-600 data-[on=true]:text-white text-red-700 bg-red-50 dark:bg-red-500/15 dark:text-red-300' },
    { s: 'izinli', icon: Clock3, cls: 'data-[on=true]:bg-amber-500 data-[on=true]:text-white text-amber-800 bg-amber-50 dark:bg-amber-500/15 dark:text-amber-300' },
  ]
  return (
    <div className={clsx('grid grid-cols-3 gap-2', compact && 'gap-1.5')}>
      {opts.map((o) => (
        <button
          key={o.s}
          type="button"
          data-on={current === o.s}
          disabled={mark.isPending || current === o.s}
          onClick={(e) => {
            e.stopPropagation()
            mark.mutate({ status: o.s })
          }}
          className={clsx('flex items-center justify-center gap-1.5 rounded-xl font-semibold transition active:scale-95 disabled:cursor-default', compact ? 'h-9 text-xs' : 'h-12 text-sm', o.cls, mark.isPending && 'opacity-60')}
        >
          <o.icon className="size-4" />
          {ATTENDANCE_STATUS[o.s].label}
        </button>
      ))}
    </div>
  )
}

type Mode = 'view' | 'reschedule' | 'cancel' | 'edit' | 'delete'

export function LessonSheet({ lesson, onClose }: { lesson: LessonWithRelations | null; onClose: () => void }) {
  const { can, instructorId } = useAuth()
  const { data: settings } = useSettings()
  const { data: instructors } = useInstructors()
  const [mode, setMode] = useState<Mode>('view')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState(60)
  const [instr, setInstr] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!lesson) return
    setMode('view')
    setDate(dateKey(lesson.starts_at))
    setTime(timeHM(lesson.starts_at))
    setDuration(minutesBetween(lesson.starts_at, lesson.ends_at))
    setInstr(lesson.instructor_id ?? '')
    setReason('')
  }, [lesson])

  const invalidate = ['lessons', 'student-lessons', 'students', 'student']
  const done = { invalidate, onSuccess: onClose }
  const reschedule = useDbMutation(() => lessonRpc.reschedule(lesson!, fromIstanbul(date, time), reason || null), { success: 'Ders ertelendi ve yeni tarihe taşındı', ...done })
  const cancel = useDbMutation(() => lessonRpc.cancel(lesson!, reason || null), { success: 'Ders iptal edildi', ...done })
  const clear = useDbMutation(() => lessonRpc.clear(lesson!), { success: 'Yoklama geri alındı', invalidate })
  const edit = useDbMutation(
    () => {
      const start = fromIstanbul(date, time)
      return updateVersioned('lessons', lesson!.id, lesson!.version, {
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + duration * 60000).toISOString(),
        instructor_id: instr || null,
      })
    },
    { success: 'Ders güncellendi', ...done },
  )
  const del = useDbMutation(
    async () => {
      const { error } = await supabase.from('lessons').delete().eq('id', lesson!.id)
      if (error) throw error
    },
    { success: 'Ders silindi', ...done },
  )

  if (!lesson) return null
  const st = LESSON_STATUS[lesson.status]
  const att = lesson.attendance ? ATTENDANCE_STATUS[lesson.attendance.status] : null
  const canManage = can.lessons
  const isMine = !!instructorId && lesson.instructor_id === instructorId
  const credit = consumesCredit(lesson.status, lesson.attendance?.status, settings?.absence_consumes_credit ?? true)

  return (
    <Sheet open={!!lesson} onClose={onClose} title={mode === 'view' ? 'Ders detayı' : mode === 'reschedule' ? 'Dersi ertele' : mode === 'cancel' ? 'Dersi iptal et' : mode === 'edit' ? 'Dersi düzenle' : 'Dersi sil'}>
      {mode === 'view' && (
        <div className="space-y-4">
          <div className="rounded-2xl p-4 text-white" style={{ background: `linear-gradient(135deg, ${lesson.instructor?.color ?? '#29a8df'}, #126d99)` }}>
            <p className="text-sm opacity-90">{formatDayLong(dateKey(lesson.starts_at))}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{timeHM(lesson.starts_at)} – {timeHM(lesson.ends_at)}</p>
            <p className="mt-2 text-lg font-semibold">{lesson.student?.full_name ?? 'Öğrenci'}</p>
            <p className="text-sm opacity-90">{lesson.course?.name ?? 'Kurs yok'} · {lesson.instructor?.full_name ?? 'Eğitmen atanmadı'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            {att && <Badge tone={att.tone}>{att.label}</Badge>}
            {credit && <Badge tone="accent">Ders hakkından düştü</Badge>}
            {lesson.student && <Badge tone="slate">Kalan hak: {lesson.student.remaining_lessons}</Badge>}
          </div>
          {lesson.status_reason && <p className="text-sm text-slate-500">Not: {lesson.status_reason}</p>}
          {lesson.notes && <p className="text-sm text-slate-600 dark:text-slate-300">{lesson.notes}</p>}

          {lesson.status !== 'ertelendi' && (
            <div>
              <p className="mb-2 text-sm font-semibold">Yoklama</p>
              <AttendanceButtons lesson={lesson} />
              {lesson.attendance && (canManage || isMine) && (
                <button onClick={() => clear.mutate(undefined)} disabled={clear.isPending} className="mt-2 flex items-center gap-1.5 text-sm font-medium text-slate-500">
                  <RotateCcw className="size-4" /> Yoklamayı geri al
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {lesson.student && (
              <Link to={`/ogrenciler/${lesson.student.id}`} onClick={onClose} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-semibold dark:border-white/10">
                <User className="size-4" /> Öğrenci
              </Link>
            )}
            {lesson.student?.phone && (
              <a href={telHref(lesson.student.phone)} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-semibold dark:border-white/10">
                <Phone className="size-4" /> Ara
              </a>
            )}
          </div>

          {canManage && (
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 dark:border-white/10">
              {lesson.status === 'planlandi' && (
                <>
                  <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setMode('edit')}>Saati değiştir</Button>
                  <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setMode('reschedule')}>Ertele</Button>
                  <Button variant="secondary" icon={<Ban className="size-4" />} onClick={() => setMode('cancel')} className="text-red-600">İptal et</Button>
                </>
              )}
              {can.admin && (
                <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setMode('delete')} className="text-red-600">Sil</Button>
              )}
            </div>
          )}
        </div>
      )}

      {(mode === 'reschedule' || mode === 'edit') && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {mode === 'reschedule'
              ? 'Mevcut ders "Ertelendi" olarak işaretlenir ve seçilen tarihte yeni bir ders oluşturulur.'
              : 'Dersin saati değiştirilir. Tüm cihazlarda yeni saat anında görünür.'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Yeni tarih"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Yeni saat"><Input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          </div>
          {mode === 'edit' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Süre (dk)"><Input type="number" min={10} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></Field>
              <Field label="Eğitmen">
                <Select value={instr} onChange={(e) => setInstr(e.target.value)}>
                  <option value="">Atanmadı</option>
                  {instructors?.filter((i) => i.is_active || i.id === lesson.instructor_id).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                </Select>
              </Field>
            </div>
          )}
          {mode === 'reschedule' && (
            <Field label="Erteleme nedeni"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="İsteğe bağlı" /></Field>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setMode('view')}>Geri</Button>
            {mode === 'reschedule'
              ? <Button block loading={reschedule.isPending} onClick={() => reschedule.mutate(undefined)}>Ertele</Button>
              : <Button block loading={edit.isPending} onClick={() => edit.mutate(undefined)}>Kaydet</Button>}
          </div>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">İptal edilen ders, ders hakkından düşmez. İlgili kişilere bildirim gönderilir.</p>
          <Field label="İptal nedeni"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setMode('view')}>Geri</Button>
            <Button variant="danger" block loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>İptal et</Button>
          </div>
        </div>
      )}

      {mode === 'delete' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">Bu ders ve yoklama kaydı kalıcı olarak silinecek. Bu işlem işlem geçmişine kaydedilir. Normal durumlarda "İptal et" kullanın.</p>
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setMode('view')}>Geri</Button>
            <Button variant="danger" block loading={del.isPending} onClick={() => del.mutate(undefined)}>Kalıcı olarak sil</Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

export function LessonRow({ lesson, onClick, showDate, showAttendance = true }: { lesson: LessonWithRelations; onClick: () => void; showDate?: boolean; showAttendance?: boolean }) {
  const st = LESSON_STATUS[lesson.status]
  const att = lesson.attendance ? ATTENDANCE_STATUS[lesson.attendance.status] : null
  const color = lesson.instructor?.color ?? '#29a8df'
  return (
    <div className="card overflow-hidden">
      <button onClick={onClick} className="flex w-full items-center gap-3 p-3.5 text-left">
        <span className="h-11 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="w-14 shrink-0">
          <span className="block text-base font-bold tabular-nums">{timeHM(lesson.starts_at)}</span>
          <span className="block text-xs text-slate-500 tabular-nums">{showDate ? dateKey(lesson.starts_at).slice(5).split('-').reverse().join('.') : timeHM(lesson.ends_at)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={clsx('block truncate font-semibold', (lesson.status === 'iptal' || lesson.status === 'ertelendi') && 'text-slate-400 line-through')}>
            {lesson.student?.full_name ?? 'Öğrenci'}
          </span>
          <span className="block truncate text-xs text-slate-500">{lesson.course?.name ?? '—'} · {lesson.instructor?.full_name ?? 'Eğitmen yok'}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          {att ? <Badge tone={att.tone}>{att.label}</Badge> : <Badge tone={st.tone}>{st.label}</Badge>}
        </span>
      </button>
      {showAttendance && lesson.status === 'planlandi' && !lesson.attendance && new Date(lesson.starts_at).getTime() - Date.now() < 3 * 3600_000 && (
        <div className="border-t border-slate-100 px-3.5 py-2.5 dark:border-white/10">
          <AttendanceButtons lesson={lesson} compact />
        </div>
      )}
    </div>
  )
}
