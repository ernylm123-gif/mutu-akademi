import { useEffect, useMemo, useRef, useState } from 'react'
import { FileUp, FileText, FileSpreadsheet, Download, AlertTriangle } from 'lucide-react'
import { addDays, addMonths, dateKey, isoWeekday, WEEKDAYS } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { parseCsv } from '@/lib/scheduleParser'
import { detectMapping, rowsFromTable, FIELD_LABEL, type ImportField, type Mapping } from '@/lib/importMapping'
import { shared, requestId, type ImportCheck, type ImportRow, type SharedLesson } from '@/lib/sharedApi'
import type { LessonItem } from '@/lib/lessons'
import { Badge, Button, Card, Field, Input, Select, Sheet } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'

/** Ortak dersi dışa aktarma modülünün beklediği biçime çevirir */
function asItem(l: SharedLesson): LessonItem {
  const item = {
    ...l, course: { name: l.course_name }, instructor: l.instructor_name ? { full_name: l.instructor_name } : null,
    student: { full_name: l.student_label ?? '—' }, room: l.room ? { name: l.room } : null,
    lesson_type: l.is_group ? 'grup' : 'bireysel', attendance: l.attendance ? { status: l.attendance } : null,
  } as unknown as LessonItem
  item.members = [item]
  return item
}

