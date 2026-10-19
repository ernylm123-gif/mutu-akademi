import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { assertOnline, ConflictError, errorMessage } from '@/lib/errors'
import { useToast } from '@/components/ui/Toast'
import type {
  AppNotification, AppSettings, AuditLog, Course, InstallmentView, Instructor, LessonWithRelations,
  Payment, Profile, DeviceInvite, Student, StudentBalance, StudentNote, WeeklySchedule, AttendanceStatus, Lesson,
} from '@/types/db'

// ---------------------------------------------------------------------------
// Sorgu anahtarları ve Realtime eşlemesi
// ---------------------------------------------------------------------------
export const TABLE_KEYS: Record<string, string[]> = {
  students: ['students', 'student', 'balances', 'lessons', 'student-lessons', 'reports'],
  lessons: ['lessons', 'student-lessons', 'students', 'student', 'reports'],
  attendance: ['lessons', 'student-lessons', 'students', 'student', 'reports'],
  payments: ['payments', 'installments', 'balances', 'reports'],
  installments: ['installments', 'balances'],
  notifications: ['notifications'],
  instructors: ['instructors', 'lessons', 'students'],
  courses: ['courses', 'students', 'lessons'],
  profiles: ['profiles', 'instructors'],
  weekly_schedules: ['schedules'],
  student_notes: ['student-notes'],
  app_settings: ['settings', 'students'],
  device_invites: ['invites'],
}

const LESSON_SELECT =
  '*, student:students(id,full_name,remaining_lessons,phone), instructor:instructors(id,full_name,color), course:courses(id,name,color), attendance(id,status,note)'

function normalizeLesson(row: Record<string, unknown>): LessonWithRelations {
  const att = row.attendance
  return { ...(row as unknown as LessonWithRelations), attendance: Array.isArray(att) ? (att[0] ?? null) : (att as LessonWithRelations['attendance']) ?? null }
}

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data as T
}

// ---------------------------------------------------------------------------
// Sorgular
// ---------------------------------------------------------------------------
export const useStudents = () =>
  useQuery({
    queryKey: ['students'],
    queryFn: () => unwrap<Student[]>(supabase.from('students').select('*').order('full_name')),
  })

export const useStudent = (id: string | undefined) =>
  useQuery({
    queryKey: ['student', id],
    enabled: !!id,
    queryFn: () => unwrap<Student | null>(supabase.from('students').select('*').eq('id', id!).maybeSingle()),
  })

export const useInstructors = () =>
  useQuery({
    queryKey: ['instructors'],
    queryFn: () => unwrap<Instructor[]>(supabase.from('instructors').select('*').order('full_name')),
  })

export const useCourses = () =>
  useQuery({
    queryKey: ['courses'],
    queryFn: () => unwrap<Course[]>(supabase.from('courses').select('*').order('name')),
  })

export const useProfiles = (enabled = true) =>
  useQuery({
    queryKey: ['profiles'],
    enabled,
    queryFn: () => unwrap<Profile[]>(supabase.from('profiles').select('*').order('created_at')),
  })

export const useInvites = (enabled = true) =>
  useQuery({
    queryKey: ['invites'],
    enabled,
    queryFn: () =>
      unwrap<DeviceInvite[]>(
        supabase.from('device_invites').select('id,label,role,permissions,instructor_id,created_by,created_at,expires_at,used_at,used_by').order('created_at', { ascending: false }).limit(50),
      ),
  })

export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: () => unwrap<AppSettings | null>(supabase.from('app_settings').select('*').eq('id', 1).maybeSingle()),
  })

/** Tarih aralığındaki dersler (ISO zaman damgaları, [from, to)) */
export const useLessons = (fromIso: string, toIso: string, opts: { instructorId?: string | null } = {}) =>
  useQuery({
    queryKey: ['lessons', fromIso, toIso, opts.instructorId ?? null],
    queryFn: async () => {
      let q = supabase.from('lessons').select(LESSON_SELECT).gte('starts_at', fromIso).lt('starts_at', toIso).order('starts_at')
      if (opts.instructorId) q = q.eq('instructor_id', opts.instructorId)
      const rows = await unwrap<Record<string, unknown>[]>(q)
      return rows.map(normalizeLesson)
    },
  })

export const useStudentLessons = (studentId: string | undefined) =>
  useQuery({
    queryKey: ['student-lessons', studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const rows = await unwrap<Record<string, unknown>[]>(
        supabase.from('lessons').select(LESSON_SELECT).eq('student_id', studentId!).order('starts_at', { ascending: false }).limit(500),
      )
      return rows.map(normalizeLesson)
    },
  })

export const useSchedules = (studentId: string | undefined) =>
  useQuery({
    queryKey: ['schedules', studentId],
    enabled: !!studentId,
    queryFn: () =>
      unwrap<WeeklySchedule[]>(supabase.from('weekly_schedules').select('*').eq('student_id', studentId!).order('weekday').order('start_time')),
  })

