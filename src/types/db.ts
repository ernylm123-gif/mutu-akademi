export type AppRole = 'admin' | 'egitmen' | 'personel'
export type LessonStatus = 'planlandi' | 'tamamlandi' | 'ertelendi' | 'iptal'
export type AttendanceStatus = 'katildi' | 'katilmadi' | 'izinli'
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

export interface AppSettings {
  id: number
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
  credit_used: boolean
  rescheduled_from: string | null
  status_reason: string | null
  notes: string | null
  created_at: string
  updated_at: string
  version: number
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
