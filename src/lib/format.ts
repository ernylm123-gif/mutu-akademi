import type { AttendanceStatus, InstallmentStatus, LessonStatus, LessonType, PaymentMethod, PostponeReason, AppRole } from '@/types/db'

const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 })
export const formatMoney = (n: number | string | null | undefined) => money.format(Number(n ?? 0))

export type Tone = 'brand' | 'green' | 'red' | 'amber' | 'slate' | 'accent'

export const ROLE_LABEL: Record<AppRole, string> = { admin: 'Yönetici', egitmen: 'Eğitmen', personel: 'Personel' }

export const LESSON_STATUS: Record<LessonStatus, { label: string; tone: Tone }> = {
  planlandi: { label: 'Planlandı', tone: 'brand' },
  tamamlandi: { label: 'Tamamlandı', tone: 'green' },
  ertelendi: { label: 'Ertelendi', tone: 'amber' },
  iptal: { label: 'İptal edildi', tone: 'red' },
}

export const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  katildi: { label: 'Katıldı', tone: 'green' },
  katilmadi: { label: 'Katılmadı', tone: 'red' },
  izinli: { label: 'İzinli', tone: 'amber' },
  gec_geldi: { label: 'Geç geldi', tone: 'brand' },
  erken_ayrildi: { label: 'Erken ayrıldı', tone: 'accent' },
}

export const ATTENDANCE_ORDER: AttendanceStatus[] = ['katildi', 'katilmadi', 'izinli', 'gec_geldi', 'erken_ayrildi']

export const LESSON_TYPE: Record<LessonType, string> = { bireysel: 'Bireysel', grup: 'Grup', online: 'Online' }

export const POSTPONE_REASON: Record<PostponeReason, string> = {
  ogrenci: 'Öğrenci talebi', egitmen: 'Eğitmen talebi', tatil: 'Resmi tatil', saglik: 'Sağlık/mazeret', kurum: 'Kurum kaynaklı', diger: 'Diğer',
}

/** Planlama durumu + zamana göre görünen durum (Yaklaşıyor / Devam ediyor hesaplanır) */
export function displayStatus(l: { status: LessonStatus; starts_at: string; ends_at: string; started_at?: string | null }, now = Date.now()) {
  if (l.status !== 'planlandi') return LESSON_STATUS[l.status]
  const s = new Date(l.starts_at).getTime(), e = new Date(l.ends_at).getTime()
  if (l.started_at || (now >= s && now < e)) return { label: 'Devam ediyor', tone: 'accent' as Tone }
  if (s > now && s - now <= 2 * 3600_000) return { label: 'Yaklaşıyor', tone: 'amber' as Tone }
  return LESSON_STATUS.planlandi
}

export const INSTALLMENT_STATUS: Record<InstallmentStatus, { label: string; tone: Tone }> = {
  odendi: { label: 'Ödendi', tone: 'green' },
  kismi: { label: 'Kısmi', tone: 'amber' },
  bekliyor: { label: 'Bekliyor', tone: 'brand' },
  gecikti: { label: 'Gecikti', tone: 'red' },
}

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  nakit: 'Nakit', kart: 'Kredi kartı', havale: 'Havale / EFT', diger: 'Diğer',
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toLocaleUpperCase('tr-TR') ?? '').join('')
}

export function trNormalize(s: string): string {
  return s.toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
}

export function matchesSearch(haystack: (string | null | undefined)[], q: string): boolean {
  const needle = trNormalize(q.trim())
  if (!needle) return true
  return haystack.some((h) => h && trNormalize(h).includes(needle))
}

export function telHref(phone: string | null | undefined) {
  return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined
}

/** WhatsApp bağlantısı – Türkiye numaralarını uluslararası biçime çevirir (05xx → 905xx) */
export function waHref(phone: string | null | undefined) {
  if (!phone) return undefined
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('0')) d = '90' + d.slice(1)
  else if (d.length === 10 && d.startsWith('5')) d = '90' + d
  return `https://wa.me/${d}`
}
