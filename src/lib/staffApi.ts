// Ortak çalışma alanı: öğrenci/eğitmen yönetimi ve sunucuda hesaplanan istatistikler (girişsiz, tek arayüz).
// Bu alanda yalnızca hassas olmayan veri vardır (ad, kurs, ders hakkı, program); telefon/veli/ödeme yoktur.
// Tüm yazmalar sunucudaki doğrulamalı RPC'lerden geçer (hız sınırı, işlem geçmişi, sürüm kontrolü).
import { publicClient } from '@/lib/publicClient'
import { downloadCsv, saveOrShare } from '@/lib/csv'
import { downloadPdf } from '@/lib/pdf'
import { shared, type SharedAttendance, type SharedInput, type SharedLesson, type SeriesScope } from '@/lib/sharedApi'

export interface WeeklyItem { weekday: number; start: string; duration: number }

export interface StaffStudent {
  id: string
  full_name: string
  public_label: string
  registered_at: string
  course_names: string[]
  instructor_ids: string[]
  package_name: string | null
  total_lessons: number
  default_duration: number
  weekly: WeeklyItem[]
  is_active: boolean
  version: number
}

export interface StaffInstructor {
  id: string
  full_name: string
  public_label: string
  specialty: string | null
  course_names: string[]
  work_days: number[]
  work_start: string | null
  work_end: string | null
  is_active: boolean
  version: number
}

export interface Package { id: string; student_id: string; kind: 'paket' | 'duzeltme'; name: string; lesson_count: number; note: string | null; is_void: boolean; created_at: string }

export interface StaffLesson extends SharedLesson { my_att?: SharedAttendance | null }

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
export interface Overview { id: string; purchased: number; used: number; remaining: number; next_at: string | null; month_min: number }
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
  const res = await Promise.race([publicClient.rpc(fn, args), timeout])
  if (res.error) throw res.error
  return res.data as T
}

type RawStudent = { id: string; name: string; courses: string[]; instructor_ids: string[]; package_name: string | null; default_duration: number; registered_at: string
  weekly: WeeklyItem[]; is_active: boolean; version: number; purchased: number; used: number; remaining: number; next_at: string | null; month_min: number | null }
type RawInstructor = { id: string; name: string; specialty: string | null; courses: string[]; work_days: number[]; work_start: string | null; work_end: string | null; is_active: boolean; version: number }

const toStudent = (s: RawStudent): StaffStudent => ({
  id: s.id, full_name: s.name, public_label: s.name, registered_at: s.registered_at, course_names: s.courses ?? [], instructor_ids: s.instructor_ids ?? [],
  package_name: s.package_name, total_lessons: s.purchased ?? 0, default_duration: s.default_duration, weekly: s.weekly ?? [], is_active: s.is_active, version: s.version,
})
const toInstructor = (i: RawInstructor): StaffInstructor => ({
  id: i.id, full_name: i.name, public_label: i.name, specialty: i.specialty, course_names: i.courses ?? [], work_days: i.work_days ?? [],
  work_start: i.work_start?.slice(0, 5) ?? null, work_end: i.work_end?.slice(0, 5) ?? null, is_active: i.is_active, version: i.version,
})

export interface StudentInput {
  name: string; courses: string[]; instructor_ids: string[]; package_name: string | null; default_duration: number; registered_at: string
  weekly: WeeklyItem[]; is_active: boolean; total_credits: number
}
export interface InstructorInput { name: string; specialty: string | null; courses: string[]; work_days: number[]; work_start: string | null; work_end: string | null; is_active: boolean }

export const staff = {
  directory: async () => {
    const d = await rpc<{ students: RawStudent[]; instructors: RawInstructor[] }>('ws_directory', {})
    return {
      students: d.students.map(toStudent),
      instructors: d.instructors.map(toInstructor),
      overview: d.students.map((s): Overview => ({ id: s.id, purchased: s.purchased, used: s.used, remaining: s.remaining, next_at: s.next_at, month_min: s.month_min ?? 0 })),
    }
  },
  packages: (sid: string) => rpc<Package[]>('ws_packages_of', { p_sid: sid }),
  saveStudent: async (v: StudentInput, existing?: StaffStudent | null) =>
    toStudent(await rpc<RawStudent>('ws_save_student', { p: v, p_id: existing?.id ?? null, p_version: existing?.version ?? null })),
  saveInstructor: async (v: InstructorInput, existing?: StaffInstructor | null) =>
    toInstructor(await rpc<RawInstructor>('ws_save_instructor', { p: v, p_id: existing?.id ?? null, p_version: existing?.version ?? null })),
  addPackage: (sid: string, name: string, count: number, note: string) => rpc('ws_add_package', { p_sid: sid, p_name: name, p_count: count, p_note: note || null }),
  voidPackage: (id: string) => rpc('ws_void_package', { p_id: id }),

  create: (p: StaffInput, reqId: string) => rpc<{ created: number; first_id: string; duplicate?: boolean }>('ws_create', { p, p_request_id: reqId }),
  update: (l: Pick<SharedLesson, 'id' | 'version'>, p: Partial<StaffInput>, scope: SeriesScope = 'this') =>
    rpc<SharedLesson & { updated: number }>('ws_update', { p_id: l.id, p_version: l.version, p, p_scope: scope }),
  complete: (l: Pick<SharedLesson, 'id' | 'version'>, att: Record<string, SharedAttendance>) =>
    rpc<SharedLesson>('ws_complete', { p_id: l.id, p_version: l.version, p_att: att }),
  links: async (ids: string[]) => {
    const d = ids[0] ? await shared.get(ids[0]) : null
    return d ? [{ id: d.id, student_ids: d.ws_student_ids ?? [], instructor_id: d.ws_instructor_id ?? null, student_att: d.ws_att ?? null }] : []
  },
  studentStats: (sid: string, month?: string) => rpc<StudentStats>('ws_student_stats', { p_sid: sid, p_month: month ?? null }),
  instructorStats: (iid: string, month?: string) => rpc<InstructorStats>('ws_instructor_stats', { p_iid: iid, p_month: month ?? null }),
  dashboard: () => rpc<Dashboard>('ws_dashboard', {}),
  report: (from: string, to: string, f: { student?: string | null; instructor?: string | null; course?: string | null } = {}) =>
    rpc<ReportRow[]>('ws_report', { p_from: from, p_to: to, p_student: f.student ?? null, p_instructor: f.instructor ?? null, p_course: f.course ?? null }),
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
