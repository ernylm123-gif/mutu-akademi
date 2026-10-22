import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Check, X, Clock3, CalendarClock, Ban, RotateCcw, Trash2, Phone, User, Undo2, CheckCheck, Pencil, Users, DoorOpen, Timer, LogOut } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDbMutation, lessonRpc, planRpc, newRequestId, useInstructors, useRooms, useSettings, useLessonGroup, LESSON_INVALIDATE, type Scope } from '@/lib/api'
import { dateKey, formatDayLong, formatDayShort, fromIstanbul, timeHM } from '@/lib/time'
import { ATTENDANCE_ORDER, ATTENDANCE_STATUS, displayStatus, LESSON_TYPE, POSTPONE_REASON, telHref } from '@/lib/format'
import { consumesCredit } from '@/lib/rules'
import { memberLabel, type LessonItem } from '@/lib/lessons'
import type { AttendanceStatus, LessonWithRelations, PostponeReason, ScopeItem } from '@/types/db'
import { Badge, Button, Field, Input, Segmented, Select, Sheet, Textarea } from '@/components/ui'

const ATT_ICON: Record<AttendanceStatus, typeof Check> = { katildi: Check, katilmadi: X, izinli: Clock3, gec_geldi: Timer, erken_ayrildi: LogOut }
const ATT_CLS: Record<AttendanceStatus, string> = {
  katildi: 'data-[on=true]:bg-emerald-600 data-[on=true]:text-white text-emerald-700 bg-emerald-50',
  katilmadi: 'data-[on=true]:bg-red-600 data-[on=true]:text-white text-red-700 bg-red-50',
  izinli: 'data-[on=true]:bg-amber-500 data-[on=true]:text-white text-amber-800 bg-amber-50',
  gec_geldi: 'data-[on=true]:bg-brand-600 data-[on=true]:text-white text-brand-700 bg-brand-50',
  erken_ayrildi: 'data-[on=true]:bg-accent-600 data-[on=true]:text-white text-accent-700 bg-accent-50',
}

