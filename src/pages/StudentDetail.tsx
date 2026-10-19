import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Phone, Plus, Trash2, CalendarPlus, Repeat, Wallet, StickyNote, Info, CalendarDays, Send } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  useStudent, useStudentLessons, useSchedules, useStudentNotes, usePayments, useInstallments, useBalances,
  useInstructors, useCourses, useProfiles, useDbMutation, insertRow, lessonRpc,
} from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { addMonths, dateKey, formatDate, formatDateTime, WEEKDAYS } from '@/lib/time'
import { formatMoney, INSTALLMENT_STATUS, PAYMENT_METHOD, telHref } from '@/lib/format'
import { scheduleSchema, type ScheduleFormInput, type ScheduleFormValues } from '@/lib/schemas'
import type { Payment, WeeklySchedule } from '@/types/db'
import { Avatar, Badge, Button, Card, ConfirmSheet, EmptyState, Field, Input, PageLoader, Segmented, Select, Sheet, Textarea } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { StudentFormSheet } from '@/components/forms/StudentForm'
import { LessonFormSheet } from '@/components/forms/LessonForm'
import { LessonRow, LessonSheet } from '@/components/forms/LessonActions'
import { PaymentFormSheet, InstallmentPlanSheet, VoidPaymentSheet } from '@/components/forms/PaymentForms'

type Tab = 'dersler' | 'program' | 'odeme' | 'notlar' | 'bilgi'

