import { useEffect, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { lessonSchema, type LessonFormInput, type LessonFormValues } from '@/lib/schemas'
import { useStudents, useInstructors, useCourses, useDbMutation, insertRow, lessonRpc } from '@/lib/api'
import { addMonths, dateKey, fromIstanbul, isoWeekday, WEEKDAYS } from '@/lib/time'
import type { Lesson, WeeklySchedule } from '@/types/db'
import { Button, Field, Input, Select, Sheet, Textarea, Toggle } from '@/components/ui'

export function LessonFormSheet({ open, onClose, defaults }: {
  open: boolean
  onClose: () => void
  defaults?: Partial<Pick<LessonFormInput, 'student_id' | 'date' | 'time' | 'instructor_id'>>
}) {
  const { data: students } = useStudents()
  const { data: instructors } = useInstructors()
  const { data: courses } = useCourses()
  const form = useForm<LessonFormInput, unknown, LessonFormValues>({ resolver: zodResolver(lessonSchema) })
  const { register, handleSubmit, reset, watch, setValue, control, formState: { errors } } = form

  useEffect(() => {
    if (!open) return
    const date = defaults?.date ?? dateKey()
    reset({
      student_id: defaults?.student_id ?? '',
      instructor_id: defaults?.instructor_id ?? '',
      date,
      time: defaults?.time ?? '10:00',
      duration_minutes: 60,
      notes: '',
      repeat_weekly: false,
      repeat_until: addMonths(date, 2),
    })
  }, [open, defaults, reset])

  const studentId = watch('student_id')
  const repeat = watch('repeat_weekly')
  const date = watch('date')
  const student = useMemo(() => students?.find((s) => s.id === studentId), [students, studentId])

  // Öğrenci seçilince eğitmen ve süreyi otomatik doldur
  useEffect(() => {
    if (!student) return
    if (student.instructor_id && !defaults?.instructor_id) setValue('instructor_id', student.instructor_id)
    const c = courses?.find((x) => x.id === student.course_id)
    if (c) setValue('duration_minutes', c.duration_minutes)
  }, [student, courses, setValue, defaults?.instructor_id])

  const save = useDbMutation(
    async (v: LessonFormValues) => {
      const st = students?.find((s) => s.id === v.student_id)
      if (v.repeat_weekly) {
        const sched = await insertRow<WeeklySchedule>('weekly_schedules', {
          student_id: v.student_id,
          instructor_id: v.instructor_id,
          weekday: isoWeekday(v.date),
          start_time: v.time,
          duration_minutes: v.duration_minutes,
        })
        const r = await lessonRpc.generate(sched.id, v.date, v.repeat_until!)
        return { repeat: true as const, ...r }
      }
      const start = fromIstanbul(v.date, v.time)
      const end = new Date(start.getTime() + v.duration_minutes * 60000)
      await insertRow<Lesson>('lessons', {
        student_id: v.student_id,
        instructor_id: v.instructor_id,
        course_id: st?.course_id ?? null,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        notes: v.notes,
      })
      return { repeat: false as const, created: 1, skipped: 0 }
    },
    {
      success: (r) =>
        r.repeat
          ? `${r.created} ders oluşturuldu${r.skipped ? `, ${r.skipped} ders çakışma nedeniyle atlandı` : ''}`
          : 'Ders oluşturuldu',
      invalidate: ['lessons', 'student-lessons', 'schedules'],
      onSuccess: onClose,
    },
  )

  const activeStudents = students?.filter((s) => s.is_active) ?? []

  return (
    <Sheet open={open} onClose={onClose} title="Yeni ders"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>Vazgeç</Button>
          <Button block loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>Oluştur</Button>
        </div>
      }
    >
      <form className="grid gap-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Öğrenci *" error={errors.student_id?.message}>
          <Select {...register('student_id')}>
            <option value="">Öğrenci seçin</option>
            {activeStudents.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name} ({s.remaining_lessons} hak)</option>
            ))}
          </Select>
        </Field>
        {student && student.total_lessons > 0 && student.remaining_lessons <= 0 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            Bu öğrencinin kalan ders hakkı yok. Ders yine de planlanabilir.
          </p>
        )}
        <Field label="Eğitmen">
          <Select {...register('instructor_id')}>
            <option value="">Atanmadı</option>
            {instructors?.filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Tarih" error={errors.date?.message} className="col-span-3 sm:col-span-1">
            <Input type="date" {...register('date')} />
          </Field>
          <Field label="Saat" error={errors.time?.message} className="col-span-2 sm:col-span-1">
            <Input type="time" step={300} {...register('time')} />
          </Field>
          <Field label="Süre (dk)" error={errors.duration_minutes?.message}>
            <Input type="number" inputMode="numeric" min={10} step={5} {...register('duration_minutes')} />
          </Field>
        </div>
        <Controller control={control} name="repeat_weekly" render={({ field }) => (
          <Toggle checked={field.value} onChange={field.onChange} label="Her hafta tekrarla"
            description={date ? `Her ${WEEKDAYS[isoWeekday(date) - 1]} aynı saatte` : undefined} />
        )} />
        {repeat && (
          <Field label="Tekrar bitiş tarihi" error={errors.repeat_until?.message} hint="Çakışan haftalar otomatik atlanır.">
            <Input type="date" {...register('repeat_until')} />
          </Field>
        )}
        {!repeat && (
          <Field label="Not">
            <Textarea rows={2} {...register('notes')} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}
