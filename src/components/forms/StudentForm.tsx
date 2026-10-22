import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { studentSchema, type StudentFormInput, type StudentFormValues } from '@/lib/schemas'
import { useCourses, useInstructors, useDbMutation, insertRow, updateVersioned } from '@/lib/api'
import type { Student } from '@/types/db'
import { Button, Field, Input, Select, Sheet, Textarea, Toggle } from '@/components/ui'

const empty: StudentFormInput = {
  full_name: '', phone: '', email: '', birth_date: '', guardian_name: '', guardian_phone: '', address: '',
  course_id: '', instructor_id: '', total_lessons: 8, total_fee: 0, notes: '', is_active: true,
}

function toInput(s: Student): StudentFormInput {
  return {
    full_name: s.full_name, phone: s.phone ?? '', email: s.email ?? '', birth_date: s.birth_date ?? '',
    guardian_name: s.guardian_name ?? '', guardian_phone: s.guardian_phone ?? '', address: s.address ?? '',
    course_id: s.course_id ?? '', instructor_id: s.instructor_id ?? '', total_lessons: s.total_lessons,
    total_fee: Number(s.total_fee), notes: s.notes ?? '', is_active: s.is_active,
  }
}

export function StudentFormSheet({ open, onClose, student, onSaved, quick }: {
  open: boolean; onClose: () => void; student?: Student | null; onSaved?: (s: Student) => void; quick?: boolean
}) {
  const { data: courses } = useCourses()
  const { data: instructors } = useInstructors()
  const form = useForm<StudentFormInput, unknown, StudentFormValues>({ resolver: zodResolver(studentSchema), defaultValues: empty })
  const { register, handleSubmit, formState: { errors, isDirty }, reset, setValue, control, watch } = form

  useEffect(() => {
    if (open) reset(student ? toInput(student) : empty)
  }, [open, student, reset])

  const save = useDbMutation(
    (v: StudentFormValues) =>
      student ? updateVersioned<Student>('students', student.id, student.version, v) : insertRow<Student>('students', v),
    {
      success: student ? 'Öğrenci güncellendi' : 'Öğrenci eklendi',
      invalidate: ['students', 'student'],
      onSuccess: (s) => {
        onSaved?.(s)
        onClose()
      },
    },
  )

  const courseId = watch('course_id')
  const onCourseChange = (id: string) => {
    setValue('course_id', id)
    const c = courses?.find((x) => x.id === id)
    if (c && !student) {
      setValue('total_lessons', c.default_lesson_count)
      setValue('total_fee', Number(c.default_fee))
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={student ? 'Öğrenciyi düzenle' : quick ? 'Hızlı öğrenci ekle' : 'Yeni öğrenci'} wide dirty={isDirty && !save.isPending}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>Vazgeç</Button>
          <Button block loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>Kaydet</Button>
        </div>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Ad soyad *" error={errors.full_name?.message} className="sm:col-span-2">
          <Input autoFocus autoComplete="off" {...register('full_name')} />
        </Field>
        <Field label="Telefon" error={errors.phone?.message}>
          <Input type="tel" inputMode="tel" placeholder="05xx xxx xx xx" {...register('phone')} />
        </Field>
        <Field label="Kurs">
          <Select value={courseId ?? ''} onChange={(e) => onCourseChange(e.target.value)}>
            <option value="">Seçilmedi</option>
            {courses?.filter((c) => c.is_active || c.id === courseId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Eğitmen">
          <Select {...register('instructor_id')}>
            <option value="">Atanmadı</option>
            {instructors?.filter((i) => i.is_active || i.id === student?.instructor_id).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
          </Select>
        </Field>
        <Field label={student ? 'Toplam ders hakkı' : 'Başlangıç ders paketi (ders)'} error={errors.total_lessons?.message}
          hint={student ? 'Değişiklik "Elle düzeltme" hareketi olarak kaydedilir. Yeni paket için profilde "Ders hakları" sekmesini kullanın.' : 'Başlangıç paketi olarak kaydedilir.'}>
          <Input type="number" inputMode="numeric" min={0} {...register('total_lessons')} />
        </Field>
        <Field label="Toplam kurs ücreti (₺)" error={errors.total_fee?.message}>
          <Input type="number" inputMode="decimal" min={0} step="0.01" {...register('total_fee')} />
        </Field>
        {!quick && (
          <>
            <Field label="Veli adı" error={errors.guardian_name?.message}>
              <Input {...register('guardian_name')} />
            </Field>
            <Field label="Veli telefonu" error={errors.guardian_phone?.message}>
              <Input type="tel" inputMode="tel" {...register('guardian_phone')} />
            </Field>
            <Field label="E-posta" error={errors.email?.message}>
              <Input type="email" inputMode="email" {...register('email')} />
            </Field>
            <Field label="Doğum tarihi">
              <Input type="date" {...register('birth_date')} />
            </Field>
            <Field label="Adres" error={errors.address?.message} className="sm:col-span-2">
              <Input {...register('address')} />
            </Field>
            <Field label="Notlar" error={errors.notes?.message} className="sm:col-span-2">
              <Textarea {...register('notes')} />
            </Field>
            <div className="sm:col-span-2">
              <Controller control={control} name="is_active" render={({ field }) => (
                <Toggle checked={field.value} onChange={field.onChange} label="Aktif öğrenci" description="Pasif öğrenciler listelerde ayrı gösterilir." />
              )} />
            </div>
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}
