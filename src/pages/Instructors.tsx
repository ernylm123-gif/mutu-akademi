import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { GraduationCap, Plus, Pencil, Phone, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useInstructors, useLessons, useStudents, useProfiles, useDbMutation, insertRow, updateVersioned } from '@/lib/api'
import { instructorSchema, type InstructorFormInput, type InstructorFormValues } from '@/lib/schemas'
import { addDays, dateKey, fromIstanbul, startOfMonth, addMonths, startOfWeek } from '@/lib/time'
import { telHref } from '@/lib/format'
import type { Instructor } from '@/types/db'
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, PageLoader, SectionTitle, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { LessonRow, LessonSheet } from '@/components/forms/LessonActions'

const COLORS = ['#29A8DF', '#D6268B', '#C9B800', '#111827', '#10B981', '#8B5CF6', '#F97316', '#0EA5E9']

function InstructorFormSheet({ open, onClose, instructor }: { open: boolean; onClose: () => void; instructor?: Instructor | null }) {
  const { data: profiles } = useProfiles()
  const { data: instructors } = useInstructors()
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<InstructorFormInput, unknown, InstructorFormValues>({ resolver: zodResolver(instructorSchema) })
  useEffect(() => {
    if (!open) return
    reset(instructor
      ? { full_name: instructor.full_name, phone: instructor.phone ?? '', email: instructor.email ?? '', specialty: instructor.specialty ?? '', color: instructor.color, notes: instructor.notes ?? '', is_active: instructor.is_active, profile_id: instructor.profile_id ?? '' }
      : { full_name: '', phone: '', email: '', specialty: '', color: COLORS[(instructors?.length ?? 0) % COLORS.length], notes: '', is_active: true, profile_id: '' })
  }, [open, instructor, reset, instructors?.length])
  const save = useDbMutation(
    (v: InstructorFormValues) => (instructor ? updateVersioned('instructors', instructor.id, instructor.version, v) : insertRow('instructors', v)),
    { success: instructor ? 'Eğitmen güncellendi' : 'Eğitmen eklendi', invalidate: ['instructors'], onSuccess: onClose },
  )
  const linkable = profiles?.filter((p) => p.role === 'egitmen' && (!instructors?.some((i) => i.profile_id === p.id) || p.id === instructor?.profile_id)) ?? []
  return (
    <Sheet open={open} onClose={onClose} title={instructor ? 'Eğitmeni düzenle' : 'Yeni eğitmen'}
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>Kaydet</Button></div>}>
      <div className="grid gap-4">
        <Field label="Ad soyad *" error={errors.full_name?.message}><Input {...register('full_name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefon" error={errors.phone?.message}><Input type="tel" {...register('phone')} /></Field>
          <Field label="Branş"><Input placeholder="ör. Piyano" {...register('specialty')} /></Field>
        </div>
        <Field label="E-posta" error={errors.email?.message}><Input type="email" {...register('email')} /></Field>
        <Field label="Takvim rengi">
          <Controller control={control} name="color" render={({ field }) => (
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => field.onChange(c)} aria-label={c}
                  className={`size-9 rounded-full ring-offset-2 ${field.value?.toUpperCase() === c ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`} style={{ background: c }} />
              ))}
            </div>
          )} />
        </Field>
        <Field label="Kullanıcı hesabı" hint="Eğitmen bu hesapla giriş yapınca yalnızca kendi derslerini görür.">
          <Select {...register('profile_id')}>
            <option value="">Bağlı hesap yok</option>
            {linkable.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>)}
          </Select>
        </Field>
        <Field label="Notlar"><Textarea rows={2} {...register('notes')} /></Field>
        <Controller control={control} name="is_active" render={({ field }) => <Toggle checked={field.value} onChange={field.onChange} label="Aktif" />} />
      </div>
    </Sheet>
  )
}

