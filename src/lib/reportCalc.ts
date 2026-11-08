// Ders raporu hesapları ve dışa aktarma (PDF / Excel). Yalnızca seçilen tarih aralığındaki satırlar kullanılır.
// Kurallar: ders başına sayım (grup dersi bir kez), tamamlanan süre yalnızca "tamamlandı" dersler,
// öğrenci süresi yalnızca öğrencinin katıldığı (geç geldi / erken ayrıldı dahil) tamamlanan dersler.
import { addDays, dateKey, timeHM } from '@/lib/time'
import type { ReportRow } from '@/lib/staffApi'

export type RangeKey = 'bu_ay' | 'gecen_ay' | 'son_3_ay' | 'ozel'
export const RANGE_LABEL: Record<RangeKey, string> = { bu_ay: 'Bu ay', gecen_ay: 'Geçen ay', son_3_ay: 'Son 3 ay', ozel: 'Özel aralık' }

const monthStart = (d: string) => `${d.slice(0, 7)}-01`
function shiftMonth(m: string, n: number) {
  const [y, mo] = m.split('-').map(Number)
  const t = new Date(Date.UTC(y, mo - 1 + n, 1))
  return t.toISOString().slice(0, 10)
}

/** Hızlı tarih aralıkları (İstanbul takvim günü; saat dilimi kayması yok) – bitiş günü dahil */
export function rangeOf(key: Exclude<RangeKey, 'ozel'>, today = dateKey()): [string, string] {
  const m = monthStart(today)
  if (key === 'bu_ay') return [m, addDays(shiftMonth(m, 1), -1)]
  if (key === 'gecen_ay') return [shiftMonth(m, -1), addDays(m, -1)]
  return [shiftMonth(m, -2), addDays(shiftMonth(m, 1), -1)]
}

export const ATTENDED = new Set(['katildi', 'gec_geldi', 'erken_ayrildi'])
export const STATUS_TEXT: Record<string, string> = { planlandi: 'Planlandı', tamamlandi: 'Tamamlandı', ertelendi: 'Ertelendi', iptal: 'İptal edildi' }

export function hoursText(min: number) {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60), r = m % 60
  return h === 0 ? `${r} dk` : r === 0 ? `${h} sa` : `${h} sa ${r} dk`
}
/** "900 dk (15 saat)" – hem dakika hem saat */
export const minAndHours = (min: number) => `${Math.round(min)} dk (${(Math.round(min) / 60).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} saat)`

export interface ReportFilters { status?: string | null; course?: string | null; kind?: 'bireysel' | 'grup' | null }

export function applyFilters(rows: ReportRow[], f: ReportFilters) {
  return rows.filter((r) => (!f.status || r.status === f.status) && (!f.course || r.course_name === f.course) && (!f.kind || (f.kind === 'grup') === r.is_group))
}

export interface Summary {
  lessons: number; planned: number; completed: number; postponed: number; cancelled: number
  completedMin: number; scheduledMin: number
  byStudent: { key: string; name: string; completed: number; min: number; planned: number }[]
  byInstructor: { key: string; name: string; completed: number; min: number }[]
}

export function summarize(rows: ReportRow[]): Summary {
  const lessons = new Map<string, ReportRow>()
  for (const r of rows) if (!lessons.has(r.lesson_id)) lessons.set(r.lesson_id, r)
  const ls = [...lessons.values()]
  const done = ls.filter((l) => l.status === 'tamamlandi')
  const byStudent = new Map<string, Summary['byStudent'][number]>()
  for (const r of rows) {
    const key = r.student_id ?? `ad:${r.student_name ?? '—'}`
    const x = byStudent.get(key) ?? { key, name: r.student_name || '—', completed: 0, min: 0, planned: 0 }
    if (r.status === 'planlandi' || r.status === 'tamamlandi') x.planned++
    if (r.status === 'tamamlandi' && (r.attendance == null || ATTENDED.has(r.attendance))) { x.completed++; x.min += r.scheduled_min }
    byStudent.set(key, x)
  }
  const byInstructor = new Map<string, Summary['byInstructor'][number]>()
  for (const l of ls) {
    const key = l.instructor_id ?? `ad:${l.instructor_name ?? '—'}`
    const x = byInstructor.get(key) ?? { key, name: l.instructor_name || '—', completed: 0, min: 0 }
    if (l.status === 'tamamlandi') { x.completed++; x.min += l.scheduled_min }
    byInstructor.set(key, x)
  }
  const sort = <T extends { min: number; name: string }>(a: T[]) => a.sort((p, q) => q.min - p.min || p.name.localeCompare(q.name, 'tr'))
  return {
    lessons: ls.length,
    planned: ls.filter((l) => l.status === 'planlandi' || l.status === 'tamamlandi').length,
    completed: done.length,
    postponed: ls.filter((l) => l.status === 'ertelendi').length,
    cancelled: ls.filter((l) => l.status === 'iptal').length,
    completedMin: done.reduce((a, l) => a + l.scheduled_min, 0),
    scheduledMin: ls.filter((l) => l.status === 'planlandi' || l.status === 'tamamlandi').reduce((a, l) => a + l.scheduled_min, 0),
    byStudent: sort([...byStudent.values()]),
    byInstructor: sort([...byInstructor.values()]),
  }
}

