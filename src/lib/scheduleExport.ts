// Ders programı dışa aktarma: PDF, Excel (.xlsx), CSV ve A4 yazdırılabilir haftalık program
import { addDays, dateKey, formatDayShort, timeHM, WEEKDAYS } from '@/lib/time'
import { displayStatus } from '@/lib/format'
import { memberLabel, type LessonItem } from '@/lib/lessons'
import { downloadCsv, saveOrShare } from '@/lib/csv'
import { downloadPdf } from '@/lib/pdf'

const HEADERS = ['Tarih', 'Gün', 'Saat', 'Kurs / konu', 'Eğitmen', 'Öğrenci', 'Sınıf', 'Durum']

function rowOf(l: LessonItem): string[] {
  const d = dateKey(l.starts_at)
  const wd = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7
  return [
    d.split('-').reverse().join('.'), WEEKDAYS[wd], `${timeHM(l.starts_at)}–${timeHM(l.ends_at)}`,
    [l.course?.name, l.title].filter(Boolean).join(' – ') || '—', l.instructor?.full_name ?? '—',
    l.members.length > 1 ? l.members.map((m) => m.student?.full_name ?? '?').join(', ') : memberLabel(l),
    l.room?.name ?? (l.lesson_type === 'online' ? 'Online' : '—'), displayStatus(l).label,
  ]
}

const range = (from: string, to: string) => `${formatDayShort(from)} – ${formatDayShort(addDays(to, -1))} ${to.slice(0, 4)}`
const fileBase = (from: string) => `mutu-akademi-ders-programi-${from}`

export function exportCsv(items: LessonItem[], from: string) {
  downloadCsv(fileBase(from), HEADERS, items.map(rowOf))
}

export async function exportXlsx(items: LessonItem[], from: string) {
  const { default: writeXlsxFile } = await import('write-excel-file')
  const data = [
    HEADERS.map((h) => ({ value: h, fontWeight: 'bold' as const, backgroundColor: '#e2e8f0' })),
    ...items.map((l) => rowOf(l).map((v) => ({ value: v }))),
  ]
  const blob = (await writeXlsxFile(data, { columns: [12, 11, 13, 28, 20, 30, 20, 14].map((width) => ({ width })), sheet: 'Ders programı' })) as unknown as Blob
  await saveOrShare(blob, `${fileBase(from)}.xlsx`)
}

export async function exportPdf(items: LessonItem[], from: string, to: string, filterNote: string) {
  await downloadPdf(fileBase(from), 'Ders Programı', `${range(from, to)}${filterNote ? ` · ${filterNote}` : ''} · ${items.length} ders`,
    [{ headers: HEADERS, rows: items.map(rowOf), widths: [44, 46, 52, '*', 70, '*', 62, 52] }], { landscape: true })
}

/** A4 yatay, 7 sütunlu yazdırılabilir haftalık program */
export async function exportWeeklyPrint(items: LessonItem[], weekStart: string, filterNote: string) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const cell = (d: string) => items.filter((l) => dateKey(l.starts_at) === d && l.status !== 'ertelendi')
    .map((l) => `${timeHM(l.starts_at)}–${timeHM(l.ends_at)}\n${l.course?.name ?? l.title ?? 'Ders'}\n${memberLabel(l)}${l.room ? ` · ${l.room.name}` : ''}${l.status === 'iptal' ? '\n(İPTAL)' : ''}`)
    .join('\n\n') || '—'
  await downloadPdf(`mutu-akademi-haftalik-${weekStart}`, 'Haftalık Ders Programı', `${range(weekStart, addDays(weekStart, 7))}${filterNote ? ` · ${filterNote}` : ''}`,
    [{ headers: days.map((d, i) => `${WEEKDAYS[i]} ${formatDayShort(d)}`), rows: [days.map(cell)] }], { landscape: true })
}