export function StudentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data: s, isLoading } = useStudent(id)
  const lessonsQ = useStudentLessons(id)
  const { data: instructors } = useInstructors()
  const { data: courses } = useCourses()
  const [tab, setTab] = useState<Tab>('dersler')
  const [editing, setEditing] = useState(false)
  const [newLesson, setNewLesson] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const del = useDbMutation(
    async () => {
      const { error } = await supabase.from('students').delete().eq('id', id!)
      if (error) throw error
    },
    { success: 'Öğrenci silindi', invalidate: ['students'], onSuccess: () => navigate('/ogrenciler', { replace: true }) },
  )

  const lessons = lessonsQ.data ?? []
  const now = Date.now()
  const upcoming = useMemo(() => lessons.filter((l) => new Date(l.starts_at).getTime() >= now - 3600_000 && l.status === 'planlandi').reverse(), [lessons, now])
  const history = useMemo(() => lessons.filter((l) => !upcoming.includes(l)), [lessons, upcoming])
  const selected = lessons.find((l) => l.id === selectedId) ?? null

  if (isLoading) return <PageLoader />
  if (!s) return <EmptyState title="Öğrenci bulunamadı" text="Kayıt silinmiş veya erişim yetkiniz yok." action={<Button onClick={() => navigate('/ogrenciler')}>Öğrencilere dön</Button>} />

  const inst = instructors?.find((i) => i.id === s.instructor_id)
  const course = courses?.find((c) => c.id === s.course_id)
  const pct = s.total_lessons > 0 ? Math.min(100, (s.used_lessons / s.total_lessons) * 100) : 0
  const stats = {
    attended: lessons.filter((l) => l.attendance?.status === 'katildi').length,
    absent: lessons.filter((l) => l.attendance?.status === 'katilmadi').length,
    excused: lessons.filter((l) => l.attendance?.status === 'izinli').length,
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: 'dersler', label: 'Dersler' },
    { value: 'program', label: 'Program' },
    ...(can.payments ? [{ value: 'odeme' as Tab, label: 'Ödeme' }] : []),
    { value: 'notlar', label: 'Notlar' },
    { value: 'bilgi', label: 'Bilgi' },
  ]

  return (
    <div>
      <PageHeader back title={s.full_name} subtitle={`${course?.name ?? 'Kurs yok'} · ${inst?.full_name ?? 'Eğitmen atanmadı'}`}
        actions={can.students && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Düzenle</Button>} />

      <Card className="mb-4 p-5">
        <div className="flex items-center gap-4">
          <div className="relative grid size-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#29a8df ${pct}%, rgba(148,163,184,.2) 0)` }}>
            <div className="grid size-[80px] place-items-center rounded-full bg-white text-center dark:bg-[#121821]">
              <div>
                <p className="text-2xl font-extrabold tabular-nums leading-none">{s.remaining_lessons}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">kalan hak</p>
              </div>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-2 text-center">
            <div><p className="text-xl font-bold tabular-nums">{s.total_lessons}</p><p className="text-xs text-slate-500">Toplam</p></div>
            <div><p className="text-xl font-bold tabular-nums text-brand-600">{s.used_lessons}</p><p className="text-xs text-slate-500">Tamamlanan</p></div>
            <div><p className="text-xl font-bold tabular-nums text-accent-600">{stats.absent}</p><p className="text-xs text-slate-500">Devamsız</p></div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!s.is_active && <Badge>Pasif öğrenci</Badge>}
          {s.total_lessons > 0 && s.remaining_lessons <= 2 && <Badge tone="accent">Ders hakkı azaldı</Badge>}
          <Badge tone="green">{stats.attended} katıldı</Badge>
          <Badge tone="amber">{stats.excused} izinli</Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {s.phone && <a href={telHref(s.phone)} className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand-50 text-sm font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"><Phone className="size-4" /> Öğrenci</a>}
          {s.guardian_phone && <a href={telHref(s.guardian_phone)} className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-accent-50 text-sm font-semibold text-accent-700 dark:bg-accent-500/15 dark:text-accent-400"><Phone className="size-4" /> Veli</a>}
          {can.lessons && <Button variant="secondary" icon={<CalendarPlus className="size-4" />} onClick={() => setNewLesson(true)}>Ders ekle</Button>}
        </div>
      </Card>

      <div className="mb-4 overflow-x-auto"><Segmented value={tab} onChange={setTab} options={tabs} /></div>

      {tab === 'dersler' && (
        <div>
          <h3 className="mb-2 text-sm font-bold text-slate-500">Yaklaşan ({upcoming.length})</h3>
          {upcoming.length === 0 ? <Card className="mb-4 p-4 text-sm text-slate-500">Planlı ders yok.</Card> : (
            <div className="mb-5 space-y-2">{upcoming.map((l) => <LessonRow key={l.id} lesson={l} showDate onClick={() => setSelectedId(l.id)} />)}</div>
          )}
          <h3 className="mb-2 text-sm font-bold text-slate-500">Geçmiş ({history.length})</h3>
          {history.length === 0 ? <Card className="p-4 text-sm text-slate-500">Henüz geçmiş ders yok.</Card> : (
            <div className="space-y-2">{history.map((l) => <LessonRow key={l.id} lesson={l} showDate showAttendance={false} onClick={() => setSelectedId(l.id)} />)}</div>
          )}
        </div>
      )}
      {tab === 'program' && <ScheduleTab studentId={s.id} defaultInstructor={s.instructor_id} />}
      {tab === 'odeme' && can.payments && <PaymentsTab studentId={s.id} studentName={s.full_name} totalFee={Number(s.total_fee)} />}
      {tab === 'notlar' && <NotesTab studentId={s.id} />}
      {tab === 'bilgi' && (
        <Card className="divide-y divide-slate-100 text-sm dark:divide-white/10">
          {[
            ['Telefon', s.phone], ['E-posta', s.email], ['Doğum tarihi', formatDate(s.birth_date)], ['Veli', s.guardian_name],
            ['Veli telefonu', s.guardian_phone], ['Adres', s.address], ['Kurs ücreti', formatMoney(s.total_fee)],
            ['Kayıt tarihi', formatDateTime(s.created_at)], ['Notlar', s.notes],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 p-3.5"><span className="text-slate-500">{k}</span><span className="text-right font-medium">{v || '—'}</span></div>
          ))}
          {can.admin && (
            <div className="p-3.5">
              <Button variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Öğrenciyi sil</Button>
            </div>
          )}
        </Card>
      )}

      <StudentFormSheet open={editing} onClose={() => setEditing(false)} student={s} />
      <LessonFormSheet open={newLesson} onClose={() => setNewLesson(false)} defaults={{ student_id: s.id }} />
      <LessonSheet lesson={selected} onClose={() => setSelectedId(null)} />
      <ConfirmSheet open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => del.mutate(undefined)} loading={del.isPending} danger
        title="Öğrenci silinsin mi?" confirmLabel="Kalıcı olarak sil"
        text="Öğrencinin tüm dersleri, yoklamaları ve ödemeleri de silinir. Bunun yerine öğrenciyi pasif yapmanız önerilir." />
    </div>
  )
}

