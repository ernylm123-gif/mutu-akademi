import { z } from 'zod'

const optionalText = (max = 500) =>
  z.string().trim().max(max, `En fazla ${max} karakter`).optional().or(z.literal('')).transform((v) => (v ? v : null))

const phone = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[+\d][\d\s()-]{6,19}$/.test(v), 'Geçerli bir telefon numarası girin')
  .transform((v) => (v ? v : null))

const email = z
  .string()
  .trim()
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Geçerli bir e-posta girin')
  .transform((v) => (v ? v.toLowerCase() : null))

const uuidOrNull = z.string().transform((v) => (v ? v : null))
const intField = (min = 0, max = 10000) => z.coerce.number().int('Tam sayı girin').min(min).max(max)
const moneyField = z.coerce.number().min(0, 'Negatif olamaz').max(100_000_000)

export const studentSchema = z.object({
  full_name: z.string().trim().min(2, 'Ad soyad en az 2 karakter olmalı').max(120),
  phone,
  email,
  birth_date: z.string().transform((v) => (v ? v : null)),
  guardian_name: optionalText(120),
  guardian_phone: phone,
  address: optionalText(300),
  course_id: uuidOrNull,
  instructor_id: uuidOrNull,
  total_lessons: intField(0, 2000),
  total_fee: moneyField,
  notes: optionalText(2000),
  is_active: z.boolean(),
})
export type StudentFormInput = z.input<typeof studentSchema>
export type StudentFormValues = z.output<typeof studentSchema>

export const lessonSchema = z
  .object({
    student_id: z.string().min(1, 'Öğrenci seçin'),
    instructor_id: uuidOrNull,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih seçin'),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'Saat seçin'),
    duration_minutes: intField(10, 600),
    notes: optionalText(1000),
    repeat_weekly: z.boolean(),
    repeat_until: z.string().optional(),
  })
  .refine((v) => !v.repeat_weekly || (v.repeat_until && v.repeat_until >= v.date), {
    message: 'Bitiş tarihi ders tarihinden sonra olmalı',
    path: ['repeat_until'],
  })
export type LessonFormInput = z.input<typeof lessonSchema>
export type LessonFormValues = z.output<typeof lessonSchema>

export const paymentSchema = z.object({
  amount: z.coerce.number().positive('Tutar sıfırdan büyük olmalı').max(100_000_000),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih seçin'),
  method: z.enum(['nakit', 'kart', 'havale', 'diger']),
  note: optionalText(500),
})
export type PaymentFormInput = z.input<typeof paymentSchema>
export type PaymentFormValues = z.output<typeof paymentSchema>

export const installmentPlanSchema = z.object({
  total: z.coerce.number().positive('Tutar girin').max(100_000_000),
  count: intField(1, 48),
  first_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih seçin'),
})
export type InstallmentPlanInput = z.input<typeof installmentPlanSchema>

export const instructorSchema = z.object({
  full_name: z.string().trim().min(2, 'Ad soyad girin').max(120),
  phone,
  email,
  specialty: optionalText(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  notes: optionalText(2000),
  is_active: z.boolean(),
  profile_id: uuidOrNull,
})
export type InstructorFormInput = z.input<typeof instructorSchema>
export type InstructorFormValues = z.output<typeof instructorSchema>

export const courseSchema = z.object({
  name: z.string().trim().min(2, 'Kurs adı girin').max(120),
  description: optionalText(500),
  default_lesson_count: intField(0, 2000),
  default_fee: moneyField,
  duration_minutes: intField(10, 600),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  is_active: z.boolean(),
})
export type CourseFormInput = z.input<typeof courseSchema>
export type CourseFormValues = z.output<typeof courseSchema>

export const scheduleSchema = z.object({
  weekday: z.coerce.number().int().min(1).max(7),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Saat seçin'),
  duration_minutes: intField(10, 600),
  instructor_id: uuidOrNull,
  generate_until: z.string().optional(),
})
export type ScheduleFormInput = z.input<typeof scheduleSchema>
export type ScheduleFormValues = z.output<typeof scheduleSchema>

export const newUserSchema = z.object({
  full_name: z.string().trim().min(2, 'Ad soyad girin').max(120),
  email: z.email('Geçerli bir e-posta girin').trim().toLowerCase(),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı').max(72),
  role: z.enum(['admin', 'egitmen', 'personel']),
})
export type NewUserInput = z.input<typeof newUserSchema>

export const loginSchema = z.object({
  email: z.email('Geçerli bir e-posta girin').trim().toLowerCase(),
  password: z.string().min(1, 'Şifre girin'),
})

export const registerSchema = z
  .object({
    full_name: z.string().trim().min(2, 'Ad soyad girin').max(120),
    email: z.email('Geçerli bir e-posta girin').trim().toLowerCase(),
    password: z.string().min(8, 'Şifre en az 8 karakter olmalı').max(72),
    password2: z.string(),
  })
  .refine((v) => v.password === v.password2, { message: 'Şifreler eşleşmiyor', path: ['password2'] })

/** Toplam tutarı taksitlere böler; kuruş farkı son taksite eklenir. */
export function splitInstallments(total: number, count: number): number[] {
  const cents = Math.round(total * 100)
  const base = Math.floor(cents / count)
  const parts = Array.from({ length: count }, () => base)
  parts[count - 1] += cents - base * count
  return parts.map((c) => c / 100)
}