export function ExportSheet({ open, onClose, from, to }: { open: boolean; onClose: () => void; from: string; to: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (kind: 'pdf' | 'xlsx' | 'csv' | 'print') => {
    setBusy(kind)
    try {
      const data = (await shared.list(new Date(`${from}T00:00:00+03:00`).toISOString(), new Date(`${to}T00:00:00+03:00`).toISOString())).map(asItem)
      const ex = await import('@/lib/scheduleExport')
      if (kind === 'pdf') await ex.exportPdf(data, from, to, '')
      else if (kind === 'xlsx') await ex.exportXlsx(data, from)
      else if (kind === 'csv') ex.exportCsv(data, from)
      else await ex.exportWeeklyPrint(data, from, '')
      toast.success('Dosya hazırlandı')
      onClose()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const opts = [
    { k: 'pdf' as const, label: 'PDF', desc: 'Logolu ders programı', icon: FileText },
    { k: 'xlsx' as const, label: 'Excel (.xlsx)', desc: 'Düzenlenebilir tablo', icon: FileSpreadsheet },
    { k: 'csv' as const, label: 'CSV', desc: 'Diğer programlar için', icon: FileSpreadsheet },
    { k: 'print' as const, label: 'Yazdırılabilir haftalık program', desc: 'A4 yatay', icon: Download },
  ]
  return (
    <Sheet open={open} onClose={onClose} title="Programı dışa aktar">
      <p className="mb-3 text-sm text-slate-500">{from.split('-').reverse().join('.')} – {addDays(to, -1).split('-').reverse().join('.')}</p>
      <div className="grid gap-2">
        {opts.map((o) => (
          <button key={o.k} disabled={!!busy} onClick={() => void run(o.k)} className="card flex min-h-16 items-center gap-3 p-4 text-left disabled:opacity-50">
            <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><o.icon className="size-5" /></span>
            <span className="flex-1"><b className="block">{o.label}</b><span className="text-xs text-slate-500">{o.desc}</span></span>
            {busy === o.k && <span className="text-xs text-slate-500">Hazırlanıyor…</span>}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/** Excel/CSV program yükleme: sütun eşleştirme → önizleme (sunucuda çakışma/mükerrer kontrolü) → onayla */
export function ImportSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [table, setTable] = useState<unknown[][] | null>(null)
  const [header, setHeader] = useState(0)
  const [mapping, setMapping] = useState<Mapping>({})
  const [fileName, setFileName] = useState('')
  const [defCourse, setDefCourse] = useState('')
  const [fromDate, setFromDate] = useState(dateKey())
  const [until, setUntil] = useState(addMonths(dateKey(), 3))
  const [checks, setChecks] = useState<ImportCheck[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reqId = useRef(requestId())

  useEffect(() => { if (open) { setTable(null); setChecks(null); setError(null); setFileName(''); reqId.current = requestId() } }, [open])

  const parsed = useMemo(() => (table ? rowsFromTable(table, header, mapping) : []), [table, header, mapping])
  const rows = useMemo<(ImportRow & { line: number; issues: string[]; label: string })[]>(() => parsed.map((p) => {
    const issues = [...p.issues]
    const course = p.course ?? (defCourse.trim() || null)
    if (!course) issues.push('Kurs adı yok')
    let date = p.date, repeat: string | null = null
    if (!date && p.weekday) { let d = fromDate; while (isoWeekday(d) !== p.weekday) d = addDays(d, 1); date = d; repeat = until }
    return {
      line: p.line, issues: issues.filter((x) => !(x === 'Öğrenci adı yok')), label: p.date ? p.date.split('-').reverse().join('.') : p.weekday ? `Her ${WEEKDAYS[p.weekday - 1]}` : '—',
      course_name: course ?? '', student_label: p.name, instructor_name: p.instructor, room: p.room, title: p.title,
      date: date ?? '', start: p.start ?? '', end: p.end ?? '', repeat_until: repeat,
    }
  }), [parsed, defCourse, fromDate, until])
  const ready = rows.filter((r) => r.issues.length === 0)
  const payload = (r: (typeof rows)[number]): ImportRow => ({
    course_name: r.course_name, student_label: r.student_label, instructor_name: r.instructor_name, room: r.room, title: r.title,
    date: r.date, start: r.start, end: r.end, repeat_until: r.repeat_until,
  })

  const key = JSON.stringify(ready.map(payload))
  useEffect(() => {
    if (!ready.length) { setChecks(null); return }
    let alive = true
    const t = setTimeout(() => { shared.checkImport(ready.map(payload)).then((c) => alive && setChecks(c)).catch((e) => alive && setError(errorMessage(e))) }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (f: File) => {
    setError(null); setChecks(null); setFileName(f.name)
    try {
      let data: unknown[][]
      if (/\.xlsx$/i.test(f.name)) {
        const { default: readXlsx } = await import('read-excel-file/browser')
        data = ((await readXlsx(f))[0]?.data ?? []) as unknown[][]
      } else if (/\.csv$/i.test(f.name)) data = parseCsv(await f.text())
      else throw new Error('Yalnızca Excel (.xlsx) veya CSV dosyası yükleyin.')
      const det = detectMapping(data)
      if (!det) throw new Error('Başlık satırı bulunamadı. İlk satırlarda "Öğrenci", "Kurs", "Tarih" veya "Gün", "Başlangıç", "Bitiş" sütun başlıkları olmalı.')
      setTable(data); setHeader(det.headerRow); setMapping(det.mapping)
    } catch (e) { setTable(null); setError(errorMessage(e)) }
  }
  const total = (checks ?? []).reduce((a, c) => a + (c.count ?? 0), 0)
  const skip = (checks ?? []).reduce((a, c) => a + (c.conflicts ?? 0) + (c.duplicates ?? 0), 0)

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const r = await shared.importRows(ready.map(payload), reqId.current)
      toast.success(r.duplicate ? 'Bu dosya zaten aktarılmış.' : `${r.created} ders eklendi${r.skipped ? `, ${r.skipped} çakışan/mükerrer ders atlandı` : ''}`)
      onDone(); onClose()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Program yükle (Excel / CSV)" wide
      footer={table && (
        <div className="grid gap-2">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <p className="text-sm text-slate-600">{checks ? `${total - skip} ders eklenecek${skip ? `, ${skip} çakışan/mükerrer ders atlanacak` : ''}.` : ready.length ? 'Kontrol ediliyor…' : 'Aktarılabilir satır yok.'}</p>
          <Button block disabled={!checks || total - skip <= 0} loading={busy} onClick={() => void save()}>Onayla ve içeri aktar</Button>
        </div>
      )}>
      <input ref={fileRef} type="file" hidden accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
      <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 px-4 py-6 text-center">
        <FileUp className="size-7 text-brand-600" />
        <b>{fileName || 'Dosya seçin'}</b>
        <span className="text-xs text-slate-500">Excel (.xlsx) veya CSV · Sütunlar: Öğrenci, Kurs, Eğitmen, Tarih veya Gün, Başlangıç, Bitiş (ya da Süre), Sınıf</span>
      </button>
      {!table && error && <p role="alert" className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="size-4 shrink-0" />{error}</p>}
      {table && (
        <div className="mt-4 grid gap-3">
          <Card className="grid gap-2 p-3 sm:grid-cols-2">
            {(['ogrenci', 'kurs', 'egitmen', 'tarih', 'gun', 'baslangic', 'bitis', 'sure', 'sinif'] as ImportField[]).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0 text-slate-600">{FIELD_LABEL[f]}</span>
                <Select value={mapping[f] ?? ''} onChange={(e) => { const m = { ...mapping }; if (e.target.value === '') delete m[f]; else m[f] = Number(e.target.value); setMapping(m) }} className="h-10 text-sm">
                  <option value="">— Yok —</option>
                  {(table[header] ?? []).map((h, c) => <option key={c} value={c}>{String(h ?? `Sütun ${c + 1}`)}</option>)}
                </Select>
              </label>
            ))}
          </Card>
          {mapping.kurs === undefined && <Field label="Kurs sütunu yok – tüm satırlar için kurs adı"><Input value={defCourse} onChange={(e) => setDefCourse(e.target.value)} placeholder="Ör. Python Eğitimi" /></Field>}
          {rows.some((r) => r.repeat_until) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Haftalık satırlar başlangıcı"><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
              <Field label="Şu tarihe kadar"><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
            </div>
          )}
          <div className="space-y-2">
            {rows.map((r) => {
              const k = ready.indexOf(r)
              const c = k >= 0 ? checks?.[k] : undefined
              const badge = r.issues.length ? { tone: 'red' as const, t: r.issues.join(', ') }
                : c?.error ? { tone: 'red' as const, t: c.error }
                : c && (c.conflicts || c.duplicates) ? { tone: 'amber' as const, t: `${c.duplicates ? `${c.duplicates} mükerrer ` : ''}${c.conflicts ? `${c.conflicts} çakışma` : ''} (atlanır)` }
                : c ? { tone: 'green' as const, t: `Hazır · ${c.count} ders` } : { tone: 'slate' as const, t: '…' }
              return (
                <Card key={r.line} className="p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{r.label}</b><span className="tabular-nums">{r.start || '??'}–{r.end || '??'}</span>
                    <span className="truncate text-slate-600">{[r.course_name, r.student_label, r.instructor_name].filter(Boolean).join(' · ')}</span>
                    <Badge tone={badge.tone} className="ml-auto">{badge.t}</Badge>
                  </div>
                  {c?.messages?.map((m) => <p key={m} className="mt-1 text-xs text-amber-700">{m}</p>)}
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </Sheet>
  )
}
