import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useStudents, useInstructors, useCourses, useRooms, useDbMutation, insertRow, planRpc, newRequestId, LESSON_INVALIDATE, type LessonPlanInput } from '@/lib/api'
import { addMonths, dateKey, formatDayShort, isoWeekday, timeHM, WEEKDAYS, WEEKDAYS_SHORT } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { LESSON_TYPE } from '@/lib/format'
import { frequentTimes } from '@/lib/recent'
import type { Course, Instructor, LessonPreview, LessonType, Student } from '@/types/db'
import { Button, Field, Input, Segmented, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { SearchSelect } from '@/components/ui/SearchSelect'

type Freq = 'yok' | 'gunluk' | 'haftalik' | 'gunler' | 'iki_haftalik' | 'ozel'
const FREQS: { value: Freq; label: string }[] = [
  { value: 'yok', label: 'Tek seferlik' },
  { value: 'gunluk', label: 'Her gün' },
  { value: 'haftalik', label: 'Her hafta' },
  { value: 'gunler', label: 'Belirli hafta günlerinde' },
  { value: 'iki_haftalik', label: 'İki haftada bir' },
  { value: 'ozel', label: 'Özel (her N günde bir)' },
]
const DURATIONS = [45, 60, 90, 120]

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const toHM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

interface State {
  students: string[]
  instructor: string
  course: string
  room: string
  title: string
  type: LessonType
  date: string
  start: string
  end: string
  freq: Freq
  weekdays: number[]
  interval: number
  until: string
  notes: string
  instructorNote: string
  adminNote: string
  group: boolean
  advanced: boolean
}

/** Form içinden hızlı kayıt (öğrenci / kurs / eğitmen) – boş listede ders eklemeyi engellememek için */
function QuickAdd<T extends { id: string }>({ placeholder, button, create, onCreated, invalidate, disabled }: {
  placeholder: string; button: string; create: (name: string) => Promise<T>; onCreated: (row: T) => void; invalidate: string[]; disabled?: boolean
}) {
  const [name, setName] = useState('')
  const add = useDbMutation((n: string) => create(n), {
    success: (_r, n) => `"${n}" eklendi ve seçildi`, invalidate,
    onSuccess: (row) => { setName(''); onCreated(row) },
  })
  if (disabled) return <p className="text-sm text-slate-500">Bu kaydı yalnızca yönetici ekleyebilir.</p>
  const ok = name.trim().length >= 2
  return (
    <div className="flex gap-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={120} enterKeyHint="done"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (ok) add.mutate(name.trim()) } }} />
      <Button type="button" disabled={!ok} loading={add.isPending} onClick={() => add.mutate(name.trim())} className="shrink-0">{button}</Button>
    </div>
  )
}

export function LessonFormSheet({ open, onClose, defaults }: {
  open: boolean
  onClose: () => void
  defaults?: { student_id?: string; date?: string; time?: string; instructor_id?: string }
}) {
  const { can } = useAuth()
  const { data: students } = useStudents()
  const { data: instructors } = useInstructors()
  const { data: courses } = useCourses()
  const { data: rooms } = useRooms()
  const [v, setV] = useState<State | null>(null)
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState<LessonPreview | null>(null)
  const [previewErr, setPreviewErr] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const requestId = useRef(newRequestId())

  useEffect(() => {
    if (!open) return
    const date = defaults?.date ?? dateKey()
    const start = defaults?.time ?? '10:00'
    const st = students?.find((s) => s.id === defaults?.student_id)
    const dur = courses?.find((c) => c.id === st?.course_id)?.duration_minutes ?? 60
    setV({
      students: defaults?.student_id ? [defaults.student_id] : [],
      instructor: defaults?.instructor_id ?? st?.instructor_id ?? '',
      course: st?.course_id ?? '',
      room: '', title: '', type: 'bireysel', date, start, end: toHM(toMin(start) + dur),
      freq: 'yok', weekdays: [isoWeekday(date)], interval: 7, until: addMonths(date, 3),
      notes: '', instructorNote: '', adminNote: '', group: false, advanced: false,
    })
    setDirty(false)
    setPreview(null)
    setPreviewErr(null)
    requestId.current = newRequestId()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<State>) => { setV((s) => (s ? { ...s, ...patch } : s)); setDirty(true) }

  // İlk öğrenci seçilince kurs, eğitmen ve süre otomatik doldurulur
  const firstStudent = v?.students[0]
  useEffect(() => {
    if (!v || !firstStudent || v.students.length !== 1) return
    const st = students?.find((s) => s.id === firstStudent)
    if (!st) return
    const patch: Partial<State> = {}
    if (!v.instructor && st.instructor_id) patch.instructor = st.instructor_id
    if (!v.course && st.course_id) {
      patch.course = st.course_id
      const c = courses?.find((x) => x.id === st.course_id)
      if (c) patch.end = toHM(toMin(v.start) + c.duration_minutes)
    }
    if (Object.keys(patch).length) setV((s) => (s ? { ...s, ...patch } : s))
  }, [firstStudent]) // eslint-disable-line react-hooks/exhaustive-deps

  const duration = v && /^\d\d:\d\d$/.test(v.start) && /^\d\d:\d\d$/.test(v.end) ? toMin(v.end) - toMin(v.start) : 0
  const effectiveType: LessonType = v ? (v.type === 'bireysel' && v.students.length > 1 ? 'grup' : v.type) : 'bireysel'

  const input = useMemo<LessonPlanInput | null>(() => {
    if (!v || v.students.length === 0 || !v.date || duration <= 0) return null
    const repeat = v.freq === 'yok' ? undefined
      : v.freq === 'gunler' ? { freq: 'haftalik', weekdays: v.weekdays, until: v.until }
      : v.freq === 'haftalik' ? { freq: 'haftalik', weekdays: [isoWeekday(v.date)], until: v.until }
      : v.freq === 'iki_haftalik' ? { freq: 'iki_haftalik', weekdays: v.weekdays.length ? v.weekdays : [isoWeekday(v.date)], until: v.until }
      : v.freq === 'ozel' ? { freq: 'ozel', interval_days: v.interval, until: v.until }
      : { freq: 'gunluk', until: v.until }
    return {
      student_ids: v.students, instructor_id: v.instructor || null, course_id: v.course || null,
      room_id: effectiveType === 'online' ? null : v.room || null, title: v.title.trim() || null, lesson_type: effectiveType,
      date: v.date, start: v.start, end: v.end, repeat,
      notes: v.notes.trim() || null, instructor_note: v.instructorNote.trim() || null, admin_note: v.adminNote.trim() || null,
    }
  }, [v, duration, effectiveType])

  // Çakışma / müsaitlik ön kontrolü (yazarken sunucudan)
  const key = input ? JSON.stringify({ ...input, notes: null, instructor_note: null, admin_note: null, title: null }) : ''
  useEffect(() => {
    if (!open || !input) { setPreview(null); return }
    let alive = true
    setChecking(true)
    const t = setTimeout(() => {
      planRpc.preview(input)
        .then((p) => { if (alive) { setPreview(p); setPreviewErr(null) } })
        .catch((e) => { if (alive) { setPreview(null); setPreviewErr(errorMessage(e)) } })
        .finally(() => { if (alive) setChecking(false) })
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [key, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useDbMutation(
    (skip: boolean) => {
      if (!input) throw new Error('Öğrenci, tarih ve saat seçin.')
      frequentTimes.add(input.start)
      return planRpc.create(input, skip, requestId.current)
    },
    {
      success: (r) => (r.created > 1 ? `${r.created} ders oluşturuldu` : 'Ders oluşturuldu') + (r.skipped ? `, ${r.skipped} çakışan tarih atlandı` : ''),
      invalidate: LESSON_INVALIDATE,
      onSuccess: onClose,
    },
  )

  if (!v) return null
  const studentOpts = (students ?? []).filter((s) => s.is_active || v.students.includes(s.id))
    .map((s) => ({ value: s.id, label: s.full_name, hint: s.total_lessons > 0 ? `${s.remaining_lessons} hak` : undefined }))
  const noCredit = (students ?? []).filter((s) => v.students.includes(s.id) && s.total_lessons > 0 && s.remaining_lessons <= 0)
  const room = rooms?.find((r) => r.id === v.room)
  const conflicts = preview?.occurrences.filter((o) => o.conflicts.length) ?? []
  const warnings = preview?.occurrences.filter((o) => o.warnings.length) ?? []
  const allConflict = !!preview && preview.conflict_count === preview.count
  const times = frequentTimes.get()
  const validation = v.students.length === 0 ? 'En az bir öğrenci seçin.' : duration <= 0 ? 'Bitiş saati başlangıçtan sonra olmalı.' : duration > 600 ? 'Ders en fazla 10 saat olabilir.' : null

  return (
    <Sheet open={open} onClose={onClose} title="Yeni ders" dirty={dirty && !save.isPending} wide
      footer={
        <div className="grid gap-2">
          {preview && preview.conflict_count > 0 && !allConflict && (
            <Button variant="secondary" block loading={save.isPending} onClick={() => save.mutate(true)}>
              Çakışan {preview.conflict_count} tarihi atla, {preview.count - preview.conflict_count} ders oluştur
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={onClose}>Vazgeç</Button>
            <Button block loading={save.isPending} disabled={!!validation || !preview || preview.conflict_count > 0 || checking}
              onClick={() => save.mutate(false)}>
              {preview && preview.count > 1 ? `${preview.count} dersi oluştur` : 'Dersi oluştur'}
            </Button>
          </div>
        </div>
      }
    >
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!validation && preview && !preview.conflict_count) save.mutate(false) }} noValidate>
        <Field label={v.group ? `Öğrenciler (${v.students.length}) – grup dersi *` : 'Öğrenci *'}>
          {studentOpts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-brand-300 bg-brand-50/50 p-3">
              <p className="mb-2 text-sm font-semibold text-brand-800">Henüz öğrenci yok – önce öğrenci ekleyin</p>
              <QuickAdd placeholder="Öğrencinin adı soyadı" button="Öğrenci ekle" disabled={!can.students}
                create={(name) => insertRow<Student>('students', { full_name: name, course_id: v.course || null, instructor_id: v.instructor || null })}
                onCreated={(s) => set({ students: [s.id] })} invalidate={['students']} />
            </div>
          ) : (
            <SearchSelect multiple={v.group} options={studentOpts} value={v.students} onChange={(x) => set({ students: x })}
              placeholder={v.group ? 'Öğrencileri ara ve seç' : 'Öğrenci ara ve seç'} ariaLabel="Öğrenci" />
          )}
        </Field>
        {studentOpts.length > 0 && can.students && (
          <details className="-mt-2 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-brand-600">+ Listede yok, yeni öğrenci ekle</summary>
            <QuickAdd placeholder="Öğrencinin adı soyadı" button="Ekle ve seç"
              create={(name) => insertRow<Student>('students', { full_name: name, course_id: v.course || null, instructor_id: v.instructor || null })}
              onCreated={(s) => set({ students: v.group ? [...v.students, s.id] : [s.id] })} invalidate={['students']} />
          </details>
        )}
        {noCredit.length > 0 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{noCredit.map((s) => s.full_name).join(', ')}: kalan ders hakkı yok. Ders yine de planlanabilir.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kurs">
            {(courses ?? []).length === 0 ? (
              <QuickAdd placeholder="Kurs adı (ör. Python Eğitimi)" button="Kurs ekle" disabled={!can.admin}
                create={(name) => insertRow<Course>('courses', { name })} onCreated={(c) => set({ course: c.id })} invalidate={['courses']} />
            ) : (
              <SearchSelect options={(courses ?? []).filter((c) => c.is_active || c.id === v.course).map((c) => ({ value: c.id, label: c.name }))}
                value={v.course ? [v.course] : []} onChange={(x) => set({ course: x[0] ?? '' })} placeholder="Kurs ara" emptyLabel="Öğrencinin kursu" ariaLabel="Kurs" />
            )}
          </Field>
          <Field label="Eğitmen">
            {(instructors ?? []).length === 0 ? (
              <QuickAdd placeholder="Eğitmen adı soyadı" button="Eğitmen ekle" disabled={!can.admin}
                create={(name) => insertRow<Instructor>('instructors', { full_name: name })} onCreated={(i) => set({ instructor: i.id })} invalidate={['instructors']} />
            ) : (
              <SearchSelect options={(instructors ?? []).filter((i) => i.is_active || i.id === v.instructor).map((i) => ({ value: i.id, label: i.full_name, hint: i.specialty ?? undefined }))}
                value={v.instructor ? [v.instructor] : []} onChange={(x) => set({ instructor: x[0] ?? '' })} placeholder="Eğitmen ara" emptyLabel="Eğitmen atanmadı" ariaLabel="Eğitmen" />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Tarih" className="col-span-2 sm:col-span-2">
            <Input type="date" value={v.date} onChange={(e) => set({ date: e.target.value, weekdays: v.freq === 'gunler' ? v.weekdays : [isoWeekday(e.target.value)] })} />
          </Field>
          <Field label="Başlangıç">
            <Input type="time" step={300} value={v.start} onChange={(e) => { const s = e.target.value; set({ start: s, end: /^\d\d:\d\d$/.test(s) && duration > 0 ? toHM(toMin(s) + duration) : v.end }) }} />
          </Field>
          <Field label="Bitiş">
            <Input type="time" step={300} value={v.end} onChange={(e) => set({ end: e.target.value })} />
          </Field>
        </div>
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          {DURATIONS.map((d) => (
            <button key={d} type="button" onClick={() => set({ end: toHM(toMin(v.start) + d) })}
              className={clsx('h-10 rounded-full px-3.5 text-sm font-semibold', duration === d ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700')}>{d} dk</button>
          ))}
          <span className={clsx('h-10 rounded-full px-3.5 text-sm font-semibold leading-10', !DURATIONS.includes(duration) && duration > 0 ? 'bg-brand-600 text-white' : 'bg-slate-50 text-slate-500')}>
            {!DURATIONS.includes(duration) && duration > 0 ? `Özel: ${duration} dk` : 'Özel süre: bitişi değiştirin'}
          </span>
        </div>
        {times.length > 0 && (
          <div className="-mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            Sık kullanılan:
            {times.map((t) => <button key={t} type="button" onClick={() => set({ start: t, end: toHM(toMin(t) + Math.max(duration, 30)) })} className="h-8 rounded-full bg-slate-100 px-2.5 font-semibold text-slate-700">{t}</button>)}
          </div>
        )}

        <details className="rounded-2xl border border-slate-200 px-3 [&[open]]:pb-3" open={v.advanced} onToggle={(e) => setV((s) => (s ? { ...s, advanced: (e.target as HTMLDetailsElement).open } : s))}>
          <summary className="flex min-h-12 cursor-pointer items-center justify-between text-sm font-semibold">
            Gelişmiş ayarlar
            <span className="text-xs font-normal text-slate-500">Sınıf, grup dersi, tekrarlama, tür, konu, notlar</span>
          </summary>
          <div className="grid gap-4 pt-2">
        <Toggle checked={v.group} onChange={(g) => set({ group: g, students: g ? v.students : v.students.slice(0, 1) })}
          label="Grup dersi" description="Bir derse birden fazla öğrenci; her öğrenciye ayrı yoklama ve ders hakkı." />
        <div>
          <p className="mb-1.5 text-sm font-semibold">Ders türü</p>
          <Segmented value={effectiveType} onChange={(t) => set({ type: t, group: t === 'grup' ? true : v.group })} options={(['bireysel', 'grup', 'online'] as LessonType[]).map((t) => ({ value: t, label: LESSON_TYPE[t] }))} />
        </div>
        <Field label="Ders konusu">
          <Input value={v.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="Ör. Python – Döngüler" />
        </Field>
        {effectiveType !== 'online' && (
          <Field label="Sınıf / oda" hint={room?.capacity ? `Kapasite: ${room.capacity} kişi` : undefined}>
            <Select value={v.room} onChange={(e) => set({ room: e.target.value })}>
              <option value="">Sınıf seçilmedi</option>
              {rooms?.filter((r) => r.is_active || r.id === v.room).map((r) => <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` (${r.capacity} kişi)` : ''}</option>)}
            </Select>
          </Field>
        )}

        <Field label="Tekrarlama">
          <Select value={v.freq} onChange={(e) => set({ freq: e.target.value as Freq })}>
            {FREQS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
        </Field>
        {(v.freq === 'gunler' || v.freq === 'iki_haftalik') && (
          <div className="-mt-2 grid grid-cols-7 gap-1.5" role="group" aria-label="Hafta günleri">
            {WEEKDAYS_SHORT.map((w, i) => {
              const on = v.weekdays.includes(i + 1)
              return (
                <button key={w} type="button" aria-pressed={on} onClick={() => set({ weekdays: on ? v.weekdays.filter((x) => x !== i + 1) : [...v.weekdays, i + 1].sort() })}
                  className={clsx('h-11 rounded-xl text-sm font-semibold', on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}>{w}</button>
              )
            })}
          </div>
        )}
        {v.freq === 'ozel' && (
          <Field label="Kaç günde bir?"><Input type="number" min={1} max={90} value={v.interval} onChange={(e) => set({ interval: Number(e.target.value) || 1 })} /></Field>
        )}
        {v.freq !== 'yok' && (
          <div className="-mt-1 grid gap-2">
            <Field label="Tekrar bitiş tarihi"><Input type="date" value={v.until} min={v.date} onChange={(e) => set({ until: e.target.value })} /></Field>
            <div className="flex gap-2">
              {[1, 3, 6].map((m) => <button key={m} type="button" onClick={() => set({ until: addMonths(v.date, m) })} className="h-9 rounded-full bg-slate-100 px-3 text-sm font-semibold text-slate-700">{m} ay</button>)}
            </div>
            {v.freq === 'haftalik' && <p className="text-xs text-slate-500">Her {WEEKDAYS[isoWeekday(v.date) - 1]} {v.start}–{v.end}</p>}
          </div>
        )}

        <Field label="Ders notu"><Textarea rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Eğitmen notu"><Textarea rows={2} value={v.instructorNote} onChange={(e) => set({ instructorNote: e.target.value })} /></Field>
          {can.lessons && <Field label="Yönetici açıklaması" hint="Yalnızca yetkili cihazlarda görünür."><Textarea rows={2} value={v.adminNote} onChange={(e) => set({ adminNote: e.target.value })} /></Field>}
        </div>
          </div>
        </details>

        <div aria-live="polite" className="rounded-2xl border border-slate-200 p-3 text-sm">
          {validation ? <p className="flex items-center gap-2 text-slate-500"><Info className="size-4" />{validation}</p>
            : previewErr ? <p className="flex items-center gap-2 text-red-700"><AlertTriangle className="size-4" />{previewErr}</p>
            : !preview || checking ? <p className="text-slate-500">Çakışma kontrol ediliyor…</p>
            : (
              <div className="space-y-1.5">
                <p className={clsx('flex items-center gap-2 font-semibold', preview.conflict_count ? 'text-red-700' : 'text-emerald-700')}>
                  {preview.conflict_count ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
                  {preview.count} ders{preview.students > 1 ? ` · ${preview.students} öğrenci` : ''} · {duration} dk{preview.conflict_count ? ` · ${preview.conflict_count} çakışma` : ' · çakışma yok'}
                </p>
                {conflicts.slice(0, 4).map((o) => (
                  <p key={o.starts_at} className="text-red-700">{formatDayShort(dateKey(o.starts_at))} {timeHM(o.starts_at)}: {o.conflicts.join('; ')}</p>
                ))}
                {conflicts.length > 4 && <p className="text-red-700">+{conflicts.length - 4} çakışma daha</p>}
                {warnings.slice(0, 3).map((o) => (
                  <p key={`w${o.starts_at}`} className="text-amber-700">{formatDayShort(dateKey(o.starts_at))} {timeHM(o.starts_at)}: {o.warnings.join('; ')}</p>
                ))}
              </div>
            )}
        </div>
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}
