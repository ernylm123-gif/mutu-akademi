// Tablo (Excel/CSV) içe aktarma: sütun algılama, eşleştirme ve satır ayrıştırma.
// Belirsiz/eksik veri TAHMİN EDİLMEZ; sorunlu satır işaretlenir.
import { trNormalize } from '@/lib/format'

export type ImportField = 'ogrenci' | 'egitmen' | 'kurs' | 'gun' | 'tarih' | 'baslangic' | 'bitis' | 'sure' | 'sinif' | 'konu'

export const FIELD_LABEL: Record<ImportField, string> = {
  ogrenci: 'Öğrenci adı', egitmen: 'Eğitmen', kurs: 'Kurs', gun: 'Ders günü', tarih: 'Tarih',
  baslangic: 'Başlangıç saati', bitis: 'Bitiş saati', sure: 'Ders süresi (dk)', sinif: 'Sınıf', konu: 'Ders konusu',
}

const HINTS: Record<ImportField, RegExp> = {
  ogrenci: /^(ogrenci|ogrenci adi|ad soyad|adi soyadi|isim|ad|student)/,
  egitmen: /^(egitmen|ogretmen|hoca|instructor|teacher)/,
  kurs: /^(kurs|ders adi|brans|course|egitim)/,
  gun: /^(gun|ders gunu|day)$/,
  tarih: /^(tarih|ders tarihi|date)/,
  baslangic: /^(baslangic|baslama|giris|saat|start|bas)/,
  bitis: /^(bitis|cikis|end|son)/,
  sure: /^(sure|dakika|dk|duration)/,
  sinif: /^(sinif|oda|derslik|salon|room)/,
  konu: /^(konu|baslik|aciklama|topic)/,
}

export type Mapping = Partial<Record<ImportField, number>>

/** İlk 5 satırda başlık satırını ve sütun eşleşmesini arar */
export function detectMapping(rows: unknown[][]): { headerRow: number; mapping: Mapping } | null {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const mapping: Mapping = {}
    rows[r].forEach((cell, c) => {
      const h = trNormalize(String(cell ?? '')).replace(/[^a-z ]/g, '').trim()
      if (!h) return
      for (const f of Object.keys(HINTS) as ImportField[]) {
        if (mapping[f] === undefined && HINTS[f].test(h)) { mapping[f] = c; break }
      }
    })
    if (Object.keys(mapping).length >= 2 && mapping.ogrenci !== undefined) return { headerRow: r, mapping }
  }
  return null
}

const DAYS: [RegExp, number][] = [
  [/^(pazartesi|pzt|pts)/, 1], [/^(sali|sal)/, 2], [/^(carsamba|car|crs)/, 3], [/^(persembe|per|prs)/, 4],
  [/^(cumartesi|cmt|cts)/, 6], [/^(cuma|cum)/, 5], [/^(pazar|paz|pzr)/, 7],
]
export function parseWeekday(v: unknown): number | null {
  const t = trNormalize(String(v ?? '')).replace(/[^a-z]/g, '')
  for (const [re, n] of DAYS) if (re.test(t)) return n
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "11.00", "11:00", Excel saat kesri (0.4583) veya Date → "HH:MM" */
export function parseTime(v: unknown): string | null {
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`
  if (typeof v === 'number' && v > 0 && v < 1) { const m = Math.round(v * 1440); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}` }
  const m = String(v ?? '').match(/\b([01]?\d|2[0-3])[.:](\d{2})\b/)
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null
}

/** "22.10.2026", "2026-10-22", Date veya Excel seri numarası → "YYYY-MM-DD" */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/)
  if (m && Number(m[2]) <= 12 && Number(m[1]) <= 31) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`
  return null
}

export interface TableRow {
  line: number
  raw: string
  name: string | null
  instructor: string | null
  course: string | null
  room: string | null
  title: string | null
  date: string | null
  weekday: number | null
  start: string | null
  end: string | null
  issues: string[]
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const toHM = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`

export function rowsFromTable(rows: unknown[][], headerRow: number, map: Mapping): TableRow[] {
  const cell = (r: unknown[], f: ImportField) => (map[f] === undefined ? null : r[map[f]!])
  const text = (r: unknown[], f: ImportField) => { const v = cell(r, f); const s = v === null || v === undefined ? '' : String(v).trim(); return s || null }
  const out: TableRow[] = []
  rows.slice(headerRow + 1).forEach((r, i) => {
    if (!r.some((c) => String(c ?? '').trim())) return
    const issues: string[] = []
    const name = text(r, 'ogrenci')
    const date = map.tarih !== undefined ? parseDate(cell(r, 'tarih')) : null
    const weekday = date ? null : map.gun !== undefined ? parseWeekday(cell(r, 'gun')) : null
    let start = parseTime(cell(r, 'baslangic'))
    let end = parseTime(cell(r, 'bitis'))
    // "11.00-13.10" tek hücrede olabilir
    if (start && !end && map.baslangic !== undefined) {
      const both = String(cell(r, 'baslangic') ?? '').match(/(\d{1,2}[.:]\d{2}).*?(\d{1,2}[.:]\d{2})/)
      if (both) { start = parseTime(both[1]); end = parseTime(both[2]) }
    }
    const dur = Number(String(cell(r, 'sure') ?? '').replace(/[^\d]/g, ''))
    if (start && !end && dur >= 10 && dur <= 600) end = toHM(toMin(start) + dur)
    if (!name) issues.push('Öğrenci adı yok')
    if (!date && !weekday) issues.push(map.tarih !== undefined ? 'Tarih okunamadı' : 'Gün/tarih yok')
    if (!start) issues.push('Başlangıç saati yok')
    if (!end) issues.push('Bitiş saati/süre yok')
    if (start && end && toMin(end) <= toMin(start)) issues.push('Bitiş başlangıçtan önce')
    out.push({
      line: headerRow + i + 2, raw: r.map((c) => (c instanceof Date ? parseDate(c) : String(c ?? ''))).join(' | '),
      name, instructor: text(r, 'egitmen'), course: text(r, 'kurs'), room: text(r, 'sinif'), title: text(r, 'konu'),
      date, weekday, start, end, issues,
    })
  })
  return out
}

/** Ada göre tam eşleşen kayıt (Türkçe karakter duyarsız) */
export function findByName<T extends { id: string }>(name: string | null, list: T[], key: (x: T) => string): string {
  if (!name) return ''
  const n = trNormalize(name.trim())
  const hits = list.filter((x) => trNormalize(key(x).trim()) === n)
  return hits.length === 1 ? hits[0].id : ''
}
