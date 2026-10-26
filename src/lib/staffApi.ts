// Yetkili cihaz işlemleri: korumalı öğrenci/eğitmen kayıtları ve sunucuda hesaplanan istatistikler.
// Tüm çağrılar oturumlu istemciyle yapılır; sunucu yetkiyi her çağrıda doğrular (RLS + require_staff).
import { supabase } from '@/lib/supabase'
import { downloadCsv, saveOrShare } from '@/lib/csv'
import { downloadPdf } from '@/lib/pdf'
import type { SharedAttendance, SharedInput, SharedLesson, SeriesScope } from '@/lib/sharedApi'

export interface StaffStudent {
  id: string
  full_name: string
  public_label: string
  phone: string | null
  guardian_name: string | null
  guardian_phone: string | null
  registered_at: string
  course_names: string[]
  instructor_ids: string[]
  package_name: string | null
  total_lessons: number
  default_duration: number
  notes: string | null
  is_active: boolean
  version: number
}

export interface StaffInstructor {
  id: string
  full_name: string
  public_label: string
  phone: string | null
  specialty: string | null
  course_names: string[]
  notes: string | null
  is_active: boolean
  version: number
}

export interface Availability { id: string; instructor_id: string; weekday: number; start_time: string; end_time: string }
export interface WeeklySlot { id: string; student_id: string; instructor_id: string | null; weekday: number; start_time: string; duration_minutes: number; is_active: boolean }
export interface Package { id: string; student_id: string; kind: 'paket' | 'duzeltme'; name: string; lesson_count: number; purchased_at: string; note: string | null; is_void: boolean; created_at: string }

export interface StaffLesson extends SharedLesson { student_ids: string[]; instructor_id: string | null; student_att: Record<string, SharedAttendance> | null; my_att?: SharedAttendance | null }

export interface Period {
  planned: number; completed: number; attended: number; absent: number; excused: number; late: number; early: number
  cancelled: number; postponed: number; scheduled_min: number; attended_min: number
}
export interface InstructorPeriod { planned: number; completed: number; taught: number; no_show: number; cancelled: number; postponed: number; scheduled_min: number; taught_min: number }
export interface Credits { purchased: number; used: number; remaining: number }
export interface StudentStats {
  month_start: string; month: Period; this_month: Period; week: Period; total: Period; credits: Credits
  next: { id: string; starts_at: string; ends_at: string; course_name: string } | null
  last: { id: string; starts_at: string; ends_at: string; course_name: string; attendance: SharedAttendance | null } | null
  by_course: { course: string; attended: number; attended_min: number }[]
  history: (Period & { month: string })[]
  lessons: StaffLesson[]
}
export interface InstructorStats {
  month_start: string; month: InstructorPeriod; today: InstructorPeriod; week: InstructorPeriod; this_month: InstructorPeriod; total: InstructorPeriod
  students: { id: string; name: string; is_active: boolean }[]
  history: (InstructorPeriod & { month: string })[]
  lessons: StaffLesson[]
}
export interface Overview { id: string; purchased: number; used: number; remaining: number; next_at: string | null; month_min: number; month_attended: number }
export interface Dashboard {
  active_students: number; instructors: number; today: number; today_completed: number; upcoming: number
  month_taught_min: number; month_completed: number; month_postponed: number; needs_attendance: number
  low_credit_threshold: number; low_credit: { id: string; name: string; remaining: number; purchased: number }[]
}
export interface ReportRow {
  lesson_id: string; starts_at: string; ends_at: string; course_name: string; student_id: string | null; student_name: string | null
  instructor_id: string | null; instructor_name: string | null; status: string; attendance: SharedAttendance | null
  scheduled_min: number; taught_min: number; attended_min: number; is_group: boolean
}

export type StaffInput = SharedInput & { student_ids: string[]; instructor_id: string | null }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('İnternet bağlantısı yok. Değişiklik KAYDEDİLMEDİ.')
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Sunucu yanıt vermedi. Lütfen tekrar deneyin.')), 20_000))
  const res = await Promise.race([supabase.rpc(fn, args), timeout])
  if (res.error) throw res.error
  return res.data as T
}

async function rows<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data as T
}

const STUDENT_COLS = 'id, full_name, public_label, phone, guardian_name, guardian_phone, registered_at, course_names, instructor_ids, package_name, total_lessons, default_duration, notes, is_active, version'
const INSTRUCTOR_COLS = 'id, full_name, public_label, phone, specialty, course_names, notes, is_active, version'

