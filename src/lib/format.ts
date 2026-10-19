import type { AttendanceStatus, InstallmentStatus, LessonStatus, PaymentMethod, AppRole } from '@/types/db'

const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 })
export const formatMoney = (n: number | string | null | undefined) => money.format(Number(n ?? 0))

export type Tone = 'brand' | 'green' | 'red' | 'amber' | 'slate' | 'accent'

export const ROLE_LABEL: Record<AppRole, string> = { admin: 'Yönetici', egitmen: 'Eğitmen', personel: 'Personel' }

export const LESSON_STATUS: Record<LessonStatus, { label: string; tone: Tone }> = {
  planlandi: { label: 'Planlandı', tone: 'brand' },
  tamamlandi: { label: 'Tamamlandı', tone: 'green' },
  ertelendi: { label: 'Ertelendi', tone: 'amber' },
  iptal: { label: 'İptal', tone: 'slate' },
}

export const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  katildi: { label: 'Katıldı', tone: 'green' },
  katilmadi: { label: 'Katılmadı', tone: 'red' },
  izinli: { label: 'İzinli', tone: 'amber' },
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