export function InstructorsPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const { data, isLoading } = useInstructors()
  const { data: students } = useStudents()
  const month = startOfMonth(dateKey())
  const lessonsQ = useLessons(fromIstanbul(month).toISOString(), fromIstanbul(addMonths(month, 1)).toISOString())
  const [editing, setEditing] = useState<Instructor | null | undefined>(undefined)
  if (isLoading) return <PageLoader />
  return (
    <div>
      <PageHeader title="Eğitmenler" subtitle={`${data?.filter((i) => i.is_active).length ?? 0} aktif eğitmen`}
        actions={can.admin && <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>Eğitmen ekle</Button>} />
      {(data ?? []).length === 0 ? (
        <Card><EmptyState icon={<GraduationCap className="size-6" />} title="Henüz eğitmen yok" action={can.admin && <Button onClick={() => setEditing(null)}>Eğitmen ekle</Button>} /></Card>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {data!.map((i) => {
            const given = lessonsQ.data?.filter((l) => l.instructor_id === i.id && l.status === 'tamamlandi').length ?? 0
            const assigned = students?.filter((s) => s.instructor_id === i.id && s.is_active).length ?? 0
            return (
              <button key={i.id} onClick={() => navigate(`/egitmenler/${i.id}`)} className="card flex items-center gap-3 p-4 text-left">
                <Avatar name={i.full_name} color={i.color} size={46} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="truncate font-semibold">{i.full_name}</span>{!i.is_active && <Badge>Pasif</Badge>}{i.profile_id && <Badge tone="brand">Hesaplı</Badge>}</span>
                  <span className="block text-xs text-slate-500">{i.specialty ?? 'Branş belirtilmedi'}</span>
                  <span className="mt-1 block text-xs text-slate-500">{assigned} öğrenci · bu ay {given} ders verdi</span>
                </span>
                <ChevronRight className="size-4 text-slate-300" />
              </button>
            )
          })}
        </div>
      )}
      <InstructorFormSheet open={editing !== undefined} onClose={() => setEditing(undefined)} instructor={editing} />
    </div>
  )
}

export function InstructorDetailPage() {
  const { id } = useParams()
  const { can } = useAuth()
  const navigate = useNavigate()
  const { data: instructors, isLoading } = useInstructors()
  const { data: students } = useStudents()
  const ins = instructors?.find((i) => i.id === id)
  const week = startOfWeek(dateKey())
  const lessonsQ = useLessons(fromIstanbul(week).toISOString(), fromIstanbul(addDays(week, 7)).toISOString(), { instructorId: id })
  const month = startOfMonth(dateKey())
  const monthQ = useLessons(fromIstanbul(month).toISOString(), fromIstanbul(addMonths(month, 1)).toISOString(), { instructorId: id })
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const assigned = useMemo(() => students?.filter((s) => s.instructor_id === id) ?? [], [students, id])
  if (isLoading) return <PageLoader />
  if (!ins) return <EmptyState title="Eğitmen bulunamadı" />
  const m = monthQ.data ?? []
  const selected = lessonsQ.data?.find((l) => l.id === selectedId) ?? null
  return (
    <div>
      <PageHeader back title={ins.full_name} subtitle={ins.specialty ?? undefined}
        actions={<>
          {ins.phone && <a href={telHref(ins.phone)}><Button variant="secondary" icon={<Phone className="size-4" />}>Ara</Button></a>}
          {can.admin && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Düzenle</Button>}
        </>} />
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-4 text-center"><p className="text-2xl font-bold">{m.filter((l) => l.status === 'tamamlandi').length}</p><p className="text-xs text-slate-500">Bu ay verilen</p></Card>
        <Card className="p-4 text-center"><p className="text-2xl font-bold">{m.filter((l) => l.status === 'planlandi').length}</p><p className="text-xs text-slate-500">Bu ay planlı</p></Card>
        <Card className="p-4 text-center"><p className="text-2xl font-bold">{assigned.filter((s) => s.is_active).length}</p><p className="text-xs text-slate-500">Öğrenci</p></Card>
      </div>
      {ins.notes && <Card className="mt-3 p-4 text-sm">{ins.notes}</Card>}
      <SectionTitle>Bu haftaki program</SectionTitle>
      {(lessonsQ.data ?? []).length === 0 ? <Card className="p-4 text-sm text-slate-500">Bu hafta ders yok.</Card> : (
        <div className="space-y-2">{lessonsQ.data!.map((l) => <LessonRow key={l.id} lesson={l} showDate onClick={() => setSelectedId(l.id)} />)}</div>
      )}
      <SectionTitle>Atanmış öğrenciler</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-white/10">
        {assigned.length === 0 && <p className="p-4 text-sm text-slate-500">Atanmış öğrenci yok.</p>}
        {assigned.map((s) => (
          <button key={s.id} onClick={() => navigate(`/ogrenciler/${s.id}`)} className="flex w-full items-center gap-3 p-3.5 text-left">
            <Avatar name={s.full_name} color={ins.color} size={34} />
            <span className="flex-1 text-sm font-medium">{s.full_name}</span>
            <span className="text-xs text-slate-500">{s.remaining_lessons}/{s.total_lessons} hak</span>
          </button>
        ))}
      </Card>
      <InstructorFormSheet open={editing} onClose={() => setEditing(false)} instructor={ins} />
      <LessonSheet lesson={selected} onClose={() => setSelectedId(null)} />
    </div>
  )
}