const ATT_TEXT: Record<string, string> = { katildi: 'Katıldı', katilmadi: 'Gelmedi', izinli: 'İzinli', gec_geldi: 'Geç geldi', erken_ayrildi: 'Erken ayrıldı' }
export const dmy = (d: string) => d.split('-').reverse().join('.')
export const statusText = (r: Pick<ReportRow, 'status' | 'attendance' | 'student_id'>) =>
  STATUS_TEXT[r.status] + (r.status === 'tamamlandi' && r.attendance && r.attendance !== 'katildi' ? ` · ${ATT_TEXT[r.attendance] ?? r.attendance}` : '')

export const TABLE_HEADERS = ['Tarih', 'Öğrenci', 'Eğitmen', 'Ders', 'Başlangıç', 'Bitiş', 'Süre', 'Durum']
export const tableRow = (r: ReportRow) => [
  dmy(dateKey(r.starts_at)), r.student_name || '—', r.instructor_name || '—', r.course_name, timeHM(r.starts_at), timeHM(r.ends_at), `${r.scheduled_min} dk`, statusText(r),
]

export function summaryRows(s: Summary): [string, string][] {
  return [
    ['Planlanan ders', String(s.planned)], ['Tamamlanan ders', String(s.completed)], ['Ertelenen ders', String(s.postponed)], ['İptal edilen ders', String(s.cancelled)],
    ['Tamamlanan ders süresi', minAndHours(s.completedMin)],
  ]
}

const fileSafe = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Profesyonel PDF: logo, başlık, tarih aralığı, özet, öğrenci/eğitmen toplamları ve ders tablosu (A4 yatay) */
export async function reportPdf(title: string, from: string, to: string, note: string, rows: ReportRow[], s: Summary) {
  const { downloadPdf } = await import('@/lib/pdf')
  const sub = `${dmy(from)} – ${dmy(to)}${note ? ` · ${note}` : ''} · Oluşturma: ${dmy(dateKey())}`
  await downloadPdf(`${fileSafe(title)}-${from}-${to}`, title, sub, [
    { title: 'Özet', headers: ['Ölçüt', 'Değer'], rows: summaryRows(s), widths: [180, '*'] },
    { title: 'Öğrenci bazında tamamlanan ders saatleri', headers: ['Öğrenci', 'Planlanan', 'Tamamlanan', 'Toplam süre'], rows: s.byStudent.map((x) => [x.name, x.planned, x.completed, minAndHours(x.min)]), widths: ['*', 70, 70, 140] },
    { title: 'Eğitmen bazında tamamlanan ders saatleri', headers: ['Eğitmen', 'Tamamlanan ders', 'Toplam süre'], rows: s.byInstructor.map((x) => [x.name, x.completed, minAndHours(x.min)]), widths: ['*', 90, 140] },
    { title: `Dersler (${rows.length})`, headers: TABLE_HEADERS, rows: rows.map(tableRow), widths: [50, '*', 80, '*', 44, 36, 40, 80] },
  ], { landscape: true })
}

/** Excel: aynı içerik, sayısal sütunlar sayı olarak */
export async function reportXlsx(title: string, from: string, to: string, note: string, rows: ReportRow[], s: Summary) {
  const [{ default: writeXlsxFile }, { saveOrShare }] = await Promise.all([import('write-excel-file'), import('@/lib/csv')])
  type Cell = { value: string | number; fontWeight?: 'bold'; backgroundColor?: string; fontSize?: number } | null
  const bold = (v: string): Cell => ({ value: v, fontWeight: 'bold' })
  const head = (hs: string[]): Cell[] => hs.map((h) => ({ value: h, fontWeight: 'bold', backgroundColor: '#e2e8f0' }))
  const data: Cell[][] = [
    [{ value: `MUTU AKADEMİ – ${title}`, fontWeight: 'bold', fontSize: 14 }],
    [{ value: `${dmy(from)} – ${dmy(to)}${note ? ` · ${note}` : ''}` }],
    [],
    [bold('Özet')],
    ...summaryRows(s).map(([k, v]) => [{ value: k }, { value: v }] as Cell[]),
    [{ value: 'Tamamlanan ders süresi (dakika)' }, { value: s.completedMin }],
    [],
    [bold('Öğrenci bazında')],
    head(['Öğrenci', 'Planlanan', 'Tamamlanan', 'Süre (dk)', 'Süre (saat)']),
    ...s.byStudent.map((x) => [{ value: x.name }, { value: x.planned }, { value: x.completed }, { value: x.min }, { value: Math.round((x.min / 60) * 100) / 100 }] as Cell[]),
    [],
    [bold('Eğitmen bazında')],
    head(['Eğitmen', 'Tamamlanan', 'Süre (dk)', 'Süre (saat)']),
    ...s.byInstructor.map((x) => [{ value: x.name }, { value: x.completed }, { value: x.min }, { value: Math.round((x.min / 60) * 100) / 100 }] as Cell[]),
    [],
    [bold('Dersler')],
    head(['Tarih', 'Öğrenci', 'Eğitmen', 'Ders', 'Başlangıç', 'Bitiş', 'Süre (dk)', 'Durum']),
    ...rows.map((r) => tableRow(r).map((v, i) => ({ value: i === 6 ? r.scheduled_min : v })) as Cell[]),
  ]
  const blob = (await writeXlsxFile(data as never, { columns: [16, 24, 22, 24, 11, 11, 11, 22].map((width) => ({ width })), sheet: 'Ders raporu' })) as unknown as Blob
  await saveOrShare(blob, `${fileSafe(title)}-${from}-${to}.xlsx`)
}
