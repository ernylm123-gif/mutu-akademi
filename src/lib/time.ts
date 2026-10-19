// Tüm tarih/saat hesapları Europe/Istanbul saat dilimine göre yapılır.
// "Gün anahtarı" (YYYY-MM-DD) İstanbul'daki takvim gününü temsil eder.
export const TZ = 'Europe/Istanbul'

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export function istanbulParts(input: Date | string) {
  const d = typeof input === 'string' ? new Date(input) : input
  const p: Record<string, string> = {}
  for (const part of partsFmt.formatToParts(d)) p[part.type] = part.value
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function dateKey(input: Date | string = new Date()): string {
  const p = istanbulParts(input)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

export function timeHM(input: Date | string): string {
  const p = istanbulParts(input)
  return `${pad(p.hh)}:${pad(p.mm)}`
}

/** İstanbul yerel tarih + saatinden gerçek UTC anını üretir. */
export function fromIstanbul(key: string, hm = '00:00'): Date {
  const [y, m, d] = key.split('-').map(Number)
  const [hh, mm] = hm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const p = istanbulParts(new Date(guess))
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm)
  return new Date(guess - (asIfUtc - guess))
}

function keyToUtcNoon(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}
function utcNoonToKey(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(key: string, n: number): string {
  const d = keyToUtcNoon(key)
  d.setUTCDate(d.getUTCDate() + n)
  return utcNoonToKey(d)
}

export function addMonths(key: string, n: number): string {
  const d = keyToUtcNoon(key)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return utcNoonToKey(d)
}

/** ISO haftanın günü: 1 = Pazartesi … 7 = Pazar */
export function isoWeekday(key: string): number {
  const wd = keyToUtcNoon(key).getUTCDay()
  return wd === 0 ? 7 : wd
}

export function startOfWeek(key: string): string {
  return addDays(key, 1 - isoWeekday(key))
}

export function startOfMonth(key: string): string {
  return key.slice(0, 8) + '01'
}

/** Ay görünümü için Pazartesi başlayan 6 haftalık ızgara */
export function monthGrid(key: string): string[] {
  const start = startOfWeek(startOfMonth(key))
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function diffDays(a: string, b: string): number {
  return Math.round((keyToUtcNoon(a).getTime() - keyToUtcNoon(b).getTime()) / 86400000)
}

export const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
export const WEEKDAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

export function formatDayLong(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}, ${WEEKDAYS[isoWeekday(key) - 1]}`
}

export function formatDayShort(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

export function formatDate(input: string | null | undefined): string {
  if (!input) return '—'
  const key = input.length === 10 ? input : dateKey(input)
  const [y, m, d] = key.split('-')
  return `${d}.${m}.${y}`
}

export function formatDateTime(input: string): string {
  return `${formatDate(input)} ${timeHM(input)}`
}

export function relativeTime(input: string, now = new Date()): string {
  const diff = (now.getTime() - new Date(input).getTime()) / 1000
  if (diff < 60) return 'az önce'
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} gün önce`
  return formatDate(input)
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
}
