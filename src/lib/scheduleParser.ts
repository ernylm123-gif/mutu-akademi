// Ders programı metin ayrıştırıcı.
// Örnek satırlar: "Pazartesi – Ezgi – 11.00–13.10", "Çarşamba;Doğa;13:45-15:55", "Cuma Burcu 13.30 - 15.40"
// Belirsiz/eksik veriyi ASLA tahmin etmez; sorunlu satırı işaretler.
import { trNormalize } from '@/lib/format'

export interface ParsedRow {
  line: number
  raw: string
  weekday: number | null // 1 = Pazartesi
  start: string | null // HH:MM
  end: string | null
  name: string | null
  issues: string[]
}

const DAYS: [RegExp, number][] = [
  [/^(pazartesi|pzt|pts)$/, 1],
  [/^(sali|sal)$/, 2],
  [/^(carsamba|car|crs)$/, 3],
  [/^(persembe|per|prs)$/, 4],
  [/^(cuma|cum)$/, 5],
  [/^(cumartesi|cmt|cts)$/, 6],
  [/^(pazar|paz|pzr)$/, 7],
]

function dayOf(token: string): number | null {
  const t = trNormalize(token).replace(/[^a-z]/g, '')
  for (const [re, n] of DAYS) if (re.test(t)) return n
  return null
}

const TIME = /([01]?\d|2[0-3])[.:](\d{2})/g

function pad(t: string) {
  const [h, m] = t.replace('.', ':').split(':')
  return `${h.padStart(2, '0')}:${m}`
}

export function toMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function parseScheduleText(text: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const raw = rawLine.replace(/\s+/g, ' ').trim()
    if (!raw) return
    const issues: string[] = []
    // Saatler
    const times = [...raw.matchAll(TIME)].map((m) => pad(`${m[1]}:${m[2]}`))
    // Gün: tüm kelimelerde ara
    const words = raw.split(/[\s;,|/–—\-\t]+/).filter(Boolean)
    const dayHits = [...new Set(words.map(dayOf).filter((d): d is number => d !== null))]
    // Başlık satırlarını atla (ör. "Gün;Öğrenci;Saat")
    if (!times.length && !dayHits.length) return
    if (!times.length && /g[uü]n|[oö][gğ]renci|saat/i.test(raw)) return

    const weekday = dayHits.length === 1 ? dayHits[0] : null
    if (dayHits.length === 0) issues.push('Gün bulunamadı')
    if (dayHits.length > 1) issues.push('Birden fazla gün var')

    let start: string | null = null
    let end: string | null = null
    if (times.length === 0) issues.push('Saat bulunamadı')
    else if (times.length === 1) { start = times[0]; issues.push('Bitiş saati yok') }
    else if (times.length === 2) {
      start = times[0]; end = times[1]
      if (toMinutes(end) <= toMinutes(start)) { issues.push('Bitiş saati başlangıçtan önce'); end = null }
    } else issues.push('Birden fazla saat aralığı var')

    // İsim: gün ve saat dışındaki kelimeler
    const name = raw
      .replace(TIME, ' ')
      .split(/[\s;,|/–—\-\t]+/)
      .filter((w) => w && dayOf(w) === null && !/^(saat|ders|ile|ve|arası|arasi)$/i.test(w))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!name) issues.push('Öğrenci adı bulunamadı')

    rows.push({ line: idx + 1, raw, weekday, start, end, name: name || null, issues })
  })
  return rows
}

/** Tablo hücrelerini (Excel/CSV) satır metnine çevirir */
export function rowsToText(rows: unknown[][]): string {
  return rows
    .map((r) =>
      r.map((c) => {
        if (c instanceof Date) return `${String(c.getUTCHours()).padStart(2, '0')}:${String(c.getUTCMinutes()).padStart(2, '0')}`
        // Excel saat kesirleri (0.4583 = 11:00)
        if (typeof c === 'number' && c > 0 && c < 1) {
          const mins = Math.round(c * 24 * 60)
          return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
        }
        return c === null || c === undefined ? '' : String(c)
      }).join(' – '),
    )
    .join('\n')
}

export function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) >= (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  return text.split(/\r?\n/).map((line) => {
    const out: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
      else if (ch === sep && !q) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out
  })
}

export interface StudentRef { id: string; full_name: string; instructor_id: string | null; is_active: boolean }

/** İsmi mevcut öğrencilerle eşleştirir: tam eşleşme > tek ön ek eşleşmesi; birden fazla aday = belirsiz */
export function matchStudent(name: string | null, students: StudentRef[]): { id: string | null; ambiguous: StudentRef[] } {
  if (!name) return { id: null, ambiguous: [] }
  const n = trNormalize(name)
  const exact = students.filter((s) => trNormalize(s.full_name) === n)
  if (exact.length === 1) return { id: exact[0].id, ambiguous: [] }
  if (exact.length > 1) return { id: null, ambiguous: exact }
  const prefix = students.filter((s) => trNormalize(s.full_name).split(' ')[0] === n.split(' ')[0] && s.is_active)
  if (prefix.length === 1 && n.split(' ').length === 1) return { id: prefix[0].id, ambiguous: [] }
  if (prefix.length > 1) return { id: null, ambiguous: prefix }
  return { id: null, ambiguous: [] }
}