export const staff = {
  students: () => rows<StaffStudent[]>(supabase.from('students').select(STUDENT_COLS).order('full_name')),
  instructors: () => rows<StaffInstructor[]>(supabase.from('instructors').select(INSTRUCTOR_COLS).order('full_name')),
  availability: (iid?: string) => {
    const q = supabase.from('instructor_availability').select('*').order('weekday')
    return rows<Availability[]>(iid ? q.eq('instructor_id', iid) : q)
  },
  weekly: (sid: string) => rows<WeeklySlot[]>(supabase.from('weekly_schedules').select('*').eq('student_id', sid).order('weekday')),
  packages: (sid: string) => rows<Package[]>(supabase.from('lesson_packages').select('*').eq('student_id', sid).order('created_at', { ascending: false })),

  saveStudent: async (v: Partial<StaffStudent>, existing?: StaffStudent | null) => {
    if (existing) {
      const { version: _v, id: _i, ...patch } = v
      const { data, error } = await supabase.from('students').update(patch).eq('id', existing.id).eq('version', existing.version).select(STUDENT_COLS).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Bu kayıt başka bir cihazda değiştirildi. Kapatıp yeniden açın ve tekrar deneyin.')
      return data as unknown as StaffStudent
    }
    return rows<StaffStudent>(supabase.from('students').insert(v).select(STUDENT_COLS).single())
  },
  saveInstructor: async (v: Partial<StaffInstructor>, existing?: StaffInstructor | null) => {
    if (existing) {
      const { version: _v, id: _i, ...patch } = v
      const { data, error } = await supabase.from('instructors').update(patch).eq('id', existing.id).eq('version', existing.version).select(INSTRUCTOR_COLS).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('Bu kayıt başka bir cihazda değiştirildi. Kapatıp yeniden açın ve tekrar deneyin.')
      return data as unknown as StaffInstructor
    }
    return rows<StaffInstructor>(supabase.from('instructors').insert(v).select(INSTRUCTOR_COLS).single())
  },
  setAvailability: (iid: string, days: number[], start: string | null, end: string | null) =>
    rpc<null>('staff_set_availability', { p_iid: iid, p_days: days, p_start: start, p_end: end }),
  setWeekly: async (sid: string, slots: { weekday: number; start_time: string; duration_minutes: number; instructor_id: string | null }[]) => {
    await rows(supabase.from('weekly_schedules').delete().eq('student_id', sid))
    if (slots.length) await rows(supabase.from('weekly_schedules').insert(slots.map((s) => ({ ...s, student_id: sid }))))
  },
  addPackage: (sid: string, name: string, count: number, note: string, kind: 'paket' | 'duzeltme' = 'paket') =>
    rows(supabase.from('lesson_packages').insert({ student_id: sid, name, lesson_count: count, note: note || null, kind })),
  voidPackage: (id: string, reason: string) =>
    rows(supabase.from('lesson_packages').update({ is_void: true, void_reason: reason || 'İptal', voided_at: new Date().toISOString() }).eq('id', id)),

  create: (p: StaffInput, reqId: string) => rpc<{ created: number; first_id: string; duplicate?: boolean }>('staff_create', { p, p_request_id: reqId }),
  update: (l: Pick<SharedLesson, 'id' | 'version'>, p: Partial<StaffInput>, scope: SeriesScope = 'this') =>
    rpc<SharedLesson & { updated: number }>('staff_update', { p_id: l.id, p_version: l.version, p, p_scope: scope }),
  complete: (l: Pick<SharedLesson, 'id' | 'version'>, att: Record<string, SharedAttendance>) =>
    rpc<SharedLesson>('staff_complete', { p_id: l.id, p_version: l.version, p_att: att }),
  links: (ids: string[]) => rpc<{ id: string; student_ids: string[] | null; instructor_id: string | null; student_att: Record<string, SharedAttendance> | null }[]>('staff_links', { p_ids: ids }),
  studentStats: (sid: string, month?: string) => rpc<StudentStats>('staff_student_stats', { p_sid: sid, p_month: month ?? null }),
  instructorStats: (iid: string, month?: string) => rpc<InstructorStats>('staff_instructor_stats', { p_iid: iid, p_month: month ?? null }),
  overview: () => rpc<Overview[]>('staff_students_overview', {}),
  dashboard: () => rpc<Dashboard>('staff_dashboard', {}),
  report: (from: string, to: string, f: { student?: string | null; instructor?: string | null; course?: string | null } = {}) =>
    rpc<ReportRow[]>('staff_report', { p_from: from, p_to: to, p_student: f.student ?? null, p_instructor: f.instructor ?? null, p_course: f.course ?? null }),
}

/** "18 sa 30 dk" – dakikayı saat ve dakika olarak doğru gösterir */
export function hm(min: number | null | undefined): string {
  const m = Math.max(0, Math.round(min ?? 0))
  const h = Math.floor(m / 60), r = m % 60
  if (h === 0) return `${r} dk`
  return r === 0 ? `${h} sa` : `${h} sa ${r} dk`
}

export const ATT_LABEL: Record<SharedAttendance, string> = {
  katildi: 'Katıldı', katilmadi: 'Gelmedi', izinli: 'İzinli', gec_geldi: 'Geç geldi', erken_ayrildi: 'Erken ayrıldı',
}
export const ATT_ORDER: SharedAttendance[] = ['katildi', 'katilmadi', 'izinli', 'gec_geldi', 'erken_ayrildi']
export const STATUS_LABEL: Record<string, string> = { planlandi: 'Planlandı', tamamlandi: 'Tamamlandı', ertelendi: 'Ertelendi', iptal: 'İptal' }

/** Tablo dışa aktarma (Türkçe karakterler korunur): PDF, Excel, CSV */
export async function exportTable(kind: 'pdf' | 'xlsx' | 'csv', base: string, title: string, subtitle: string, headers: string[], data: (string | number)[][]) {
  const safe = base.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (kind === 'csv') return downloadCsv(safe, headers, data)
  if (kind === 'pdf') return downloadPdf(safe, title, subtitle, [{ headers, rows: data }], { landscape: headers.length > 6 })
  const { default: writeXlsxFile } = await import('write-excel-file')
  const sheet = [
    headers.map((h) => ({ value: h, fontWeight: 'bold' as const, backgroundColor: '#e2e8f0' })),
    ...data.map((r) => r.map((v) => ({ value: v }))),
  ]
  const blob = (await writeXlsxFile(sheet, { columns: headers.map(() => ({ width: 18 })), sheet: title.slice(0, 30) })) as unknown as Blob
  await saveOrShare(blob, `${safe}.xlsx`)
}
