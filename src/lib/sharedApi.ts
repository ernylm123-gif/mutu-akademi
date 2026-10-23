// Girişsiz ORTAK ders alanı – yalnızca paylaşılabilir ders verisi (kişisel/finansal bilgi yok).
// Tüm yazmalar sunucudaki doğrulamalı RPC'lerden geçer (hız sınırı, işlem geçmişi, geri alma).
import { publicClient } from '@/lib/publicClient'

export type SharedStatus = 'planlandi' | 'tamamlandi' | 'ertelendi' | 'iptal'
export type SharedAttendance = 'katildi' | 'katilmadi' | 'izinli' | 'gec_geldi' | 'erken_ayrildi'

export interface SharedLesson {
  id: string
  course_name: string
  student_label: string | null
  instructor_name: string | null
  room: string | null
  title: string | null
  note: string | null
  is_group: boolean
  starts_at: string
  ends_at: string
  status: SharedStatus
  attendance: SharedAttendance | null
  started_at: string | null
  completed_at: string | null
  status_reason: string | null
  postpone_reason: string | null
  rescheduled_from: string | null
  series_id: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface SharedDetail extends SharedLesson {
  moved_to: { id: string; starts_at: string } | null
  history: { action: string; detail: Record<string, string> | null; at: string }[]
}

export interface SharedEvent { id: number; lesson_id: string | null; action: string; course_name: string | null; starts_at: string | null; detail: Record<string, string> | null; created_at: string }

export interface SharedInput {
  course_name: string
  student_label: string
  instructor_name: string
  room: string
  title: string
  note: string
  is_group: boolean
  date: string
  start: string
  end: string
  repeat_until?: string
}

export function requestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('İnternet bağlantısı yok. Değişiklik KAYDEDİLMEDİ.')
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Sunucu yanıt vermedi. Değişiklik kaydedilmemiş olabilir; listeyi kontrol edin.')), 15_000))
  const res = await Promise.race([publicClient.rpc(fn, args), timeout])
  if (res.error) throw res.error
  return res.data as T
}

export const shared = {
  list: (fromIso: string, toIso: string) => call<SharedLesson[]>('shared_list', { p_from: fromIso, p_to: toIso }),
  get: (id: string) => call<SharedDetail | null>('shared_get', { p_id: id }),
  events: (limit = 30) => call<SharedEvent[]>('shared_events', { p_limit: limit }),
  create: (p: SharedInput, reqId: string) => call<{ created: number; first_id: string }>('shared_create', { p, p_request_id: reqId }),
  update: (l: Pick<SharedLesson, 'id' | 'version'>, p: Partial<SharedInput>) => call<SharedLesson>('shared_update', { p_id: l.id, p_version: l.version, p }),
  postpone: (l: Pick<SharedLesson, 'id' | 'version'>, date: string, start: string, end: string, reason: string, note: string) =>
    call<{ new_id: string }>('shared_postpone', { p_id: l.id, p_version: l.version, p_date: date, p_start: start, p_end: end, p_reason: reason, p_note: note || null }),
  cancel: (l: Pick<SharedLesson, 'id' | 'version'>, reason: string) => call<SharedLesson>('shared_cancel', { p_id: l.id, p_version: l.version, p_reason: reason || null }),
  restore: (l: Pick<SharedLesson, 'id' | 'version'>) => call<SharedLesson>('shared_restore', { p_id: l.id, p_version: l.version }),
  start: (l: Pick<SharedLesson, 'id' | 'version'>) => call<SharedLesson>('shared_start', { p_id: l.id, p_version: l.version }),
  complete: (l: Pick<SharedLesson, 'id' | 'version'>, attendance: SharedAttendance) => call<SharedLesson>('shared_complete', { p_id: l.id, p_version: l.version, p_attendance: attendance }),
  reopen: (l: Pick<SharedLesson, 'id' | 'version'>) => call<SharedLesson>('shared_reopen', { p_id: l.id, p_version: l.version }),
  remove: (l: Pick<SharedLesson, 'id' | 'version'>) => call<{ deleted: string }>('shared_delete', { p_id: l.id, p_version: l.version }),
  undelete: (id: string) => call<SharedLesson>('shared_undelete', { p_id: id }),
  setPrefs: (endpoint: string, prefs: Record<string, unknown>) => call<null>('set_public_push_prefs', { p_endpoint: endpoint, p_prefs: prefs }),
  getPrefs: (endpoint: string) => call<Record<string, unknown> | null>('get_public_push_prefs', { p_endpoint: endpoint }),
}

export const ACTION_TEXT: Record<string, string> = {
  olusturuldu: 'Ders eklendi', duzenlendi: 'Ders düzenlendi', saat_degisti: 'Ders saati değişti', ertelendi: 'Ders ertelendi',
  iptal: 'Ders iptal edildi', iptal_geri_alindi: 'İptal geri alındı', basladi: 'Ders başladı', tamamlandi: 'Ders tamamlandı',
  yoklama_degisti: 'Yoklama güncellendi', tamamlama_geri_alindi: 'Tamamlama geri alındı', silindi: 'Ders silindi', silme_geri_alindi: 'Silme geri alındı',
}
