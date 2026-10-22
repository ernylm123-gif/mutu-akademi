export type AppRole = 'admin' | 'egitmen' | 'personel'
export type LessonStatus = 'planlandi' | 'tamamlandi' | 'ertelendi' | 'iptal'
export type AttendanceStatus = 'katildi' | 'katilmadi' | 'izinli' | 'gec_geldi' | 'erken_ayrildi'
export type LessonType = 'bireysel' | 'grup' | 'online'
export type PostponeReason = 'ogrenci' | 'egitmen' | 'tatil' | 'saglik' | 'kurum' | 'diger'
export type PaymentMethod = 'nakit' | 'kart' | 'havale' | 'diger'
export type InstallmentStatus = 'odendi' | 'gecikti' | 'kismi' | 'bekliyor'

export interface Permissions {
  students?: boolean
  lessons?: boolean
  payments?: boolean
}

export interface Profile {
  id: string
  email: string
  full_name: string
  phone: string | null
  role: AppRole
  is_active: boolean
  approved: boolean
  permissions: Permissions
  is_device: boolean
  last_seen_at: string | null
  notification_prefs: NotificationPrefs
  created_at: string
  updated_at: string
}

export interface DeviceInvite {
  id: string
  label: string
  role: AppRole
  permissions: Permissions
  instructor_id: string | null
  created_by: string | null
  created_at: string
  expires_at: string
  used_at: string | null
  used_by: string | null
}

export interface NotificationPrefs {
  lesson_60?: boolean
  lesson_15?: boolean
  ders_iptal?: boolean
  ders_degisiklik?: boolean
  yeni_ogrenci?: boolean
  dusuk_ders_hakki?: boolean
  devamsizlik?: boolean
  yaklasan_odeme?: boolean
  gecikmis_odeme?: boolean
  yeni_tahsilat?: boolean
  quiet_enabled?: boolean
  quiet_start?: string
  quiet_end?: string
}

export interface Activity {
  id: number
  created_at: string
  table_name: string
  action: 'insert' | 'update' | 'delete'
  actor_name: string
  student_id: string | null
  student_name: string | null
  summary: Record<string, string | undefined>
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

export interface PushDelivery {
  id: string
  kind: string
  title: string
  status: 'pending' | 'claimed' | 'sent' | 'failed' | 'skipped' | 'expired'
  attempts: number
  created_at: string
  sent_at: string | null
  last_error: string | null
}

export interface AppSettings {
  id: number
  notify_rules: NotificationPrefs
  absence_consumes_credit: boolean
  low_credit_threshold: number
  payment_reminder_days: number
}

export interface Instructor {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  specialty: string | null
  color: string
  notes: string | null
  is_active: boolean
  profile_id: string | null
  created_at: string
  version: number
}

export interface Course {
  id: string
  name: string
  description: string | null
  default_lesson_count: number
  default_fee: number
  duration_minutes: number
  color: string
  is_active: boolean
}

export interface Student {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  birth_date: string | null
  guardian_name: string | null
  guardian_phone: string | null
  address: string | null
  course_id: string | null
  instructor_id: string | null
  total_lessons: number
  used_lessons: number
  remaining_lessons: number
  total_fee: number
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  version: number
}

export interface StudentNote {
  id: string
  student_id: string
  body: string
  author_id: string | null
  created_at: string
}

export interface WeeklySchedule {
  id: string
  student_id: string
  instructor_id: string | null
  weekday: number
  start_time: string
  duration_minutes: number
  is_active: boolean
}

export interface Lesson {
  id: string
  student_id: string
  instructor_id: string | null
  course_id: string | null
  schedule_id: string | null
  starts_at: string
  ends_at: string
  status: LessonStatus
  started_at: string | null
  credit_used: boolean
  rescheduled_from: string | null
  status_reason: string | null
  notes: string | null
  title: string | null
  room_id: string | null
  lesson_type: LessonType
  series_id: string | null
  group_id: string | null
  instructor_note: string | null
  admin_note: string | null
  postpone_reason: PostponeReason | null
  import_id: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface Room {
  id: string
  name: string
  capacity: number | null
  description: string | null
  is_active: boolean
}

export interface InstructorAvailability {
  id: string
  instructor_id: string
  weekday: number
  start_time: string
  end_time: string
}

export interface LessonPackage {
  id: string
  student_id: string
  kind: 'paket' | 'duzeltme'
  name: string
  lesson_count: number
  price: number
  fee_added: boolean
  purchased_at: string
  note: string | null
  is_void: boolean
  void_reason: string | null
  created_at: string
}

export interface ScheduleImport {
  id: string
  file_name: string | null
  total_rows: number
  created_count: number
  skipped_count: number
  summary: { problems?: { row: number; date?: string; reason: string }[]; new_students?: number } | null
  created_at: string
}

export interface LessonPreview {
  count: number
  conflict_count: number
  warning_count: number
  students: number
  lesson_type: LessonType
  occurrences: { starts_at: string; ends_at: string; conflicts: string[]; warnings: string[] }[]
}

export interface ScopeItem { id: string; starts_at: string; ends_at: string; student_name: string | null; status: LessonStatus }

export interface InstructorReport { id: string; name: string; total: number; completed: number; cancelled: number; postponed: number; absent: number; attended: number; hours: number }

export interface ReportSummary {
  active_students: number
  new_students: number
  today: number
  this_week: number
  this_month: number
  sessions: number
  planned: number
  completed: number
  cancelled: number
  postponed: number
  attendance_total: number
  absent: number
  excused: number
  late: number
  absence_rate: number
  hours: number
  by_instructor: InstructorReport[]
  postpone_reasons: Record<string, number>
  low_credit: { id: string; name: string; remaining: number; total: number }[]
  pending_payments: { students: number; amount: number; overdue: number; overdue_amount: number } | null
}

export interface Attendance {
  id: string
  lesson_id: string
  student_id: string
  status: AttendanceStatus
  note: string | null
  marked_by: string | null
  marked_at: string
}

export interface LessonWithRelations extends Lesson {
  student: Pick<Student, 'id' | 'full_name' | 'remaining_lessons' | 'phone'> | null
  instructor: Pick<Instructor, 'id' | 'full_name' | 'color'> | null
  course: Pick<Course, 'id' | 'name' | 'color'> | null
  room: Pick<Room, 'id' | 'name'> | null
  attendance: Pick<Attendance, 'id' | 'status' | 'note'> | null
}

export interface Payment {
  id: string
  student_id: string
  amount: number
  paid_at: string
  method: PaymentMethod
  note: string | null
  is_void: boolean
  void_reason: string | null
  created_at: string
  version: number
}

export interface InstallmentView {
  id: string
  student_id: string
  due_date: string
  amount: number
  note: string | null
  covered: number
  status: InstallmentStatus
}

export interface StudentBalance {
  student_id: string
  full_name: string
  total_fee: number
  paid: number
  balance: number
}

export interface AppNotification {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

export interface AuditLog {
  id: number
  table_name: string
  record_id: string | null
  action: 'insert' | 'update' | 'delete'
  actor_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}