/** Tek öğrencinin yoklaması (grup dersinde her öğrenci için ayrı) */
export function AttendanceButtons({ lesson, compact }: { lesson: LessonWithRelations; compact?: boolean }) {
  const { can, instructorId } = useAuth()
  const allowed = can.lessons || (!!instructorId && lesson.instructor_id === instructorId)
  const mark = useDbMutation(
    ({ status }: { status: AttendanceStatus }) => lessonRpc.mark(lesson, status),
    { success: (_r, v) => `Yoklama kaydedildi: ${ATTENDANCE_STATUS[v.status].label}`, invalidate: LESSON_INVALIDATE },
  )
  if (!allowed || lesson.status === 'ertelendi' || lesson.status === 'iptal') return null
  const current = lesson.attendance?.status
  const opts = compact ? ATTENDANCE_ORDER.slice(0, 3) : ATTENDANCE_ORDER
  return (
    <div className={clsx('grid gap-1.5', compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-5')}>
      {opts.map((s) => {
        const Icon = ATT_ICON[s]
        return (
          <button key={s} type="button" data-on={current === s} disabled={mark.isPending || current === s}
            onClick={(e) => { e.stopPropagation(); mark.mutate({ status: s }) }}
            className={clsx('flex items-center justify-center gap-1 rounded-xl font-semibold transition active:scale-95 disabled:cursor-default', compact ? 'h-9 text-xs' : 'h-11 text-[13px]', ATT_CLS[s], mark.isPending && 'opacity-60')}>
            <Icon className="size-4" />{ATTENDANCE_STATUS[s].label}
          </button>
        )
      })}
    </div>
  )
}

export type LessonMode = 'view' | 'postpone' | 'cancel' | 'edit' | 'delete' | 'complete'
type Mode = LessonMode

function ScopePicker({ lesson, scope, onChange, verb }: { lesson: LessonWithRelations; scope: Scope; onChange: (s: Scope) => void; verb: string }) {
  const [items, setItems] = useState<ScopeItem[] | null>(null)
  useEffect(() => {
    let alive = true
    setItems(null)
    planRpc.scope(lesson.id, scope).then((r) => alive && setItems(r)).catch(() => alive && setItems([]))
    return () => { alive = false }
  }, [lesson.id, scope])
  const sessions = items ? new Set(items.map((i) => i.starts_at)).size : 0
  return (
    <div className="space-y-2">
      {lesson.series_id && (
        <Segmented value={scope} onChange={onChange} options={[
          { value: 'this', label: 'Yalnızca bu ders' }, { value: 'following', label: 'Bu ve sonrakiler' }, { value: 'all', label: 'Tüm seri' },
        ]} />
      )}
      <div className="rounded-xl bg-slate-50 p-3 text-sm">
        {!items ? <p className="text-slate-500">Etkilenecek dersler hesaplanıyor…</p> : (
          <>
            <p className="font-semibold">{sessions} ders {verb}{items.length > sessions ? ` (${items.length} öğrenci kaydı)` : ''}.</p>
            <p className="mt-0.5 text-xs text-slate-500">Tamamlanmış, ertelenmiş ve iptal edilmiş geçmiş dersler etkilenmez.</p>
            <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-slate-600">
              {[...new Map(items.map((i) => [i.starts_at, i])).values()].slice(0, 30).map((i) => (
                <li key={i.id}>{formatDayShort(dateKey(i.starts_at))} {timeHM(i.starts_at)}–{timeHM(i.ends_at)}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

export function LessonSheet({ lesson, onClose, initialMode = 'view' }: { lesson: LessonWithRelations | null; onClose: () => void; initialMode?: LessonMode }) {
  const { can, instructorId } = useAuth()
  const { data: settings } = useSettings()
  const { data: instructors } = useInstructors()
  const { data: rooms } = useRooms()
  const groupQ = useLessonGroup(lesson?.group_id)
  const members = useMemo(() => (lesson?.group_id ? groupQ.data ?? [lesson] : lesson ? [lesson] : []), [lesson, groupQ.data])
  const [mode, setMode] = useState<Mode>('view')
  const [date, setDate] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [instr, setInstr] = useState('')
  const [room, setRoom] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [reason, setReason] = useState<PostponeReason>('ogrenci')
  const [text, setText] = useState('')
  const [scope, setScope] = useState<Scope>('this')
  const [att, setAtt] = useState<Record<string, AttendanceStatus>>({})
  const [confirmed, setConfirmed] = useState(false)
  const requestId = useRef(newRequestId())

  useEffect(() => {
    if (!lesson) return
    setMode(initialMode)
    setDate(dateKey(lesson.starts_at))
    setStart(timeHM(lesson.starts_at))
    setEnd(timeHM(lesson.ends_at))
    setInstr(lesson.instructor_id ?? '')
    setRoom(lesson.room_id ?? '')
    setTitle(lesson.title ?? '')
    setNotes(lesson.notes ?? '')
    setAdminNote(lesson.admin_note ?? '')
    setReason('ogrenci')
    setText('')
    setScope('this')
    setConfirmed(false)
    requestId.current = newRequestId()
  }, [lesson?.id, initialMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'complete') return
    setAtt(Object.fromEntries(members.map((m) => [m.id, m.attendance?.status ?? 'katildi'])))
    setText(lesson?.instructor_note ?? '')
  }, [mode, members]) // eslint-disable-line react-hooks/exhaustive-deps

  const done = { invalidate: LESSON_INVALIDATE, onSuccess: onClose }
  const postpone = useDbMutation(
    () => planRpc.postpone(lesson!, fromIstanbul(date, start), fromIstanbul(date, end), reason, text.trim() || null, requestId.current),
    { success: 'Ders ertelendi; yeni tarih takvime eklendi', ...done },
  )
  const cancel = useDbMutation(() => lessonRpc.cancel(lesson!, text.trim() || null), { success: 'Ders iptal edildi', ...done })
  const restore = useDbMutation(() => planRpc.restore(lesson!), { success: 'İptal geri alındı; ders yeniden planlandı', ...done })
  const clear = useDbMutation(() => lessonRpc.clear(lesson!), { success: 'Yoklama geri alındı', invalidate: LESSON_INVALIDATE })
  const edit = useDbMutation(
    () => planRpc.update(lesson!, {
      ...(scope === 'this' ? { date } : {}), start, end, instructor_id: instr || null,
      room_id: lesson!.lesson_type === 'online' ? null : room || null, title, notes, ...(can.lessons ? { admin_note: adminNote } : {}),
    }, scope),
    { success: (r) => (r.updated > 1 ? `${r.updated} ders kaydı güncellendi` : 'Ders güncellendi'), ...done },
  )
  const del = useDbMutation(() => planRpc.remove(lesson!, scope), { success: (r) => `${r.deleted} ders kaydı programdan kaldırıldı`, ...done })
  const complete = useDbMutation(
    () => planRpc.complete(lesson!, members.map((m) => ({ lesson_id: m.id, status: att[m.id] ?? 'katildi' })), text.trim() || null),
    { success: 'Ders tamamlandı; yoklama ve ders hakları işlendi', ...done },
  )

  if (!lesson) return null
  const st = displayStatus(lesson)
  const canManage = can.lessons
  const isMine = !!instructorId && lesson.instructor_id === instructorId
  const isGroup = members.length > 1
  const credit = consumesCredit(lesson.status, lesson.attendance?.status, settings?.absence_consumes_credit ?? true)
  const notStarted = new Date(lesson.starts_at).getTime() > Date.now() + 3600_000
  const titles: Record<Mode, string> = { view: 'Ders detayı', postpone: 'Dersi ertele', cancel: 'Dersi iptal et', edit: 'Ders saatini / bilgilerini değiştir', delete: 'Dersi programdan kaldır', complete: 'Dersi tamamla' }
  const invalidTime = !/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end) || end <= start
  const back = <Button variant="secondary" block onClick={() => setMode('view')}>Geri</Button>

  return (
    <Sheet open={!!lesson} onClose={onClose} title={titles[mode]} dirty={mode !== 'view' && mode !== 'delete' && !confirmed}>
      {mode === 'view' && (
        <div className="space-y-4">
          <div className="rounded-2xl p-4 text-white" style={{ background: `linear-gradient(135deg, ${lesson.instructor?.color ?? '#2563eb'}, #1e3a8a)` }}>
            <p className="text-sm opacity-90">{formatDayLong(dateKey(lesson.starts_at))}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{timeHM(lesson.starts_at)} – {timeHM(lesson.ends_at)}</p>
            <p className="mt-2 text-lg font-semibold">{lesson.title || lesson.course?.name || 'Ders'}</p>
            <p className="text-sm opacity-90">{isGroup ? `${members.length} öğrenci` : lesson.student?.full_name ?? 'Öğrenci'} · {lesson.instructor?.full_name ?? 'Eğitmen atanmadı'}</p>
            <p className="mt-1 flex flex-wrap gap-x-3 text-xs opacity-90">
              <span>{LESSON_TYPE[lesson.lesson_type]}</span>
              {lesson.room && <span className="inline-flex items-center gap-1"><DoorOpen className="size-3.5" />{lesson.room.name}</span>}
              {lesson.course && lesson.title && <span>{lesson.course.name}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            {!isGroup && lesson.attendance && <Badge tone={ATTENDANCE_STATUS[lesson.attendance.status].tone}>{ATTENDANCE_STATUS[lesson.attendance.status].label}</Badge>}
            {!isGroup && credit && <Badge tone="accent">Ders hakkından düştü</Badge>}
            {!isGroup && lesson.student && canManage && <Badge tone="slate">Kalan hak: {lesson.student.remaining_lessons}</Badge>}
            {lesson.series_id && <Badge tone="brand">Tekrarlayan seri</Badge>}
          </div>
          {lesson.status_reason && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{lesson.status === 'ertelendi' ? 'Erteleme' : lesson.status === 'iptal' ? 'İptal' : 'Not'}: {lesson.status_reason}</p>}
          {lesson.rescheduled_from && <p className="text-xs text-slate-500">Bu ders ertelenen bir dersin yeni tarihidir.</p>}
          {lesson.notes && <p className="text-sm text-slate-600">{lesson.notes}</p>}
          {lesson.instructor_note && <p className="text-sm text-slate-600"><b>Eğitmen notu:</b> {lesson.instructor_note}</p>}
          {canManage && lesson.admin_note && <p className="text-sm text-slate-600"><b>Yönetici açıklaması:</b> {lesson.admin_note}</p>}

          {lesson.status !== 'ertelendi' && lesson.status !== 'iptal' && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">{isGroup && <Users className="size-4" />}Yoklama{isGroup ? ' (her öğrenci için ayrı)' : ''}</p>
              <div className="space-y-3">
                {members.map((m) => (
                  <div key={m.id}>
                    {isGroup && (
                      <p className="mb-1 flex items-center justify-between text-sm">
                        <Link to={`/ogrenciler/${m.student_id}`} onClick={onClose} className="font-medium">{m.student?.full_name}</Link>
                        {canManage && <span className="text-xs text-slate-500">{m.student?.remaining_lessons} hak</span>}
                      </p>
                    )}
                    <AttendanceButtons lesson={m} />
                  </div>
                ))}
              </div>
              {!isGroup && lesson.attendance && (canManage || isMine) && (
                <button onClick={() => clear.mutate(undefined)} disabled={clear.isPending} className="mt-2 flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500">
                  <RotateCcw className="size-4" /> Yoklamayı geri al
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Link to={`/ders/${lesson.id}`} onClick={onClose} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-semibold">
              <CalendarClock className="size-4" /> Ders sayfası
            </Link>
            {!isGroup && lesson.student && (
              <Link to={`/ogrenciler/${lesson.student.id}`} onClick={onClose} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-semibold">
                <User className="size-4" /> Öğrenci
              </Link>
            )}
            {!isGroup && lesson.student?.phone && (
              <a href={telHref(lesson.student.phone)} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-semibold">
                <Phone className="size-4" /> Ara
              </a>
            )}
          </div>

          {(canManage || isMine) && (
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
              {(lesson.status === 'planlandi' || lesson.status === 'tamamlandi') && (
                <Button icon={<CheckCheck className="size-4" />} disabled={notStarted} onClick={() => setMode('complete')}
                  title={notStarted ? 'Ders başlamadan tamamlanamaz' : undefined}>
                  {lesson.status === 'tamamlandi' ? 'Yoklamayı düzenle' : 'Tamamla'}
                </Button>
              )}
              {canManage && lesson.status === 'planlandi' && (
                <>
                  <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setMode('edit')}>Saati değiştir</Button>
                  <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setMode('postpone')}>Ertele</Button>
                  <Button variant="secondary" icon={<Ban className="size-4" />} onClick={() => setMode('cancel')} className="text-red-600">İptal et</Button>
                  <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setMode('delete')} className="text-red-600">Programdan kaldır</Button>
                </>
              )}
              {canManage && lesson.status === 'iptal' && (
                <Button variant="secondary" icon={<Undo2 className="size-4" />} loading={restore.isPending} onClick={() => restore.mutate(undefined)}>İptali geri al</Button>
              )}
            </div>
          )}
          {notStarted && lesson.status === 'planlandi' && (canManage || isMine) && <p className="text-xs text-slate-400">Ders, başlamasına 1 saatten az kalınca tamamlanabilir.</p>}
        </div>
      )}

      {mode === 'complete' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Dersin gerçekleştiğini onaylayın ve {isGroup ? 'her öğrencinin' : 'öğrencinin'} katılımını seçin. Ders hakkı kurallara göre otomatik hesaplanır; aynı ders iki kez hak düşürmez.</p>
          {members.map((m) => (
            <div key={m.id}>
              <p className="mb-1.5 text-sm font-semibold">{m.student?.full_name}</p>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {ATTENDANCE_ORDER.map((s) => {
                  const Icon = ATT_ICON[s]
                  return (
                    <button key={s} type="button" data-on={att[m.id] === s} onClick={() => setAtt((a) => ({ ...a, [m.id]: s }))}
                      className={clsx('flex h-11 items-center justify-center gap-1 rounded-xl text-[13px] font-semibold', ATT_CLS[s])}>
                      <Icon className="size-4" />{ATTENDANCE_STATUS[s].label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <Field label="Eğitmen ders notu"><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="İşlenen konu, ödev vb." /></Field>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5 accent-brand-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Ders {formatDayShort(dateKey(lesson.starts_at))} {timeHM(lesson.starts_at)}'da gerçekleşti.</label>
          <div className="flex gap-2">{back}<Button block disabled={!confirmed} loading={complete.isPending} onClick={() => complete.mutate(undefined)}>Tamamla</Button></div>
        </div>
      )}

      {mode === 'postpone' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Mevcut ders "Ertelendi" olarak geçmişte kalır, ders hakkı düşmez. Yeni tarihte ders oluşturulur, eski hatırlatma iptal edilir ve yeni saate göre hatırlatma planlanır.</p>
          <Field label="Yeni tarih"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Yeni başlangıç"><Input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Yeni bitiş"><Input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <Field label="Erteleme nedeni">
            <Select value={reason} onChange={(e) => setReason(e.target.value as PostponeReason)}>
              {Object.entries(POSTPONE_REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Açıklama"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="İsteğe bağlı" /></Field>
          {invalidTime && <p className="text-sm text-red-600">Bitiş saati başlangıçtan sonra olmalı.</p>}
          {!invalidTime && fromIstanbul(date, start).getTime() < Date.now() && <p className="text-sm text-amber-700">Uyarı: seçilen yeni tarih geçmişte.</p>}
          <div className="flex gap-2">{back}<Button block disabled={invalidTime} loading={postpone.isPending} onClick={() => { setConfirmed(true); postpone.mutate(undefined) }}>Ertele</Button></div>
        </div>
      )}

      {mode === 'edit' && (
        <div className="space-y-4">
          <ScopePicker lesson={lesson} scope={scope} onChange={setScope} verb="güncellenecek" />
          {scope === 'this' && <Field label="Tarih"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Başlangıç"><Input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Bitiş"><Input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Eğitmen">
              <Select value={instr} onChange={(e) => setInstr(e.target.value)}>
                <option value="">Atanmadı</option>
                {instructors?.filter((i) => i.is_active || i.id === lesson.instructor_id).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
              </Select>
            </Field>
            {lesson.lesson_type !== 'online' && (
              <Field label="Sınıf">
                <Select value={room} onChange={(e) => setRoom(e.target.value)}>
                  <option value="">Sınıf yok</option>
                  {rooms?.filter((r) => r.is_active || r.id === lesson.room_id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <Field label="Ders konusu"><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Ders notu"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {canManage && <Field label="Yönetici açıklaması"><Textarea rows={2} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} /></Field>}
          {invalidTime && <p className="text-sm text-red-600">Bitiş saati başlangıçtan sonra olmalı.</p>}
          <div className="flex gap-2">{back}<Button block disabled={invalidTime} loading={edit.isPending} onClick={() => { setConfirmed(true); edit.mutate(undefined) }}>Kaydet</Button></div>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">İptal edilen ders takvimde "İptal edildi" olarak kalır, ders hakkı düşürmez, hatırlatma gönderilmez ve raporlarda görünür. Yanlışlıkla iptal edilirse geri alınabilir.</p>
          <Field label="İptal nedeni"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <div className="flex gap-2">{back}<Button variant="danger" block loading={cancel.isPending} onClick={() => { setConfirmed(true); cancel.mutate(undefined) }}>İptal et</Button></div>
        </div>
      )}

      {mode === 'delete' && (
        <div className="space-y-4">
          <ScopePicker lesson={lesson} scope={scope} onChange={setScope} verb="programdan kaldırılacak" />
          <p className="text-sm text-slate-500">Yalnızca henüz yapılmamış planlı dersler kaldırılır. Ders yapılmayacaksa ve kayıt kalsın istiyorsanız "İptal et" kullanın.</p>
          <div className="flex gap-2">{back}<Button variant="danger" block loading={del.isPending} onClick={() => del.mutate(undefined)}>Kaldır</Button></div>
        </div>
      )}
    </Sheet>
  )
}

export function LessonRow({ lesson, onClick, showDate, showAttendance = true }: { lesson: LessonWithRelations | LessonItem; onClick: () => void; showDate?: boolean; showAttendance?: boolean }) {
  const { can } = useAuth()
  const members = 'members' in lesson ? lesson.members : [lesson]
  const isGroup = members.length > 1
  const st = displayStatus(lesson)
  const att = !isGroup && lesson.attendance ? ATTENDANCE_STATUS[lesson.attendance.status] : null
  const color = lesson.instructor?.color ?? '#2563eb'
  const faded = lesson.status === 'iptal' || lesson.status === 'ertelendi'
  return (
    <div className="card overflow-hidden">
      <button onClick={onClick} className="flex w-full items-center gap-3 p-3.5 text-left">
        <span className="h-11 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="w-14 shrink-0">
          <span className="block text-base font-bold tabular-nums">{timeHM(lesson.starts_at)}</span>
          <span className="block text-xs text-slate-500 tabular-nums">{showDate ? dateKey(lesson.starts_at).slice(5).split('-').reverse().join('.') : timeHM(lesson.ends_at)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={clsx('flex items-center gap-1 truncate font-semibold', faded && 'text-slate-400 line-through')}>
            {isGroup && <Users className="size-3.5 shrink-0" />}{memberLabel({ members, student: lesson.student })}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {lesson.title || lesson.course?.name || '—'} · {lesson.instructor?.full_name ?? 'Eğitmen yok'}
            {lesson.room ? ` · ${lesson.room.name}` : lesson.lesson_type === 'online' ? ' · Online' : ''}
            {can.lessons && !isGroup && lesson.student ? ` · ${lesson.student.remaining_lessons} hak` : ''}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          {att ? <Badge tone={att.tone}>{att.label}</Badge> : <Badge tone={st.tone}>{st.label}</Badge>}
        </span>
      </button>
      {showAttendance && !isGroup && lesson.status === 'planlandi' && !lesson.attendance && new Date(lesson.starts_at).getTime() - Date.now() < 3 * 3600_000 && (
        <div className="border-t border-slate-100 px-3.5 py-2.5">
          <AttendanceButtons lesson={lesson} compact />
        </div>
      )}
    </div>
  )
}