export const useStudentNotes = (studentId: string | undefined) =>
  useQuery({
    queryKey: ['student-notes', studentId],
    enabled: !!studentId,
    queryFn: () =>
      unwrap<StudentNote[]>(supabase.from('student_notes').select('*').eq('student_id', studentId!).order('created_at', { ascending: false })),
  })

export const usePayments = (studentId?: string, enabled = true) =>
  useQuery({
    queryKey: ['payments', studentId ?? 'all'],
    enabled,
    queryFn: () => {
      let q = supabase.from('payments').select('*').order('paid_at', { ascending: false }).order('created_at', { ascending: false })
      if (studentId) q = q.eq('student_id', studentId)
      else q = q.limit(1000)
      return unwrap<Payment[]>(q)
    },
  })

export const useInstallments = (studentId?: string, enabled = true) =>
  useQuery({
    queryKey: ['installments', studentId ?? 'all'],
    enabled,
    queryFn: () => {
      let q = supabase.from('v_installments').select('*').order('due_date')
      if (studentId) q = q.eq('student_id', studentId)
      return unwrap<InstallmentView[]>(q)
    },
  })

export const useBalances = (enabled = true) =>
  useQuery({
    queryKey: ['balances'],
    enabled,
    queryFn: () => unwrap<StudentBalance[]>(supabase.from('v_student_balances').select('*')),
  })

export const useNotifications = (userId: string | undefined) =>
  useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId,
    queryFn: () =>
      unwrap<AppNotification[]>(
        supabase.from('notifications').select('*').eq('user_id', userId!).order('created_at', { ascending: false }).limit(200),
      ),
  })

export const useAuditLogs = (enabled: boolean, limit = 50) =>
  useQuery({
    queryKey: ['audit', limit],
    enabled,
    queryFn: () => unwrap<AuditLog[]>(supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit)),
  })

// ---------------------------------------------------------------------------
// Değişiklikler – her zaman sunucu onayından sonra başarı gösterilir
// ---------------------------------------------------------------------------
export function useDbMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult, v: TVars) => string); invalidate?: string[]; onSuccess?: (r: TResult, v: TVars) => void } = {},
) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    networkMode: 'always', // çevrimdışıyken sessizce kuyruğa alma; hemen hata ver
    mutationFn: async (vars: TVars) => {
      assertOnline()
      return fn(vars)
    },
    onSuccess: (r, v) => {
      const msg = typeof opts.success === 'function' ? opts.success(r, v) : opts.success
      if (msg) toast.success(msg)
      opts.onSuccess?.(r, v)
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => {
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: [k] as QueryKey })
    },
  })
}

/** Optimistic locking ile güncelleme: sürüm uyuşmazsa ConflictError fırlatır. */
export async function updateVersioned<T>(table: string, id: string, version: number, patch: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).eq('version', version).select().maybeSingle()
  if (error) throw error
  if (!data) throw new ConflictError()
  return data as T
}

export async function insertRow<T>(table: string, row: Record<string, unknown>): Promise<T> {
  return unwrap<T>(supabase.from(table).insert(row).select().single())
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return unwrap<T>(supabase.rpc(fn, args))
}

export const lessonRpc = {
  mark: (l: Pick<Lesson, 'id' | 'version'>, status: AttendanceStatus, note?: string | null) =>
    rpc<Lesson>('mark_attendance', { p_lesson_id: l.id, p_status: status, p_expected_version: l.version, p_note: note ?? null }),
  clear: (l: Pick<Lesson, 'id' | 'version'>) => rpc<Lesson>('clear_attendance', { p_lesson_id: l.id, p_expected_version: l.version }),
  cancel: (l: Pick<Lesson, 'id' | 'version'>, reason?: string | null) =>
    rpc<Lesson>('cancel_lesson', { p_lesson_id: l.id, p_expected_version: l.version, p_reason: reason ?? null }),
  reschedule: (l: Pick<Lesson, 'id' | 'version'>, newStart: Date, reason?: string | null) =>
    rpc<Lesson>('reschedule_lesson', { p_lesson_id: l.id, p_expected_version: l.version, p_new_start: newStart.toISOString(), p_reason: reason ?? null }),
  generate: (scheduleId: string, from: string, until: string) =>
    rpc<{ created: number; skipped: number }>('generate_schedule_lessons', { p_schedule_id: scheduleId, p_from: from, p_until: until }),
}

/** Yönetici kullanıcı işlemleri – service role anahtarı yalnızca Edge Function içinde kullanılır. */
export async function adminUsers<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json()
        if (j?.error) msg = j.error
      } catch { /* yoksay */ }
    }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}
