import type { AttendanceStatus, LessonStatus } from '@/types/db'

// Ders hakkı kuralı – veritabanındaki private.refresh_student_usage ile birebir aynıdır.
// Asıl hesap sunucuda yapılır; bu fonksiyon yalnızca arayüzde ön bilgi göstermek ve test için vardır.
export function consumesCredit(
  lessonStatus: LessonStatus,
  attendance: AttendanceStatus | null | undefined,
  absenceConsumesCredit: boolean,
): boolean {
  if (lessonStatus !== 'tamamlandi' || !attendance) return false
  if (attendance === 'katildi' || attendance === 'gec_geldi' || attendance === 'erken_ayrildi') return true
  if (attendance === 'katilmadi') return absenceConsumesCredit
  return false
}

export function remainingCredits(total: number, lessons: { status: LessonStatus; attendance: AttendanceStatus | null }[], absence: boolean) {
  const used = lessons.filter((l) => consumesCredit(l.status, l.attendance, absence)).length
  return { used, remaining: total - used }
}

/** Yoklama sonrası dersin alacağı durum (sunucudaki mark_attendance ile aynı): ders gerçekleşmiştir;
 *  öğrencinin izinli olması dersin planlama durumunu değiştirmez, yalnızca hak düşmez. */
export function lessonStatusAfterAttendance(_a: AttendanceStatus): LessonStatus {
  return 'tamamlandi'
}

export interface Interval { start: number; end: number }
export function overlaps(a: Interval, b: Interval) {
  return a.start < b.end && b.start < a.end
}