function ScheduleTab({ studentId, defaultInstructor }: { studentId: string; defaultInstructor: string | null }) {
  const { can } = useAuth()
  const { data: schedules } = useSchedules(studentId)
  const { data: instructors } = useInstructors()
  const [open, setOpen] = useState(false)
  const [genFor, setGenFor] = useState<WeeklySchedule | null>(null)
  const [until, setUntil] = useState(addMonths(dateKey(), 1))
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ScheduleFormInput, unknown, ScheduleFormValues>({ resolver: zodResolver(scheduleSchema) })

  const add = useDbMutation(
    async (v: ScheduleFormValues) => {
      const sc = await insertRow<WeeklySchedule>('weekly_schedules', {
        student_id: studentId, weekday: v.weekday, start_time: v.start_time, duration_minutes: v.duration_minutes, instructor_id: v.instructor_id,
      })
      if (v.generate_until) return lessonRpc.generate(sc.id, dateKey(), v.generate_until)
      return { created: 0, skipped: 0 }
    },
    { success: (r) => `Program eklendi${r.created ? `, ${r.created} ders oluşturuldu` : ''}${r.skipped ? ` (${r.skipped} çakışma atlandı)` : ''}`, invalidate: ['schedules', 'lessons', 'student-lessons'], onSuccess: () => setOpen(false) },
  )
  const gen = useDbMutation(() => lessonRpc.generate(genFor!.id, dateKey(), until), {
    success: (r) => `${r.created} ders oluşturuldu${r.skipped ? `, ${r.skipped} çakışma atlandı` : ''}`,
    invalidate: ['lessons', 'student-lessons'],
    onSuccess: () => setGenFor(null),
  })
  const remove = useDbMutation(async (sid: string) => {
    const { error } = await supabase.from('weekly_schedules').delete().eq('id', sid)
    if (error) throw error
  }, { success: 'Program silindi (oluşturulmuş dersler korunur)', invalidate: ['schedules'] })

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">Haftalık tekrarlayan ders programı</p>
        {can.lessons && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { reset({ weekday: 1, start_time: '10:00', duration_minutes: 60, instructor_id: defaultInstructor ?? '', generate_until: addMonths(dateKey(), 1) }); setOpen(true) }}>Program ekle</Button>}
      </div>
      {(schedules ?? []).length === 0 ? <Card><EmptyState icon={<Repeat className="size-6" />} title="Haftalık program yok" text="Her hafta tekrarlanan bir ders saati ekleyin." /></Card> : (
        <div className="space-y-2">
          {schedules!.map((sc) => (
            <Card key={sc.id} className="flex items-center gap-3 p-3.5">
              <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{WEEKDAYS[sc.weekday - 1].slice(0, 3)}</span>
              <span className="flex-1">
                <span className="block font-semibold">{WEEKDAYS[sc.weekday - 1]} · {sc.start_time.slice(0, 5)}</span>
                <span className="block text-xs text-slate-500">{sc.duration_minutes} dk · {instructors?.find((i) => i.id === sc.instructor_id)?.full_name ?? 'Varsayılan eğitmen'}</span>
              </span>
              {can.lessons && (
                <>
                  <Button size="sm" variant="secondary" icon={<CalendarDays className="size-4" />} onClick={() => setGenFor(sc)}>Ders üret</Button>
                  <button onClick={() => remove.mutate(sc.id)} className="grid size-9 place-items-center rounded-full text-slate-400 hover:text-red-600" aria-label="Programı sil"><Trash2 className="size-4" /></button>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Haftalık program ekle"
        footer={<div className="flex gap-2"><Button variant="secondary" block onClick={() => setOpen(false)}>Vazgeç</Button><Button block loading={add.isPending} onClick={handleSubmit((v) => add.mutate(v))}>Kaydet</Button></div>}>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gün"><Select {...register('weekday')}>{WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</Select></Field>
            <Field label="Saat" error={errors.start_time?.message}><Input type="time" step={300} {...register('start_time')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Süre (dk)"><Input type="number" min={10} step={5} {...register('duration_minutes')} /></Field>
            <Field label="Eğitmen"><Select {...register('instructor_id')}><option value="">Öğrencinin eğitmeni</option>{instructors?.filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}</Select></Field>
          </div>
          <Field label="Şu tarihe kadar ders oluştur" hint="Boş bırakırsanız yalnızca program kaydedilir."><Input type="date" {...register('generate_until')} /></Field>
        </div>
      </Sheet>
      <Sheet open={!!genFor} onClose={() => setGenFor(null)} title="Programdan ders üret"
        footer={<div className="flex gap-2"><Button variant="secondary" block onClick={() => setGenFor(null)}>Vazgeç</Button><Button block loading={gen.isPending} onClick={() => gen.mutate(undefined)}>Oluştur</Button></div>}>
        <p className="mb-4 text-sm text-slate-500">Bugünden itibaren seçilen tarihe kadar her hafta ders oluşturulur. Zaten var olan ve çakışan dersler atlanır.</p>
        <Field label="Bitiş tarihi"><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      </Sheet>
    </div>
  )
}

function PaymentsTab({ studentId, studentName, totalFee }: { studentId: string; studentName: string; totalFee: number }) {
  const { can } = useAuth()
  const { data: payments } = usePayments(studentId)
  const { data: installments } = useInstallments(studentId)
  const { data: balances } = useBalances()
  const [adding, setAdding] = useState(false)
  const [plan, setPlan] = useState(false)
  const [voiding, setVoiding] = useState<Payment | null>(null)
  const bal = balances?.find((b) => b.student_id === studentId)
  const paid = Number(bal?.paid ?? 0)
  const remaining = Number(bal?.balance ?? totalFee)
  const nextDue = installments?.find((i) => i.status !== 'odendi')
  const removeInst = useDbMutation(async (iid: string) => {
    const { error } = await supabase.from('installments').delete().eq('id', iid)
    if (error) throw error
  }, { success: 'Taksit silindi', invalidate: ['installments', 'balances'] })

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3.5"><p className="text-xs text-slate-500">Kurs ücreti</p><p className="mt-1 font-bold tabular-nums">{formatMoney(totalFee)}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-slate-500">Ödenen</p><p className="mt-1 font-bold tabular-nums text-emerald-600">{formatMoney(paid)}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-slate-500">Kalan</p><p className={`mt-1 font-bold tabular-nums ${remaining > 0 ? 'text-red-600' : ''}`}>{formatMoney(remaining)}</p></Card>
      </div>
      <div className="mt-3 flex gap-2">
        <Button block icon={<Wallet className="size-4" />} onClick={() => setAdding(true)}>Ödeme ekle</Button>
        <Button block variant="secondary" icon={<Plus className="size-4" />} onClick={() => setPlan(true)}>Taksit planı</Button>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-bold text-slate-500">Taksitler</h3>
      {(installments ?? []).length === 0 ? <Card className="p-4 text-sm text-slate-500">Taksit planı yok.</Card> : (
        <Card className="divide-y divide-slate-100 dark:divide-white/10">
          {installments!.map((i) => (
            <div key={i.id} className="flex items-center gap-3 p-3.5">
              <span className="flex-1">
                <span className="block text-sm font-semibold">{formatDate(i.due_date)}</span>
                <span className="block text-xs text-slate-500">{i.note ?? 'Taksit'}{i.status === 'kismi' ? ` · ${formatMoney(i.covered)} ödendi` : ''}</span>
              </span>
              <span className="font-semibold tabular-nums">{formatMoney(i.amount)}</span>
              <Badge tone={INSTALLMENT_STATUS[i.status].tone}>{INSTALLMENT_STATUS[i.status].label}</Badge>
              <button onClick={() => removeInst.mutate(i.id)} className="text-slate-300 hover:text-red-600" aria-label="Taksiti sil"><Trash2 className="size-4" /></button>
            </div>
          ))}
        </Card>
      )}

      <h3 className="mb-2 mt-5 text-sm font-bold text-slate-500">Ödeme geçmişi</h3>
      {(payments ?? []).length === 0 ? <Card className="p-4 text-sm text-slate-500">Henüz ödeme yok.</Card> : (
        <Card className="divide-y divide-slate-100 dark:divide-white/10">
          {payments!.map((p) => (
            <div key={p.id} className={`flex items-center gap-3 p-3.5 ${p.is_void ? 'opacity-50' : ''}`}>
              <span className="flex-1">
                <span className={`block text-sm font-semibold tabular-nums ${p.is_void ? 'line-through' : ''}`}>{formatMoney(p.amount)}</span>
                <span className="block text-xs text-slate-500">{formatDate(p.paid_at)} · {PAYMENT_METHOD[p.method]}{p.note ? ` · ${p.note}` : ''}</span>
                {p.is_void && <span className="block text-xs text-red-600">İptal: {p.void_reason}</span>}
              </span>
              {can.admin && !p.is_void && <Button size="sm" variant="ghost" onClick={() => setVoiding(p)}>Düzelt</Button>}
            </div>
          ))}
        </Card>
      )}
      <PaymentFormSheet open={adding} onClose={() => setAdding(false)} studentId={studentId} studentName={studentName} suggested={nextDue ? nextDue.amount - nextDue.covered : undefined} />
      <InstallmentPlanSheet open={plan} onClose={() => setPlan(false)} studentId={studentId} defaultTotal={Math.max(0, remaining)} />
      <VoidPaymentSheet payment={voiding} onClose={() => setVoiding(null)} />
    </div>
  )
}

function NotesTab({ studentId }: { studentId: string }) {
  const { session, can } = useAuth()
  const { data: notes } = useStudentNotes(studentId)
  const { data: profiles } = useProfiles(can.staff)
  const [text, setText] = useState('')
  const add = useDbMutation(() => insertRow('student_notes', { student_id: studentId, body: text.trim() }), {
    success: 'Not eklendi', invalidate: ['student-notes'], onSuccess: () => setText(''),
  })
  const remove = useDbMutation(async (nid: string) => {
    const { error } = await supabase.from('student_notes').delete().eq('id', nid)
    if (error) throw error
  }, { success: 'Not silindi', invalidate: ['student-notes'] })
  return (
    <div>
      <Card className="p-3">
        <Textarea rows={3} placeholder="Öğrenci hakkında not ekleyin…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 flex justify-end"><Button size="sm" icon={<Send className="size-4" />} disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate(undefined)}>Ekle</Button></div>
      </Card>
      <div className="mt-3 space-y-2">
        {(notes ?? []).length === 0 && <Card><EmptyState icon={<StickyNote className="size-6" />} title="Not yok" /></Card>}
        {notes?.map((n) => {
          const author = profiles?.find((p) => p.id === n.author_id)
          return (
            <Card key={n.id} className="p-3.5">
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                {author && <Avatar name={author.full_name || author.email} size={18} />}
                <span>{author?.full_name ?? ''} · {formatDateTime(n.created_at)}</span>
                {(can.admin || n.author_id === session?.user.id) && (
                  <button onClick={() => remove.mutate(n.id)} className="ml-auto hover:text-red-600" aria-label="Notu sil"><Trash2 className="size-3.5" /></button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400"><Info className="size-3.5" /> Notlar yalnızca yetkili kullanıcılar tarafından görülebilir.</p>
    </div>
  )
}
