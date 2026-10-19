import type { Activity } from '@/types/db'
import { formatDateTime, formatDate, timeHM } from '@/lib/time'
import { formatMoney } from '@/lib/format'

export type ActivityKind = 'student' | 'lesson-done' | 'lesson-time' | 'lesson-cancel' | 'lesson-postpone' | 'lesson' | 'attendance' | 'payment' | 'note' | 'other'

const ATT: Record<string, string> = { katildi: 'katıldı', katilmadi: 'derse gelmedi', izinli: 'izinli' }

/** Audit kaydını okunabilir Türkçe cümleye çevirir. */
export function describeActivity(a: Activity): { text: string; kind: ActivityKind; detail?: string } {
  const s = a.summary ?? {}
  const who = a.student_name ?? s.full_name ?? 'Öğrenci'
  const poss = `${who}'in`
  switch (a.table_name) {
    case 'students':
      if (a.action === 'insert') return { text: `Yeni öğrenci eklendi: ${who}`, kind: 'student' }
      if (a.action === 'delete') return { text: `Öğrenci silindi: ${who}`, kind: 'student' }
      return { text: `${poss} bilgileri güncellendi`, kind: 'student' }
    case 'lessons': {
      const when = s.starts_at ? `${formatDate(s.starts_at)} ${timeHM(s.starts_at)}` : ''
      if (a.action === 'insert') return { text: `${who} için ders oluşturuldu`, kind: 'lesson', detail: when }
      if (a.action === 'delete') return { text: `${poss} dersi silindi`, kind: 'lesson-cancel', detail: when }
      if (s.old_status !== s.status) {
        if (s.status === 'tamamlandi') return { text: `${poss} dersi tamamlandı`, kind: 'lesson-done', detail: when }
        if (s.status === 'iptal') return { text: `${poss} dersi iptal edildi`, kind: 'lesson-cancel', detail: when }
        if (s.status === 'ertelendi') return { text: `${poss} dersi ertelendi`, kind: 'lesson-postpone', detail: when }
        if (s.status === 'planlandi') return { text: `${poss} dersi yeniden planlandı`, kind: 'lesson', detail: when }
      }
      if (s.old_starts_at && s.starts_at) {
        return { text: `${poss} ders saati değiştirildi`, kind: 'lesson-time', detail: `${formatDateTime(s.old_starts_at)} → ${formatDateTime(s.starts_at)}` }
      }
      if (s.started_at && !s.old_started_at) return { text: `${poss} dersi başladı`, kind: 'lesson', detail: when }
      return { text: `${poss} dersi güncellendi`, kind: 'lesson', detail: when }
    }
    case 'attendance':
      if (a.action === 'delete') return { text: `${poss} yoklaması geri alındı`, kind: 'attendance' }
      return { text: `Yoklama: ${who} ${ATT[s.status ?? ''] ?? s.status ?? ''}`, kind: 'attendance' }
    case 'payments':
      if (a.action === 'update' && s.is_void === 'true') return { text: `${who} için ödeme iptal edildi`, kind: 'payment' }
      return { text: `${who} için ödeme kaydedildi`, kind: 'payment', detail: s.amount ? formatMoney(s.amount) : undefined }
    case 'installments':
      return { text: a.action === 'delete' ? `${who} için taksit silindi` : `${who} için taksit planlandı`, kind: 'payment' }
    case 'weekly_schedules':
      return { text: a.action === 'delete' ? `${poss} haftalık programı kaldırıldı` : `${who} için haftalık program eklendi`, kind: 'lesson' }
    case 'student_notes':
      return { text: `${who} için not eklendi`, kind: 'note' }
    case 'instructors':
      return { text: a.action === 'insert' ? `Yeni eğitmen: ${s.full_name ?? ''}` : `Eğitmen güncellendi: ${s.full_name ?? ''}`, kind: 'other' }
    case 'courses':
      return { text: a.action === 'insert' ? `Yeni kurs: ${s.name ?? ''}` : `Kurs güncellendi: ${s.name ?? ''}`, kind: 'other' }
  }
  return { text: `${a.table_name} ${a.action}`, kind: 'other' }
}

const HIDDEN = new Set(['id', 'version', 'updated_at', 'created_at', 'created_by', 'used_lessons', 'remaining_lessons', 'credit_used'])

/** Yönetici için eski → yeni alan farkları */
export function activityDiff(a: Activity): { field: string; from: string; to: string }[] {
  if (a.action !== 'update' || !a.old_data || !a.new_data) return []
  return Object.keys(a.new_data)
    .filter((k) => !HIDDEN.has(k) && JSON.stringify(a.new_data![k]) !== JSON.stringify(a.old_data![k]))
    .map((k) => ({ field: k, from: fmt(a.old_data![k]), to: fmt(a.new_data![k]) }))
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export const FIELD_LABEL: Record<string, string> = {
  full_name: 'Ad', phone: 'Telefon', starts_at: 'Başlangıç', ends_at: 'Bitiş', status: 'Durum', status_reason: 'Neden',
  instructor_id: 'Eğitmen', course_id: 'Kurs', total_lessons: 'Toplam hak', total_fee: 'Ücret', is_active: 'Aktif',
  notes: 'Not', amount: 'Tutar', is_void: 'İptal', started_at: 'Başlama', guardian_phone: 'Veli tel.', guardian_name: 'Veli',
}
