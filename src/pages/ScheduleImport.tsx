import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, FileSpreadsheet, FileText, Image as ImageIcon, CheckCircle2, AlertTriangle, Info, History } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useInstructors, useStudents, useCourses, useRooms, useImports, useDbMutation, rpc, newRequestId, LESSON_INVALIDATE } from '@/lib/api'
import { parseScheduleText, rowsToText, parseCsv, matchStudent } from '@/lib/scheduleParser'
import { detectMapping, rowsFromTable, findByName, FIELD_LABEL, type ImportField, type Mapping, type TableRow } from '@/lib/importMapping'
import { addDays, addMonths, dateKey, formatDateTime, isoWeekday, WEEKDAYS } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { Badge, Button, Card, Field, Input, Select, Textarea, Toggle } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'

interface Row extends TableRow {
  studentId: string
  instructorId: string
  courseId: string
  roomId: string
  createNew: boolean
  include: boolean
}
interface RowCheck { row: number; count: number; conflicts?: number; duplicates?: number; warnings?: number; messages?: string[]; error?: string }
type Result = { created: number; skipped: number; new_students: number; problems: { row: number; date?: string; reason: string }[] }

async function extractPdfText(file: File): Promise<string> {
  // "legacy" derleme: iOS 18.4 öncesi Safari'de olmayan Iterator vb. API'ler için polyfill içerir
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const lines: string[] = []
  for (let p = 1; p <= Math.min(doc.numPages, 20); p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const byY = new Map<number, { x: number; s: string }[]>()
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue
      const y = Math.round(it.transform[5])
      const key = [...byY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y
      byY.set(key, [...(byY.get(key) ?? []), { x: it.transform[4], s: it.str }])
    }
    ;[...byY.entries()].sort((a, b) => b[0] - a[0]).forEach(([, parts]) => lines.push(parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ')))
  }
  return lines.join('\n')
}

export function ScheduleImportPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const { data: students } = useStudents()
  const { data: instructors } = useInstructors()
  const { data: courses } = useCourses()
  const { data: rooms } = useRooms()
  const { data: history } = useImports()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [table, setTable] = useState<unknown[][] | null>(null)
  const [headerRow, setHeaderRow] = useState(0)
  const [mapping, setMapping] = useState<Mapping>({})
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [from, setFrom] = useState(dateKey())
  const [until, setUntil] = useState(addMonths(dateKey(), 3))
  const [checks, setChecks] = useState<RowCheck[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const reqId = useRef(newRequestId())

  const resolve = (parsed: TableRow[]): Row[] => parsed.map((p) => {
    const m = matchStudent(p.name, students ?? [])
    const st = students?.find((s) => s.id === m.id)
    return {
      ...p, studentId: m.id ?? '',
      instructorId: findByName(p.instructor, instructors ?? [], (x) => x.full_name) || st?.instructor_id || '',
      courseId: findByName(p.course, courses ?? [], (x) => x.name) || st?.course_id || '',
      roomId: findByName(p.room, rooms ?? [], (x) => x.name),
      createNew: false, include: p.issues.length === 0,
    }
  })

  const fromText = (src: string) => {
    setError(null); setResult(null); setTable(null); setChecks(null)
    const parsed = parseScheduleText(src)
    if (!parsed.length) {
      setRows(null)
      setError('Dosyada ders programı satırı bulunamadı. Her satırda gün veya tarih, öğrenci adı ve saat aralığı olmalıdır (ör. "Pazartesi – Ezgi – 11.00–13.10").')
      return
    }
    setRows(resolve(parsed.map((p) => ({ line: p.line, raw: p.raw, name: p.name, instructor: null, course: null, room: null, title: null, date: null, weekday: p.weekday, start: p.start, end: p.end, issues: p.issues }))))
  }

  const fromTable = (data: unknown[][]) => {
    setError(null); setResult(null); setChecks(null)
    const det = detectMapping(data)
    if (!det) { fromText(rowsToText(data)); return }
    setTable(data); setHeaderRow(det.headerRow); setMapping(det.mapping)
    setRows(resolve(rowsFromTable(data, det.headerRow, det.mapping)))
  }

  const remap = (f: ImportField, col: string) => {
    const next = { ...mapping }
    if (col === '') delete next[f]; else next[f] = Number(col)
    setMapping(next); setChecks(null)
    if (table) setRows(resolve(rowsFromTable(table, headerRow, next)))
  }

  const onFile = async (file: File) => {
    setError(null); setFileName(file.name); reqId.current = newRequestId()
    const name = file.name.toLowerCase()
    try {
      if (file.type.startsWith('image/')) {
        setRows(null)
        setError('Görselden program okuma desteklenmiyor: güvenilir metin tanıma olmadan yanlış ders oluşturma riski var. Programı Excel, CSV, metin içeren PDF olarak yükleyin ya da aşağıya yapıştırın.')
        return
      }
      if (name.endsWith('.xlsx')) {
        const { default: readXlsx } = await import('read-excel-file/browser')
        const sheets = await readXlsx(file)
        fromTable((sheets[0]?.data ?? []) as unknown[][])
      } else if (name.endsWith('.xls')) {
        throw new Error('Eski .xls biçimi desteklenmiyor. Dosyayı Excel\'de .xlsx olarak kaydedip tekrar deneyin.')
      } else if (name.endsWith('.csv')) {
        fromTable(parseCsv(await file.text()))
      } else if (name.endsWith('.pdf')) {
        const src = await extractPdfText(file)
        if (!src.trim()) throw new Error('Bu PDF görüntü tabanlı (taranmış) görünüyor; içinden güvenilir şekilde metin okunamıyor. Metin içeren bir PDF, Excel veya CSV yükleyin.')
        setText(src); fromText(src)
      } else {
        const src = await file.text()
        setText(src); fromText(src)
      }
    } catch (e) {
      setRows(null)
      setError((e as Error).message)
    }
  }

  // Dosya içi mükerrer satırlar
  const dupInFile = useMemo(() => {
    const seen = new Map<string, number>(), dup = new Set<number>()
    ;(rows ?? []).forEach((r, i) => {
      if (!r.include) return
      const k = `${r.studentId || r.name}|${r.date ?? r.weekday}|${r.start}`
      if (seen.has(k)) { dup.add(i); dup.add(seen.get(k)!) } else seen.set(k, i)
    })
    return dup
  }, [rows])

  const payloadOf = (r: Row) => {
    const firstDate = r.date ?? (() => { let d = from; while (isoWeekday(d) !== r.weekday) d = addDays(d, 1); return d })()
    return {
      ...(r.studentId ? { student_ids: [r.studentId] } : { new_student: r.name }),
      instructor_id: r.instructorId || null, course_id: r.courseId || null, room_id: r.roomId || null, title: r.title,
      date: firstDate, start: r.start, end: r.end,
      ...(r.date ? {} : { repeat: { freq: 'haftalik', weekdays: [r.weekday], until } }),
    }
  }
  const usable = (r: Row, i: number) => r.include && r.issues.length === 0 && (!!r.studentId || (r.createNew && !!r.name)) && !dupInFile.has(i)
  const ready = (rows ?? []).map((r, i) => ({ r, i })).filter(({ r, i }) => usable(r, i))

  // Sunucuda çakışma / mükerrer ön kontrolü (kaydetmeden)
  const key = JSON.stringify(ready.map(({ r }) => payloadOf(r)))
  useEffect(() => {
    if (!ready.length) { setChecks(null); return }
    let alive = true
    setChecking(true)
    const t = setTimeout(() => {
      rpc<RowCheck[]>('preview_import', { p_rows: ready.map(({ r }) => payloadOf(r)) })
        .then((c) => alive && setChecks(c))
        .catch((e) => alive && setError(errorMessage(e)))
        .finally(() => alive && setChecking(false))
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const checkOf = (i: number) => { const k = ready.findIndex((x) => x.i === i); return k >= 0 ? checks?.[k] : undefined }
  const totals = (checks ?? []).reduce((a, c) => ({ count: a.count + c.count, conflicts: a.conflicts + (c.conflicts ?? 0) + (c.duplicates ?? 0) }), { count: 0, conflicts: 0 })

  const save = useDbMutation(
    () => rpc<Result>('import_lessons', { p_rows: ready.map(({ r }) => payloadOf(r)), p_file_name: fileName ?? 'Yapıştırılan program', p_skip_conflicts: true, p_request_id: reqId.current }),
    {
      success: (r) => `${r.created} ders içeri aktarıldı${r.skipped ? `, ${r.skipped} çakışan ders atlandı` : ''}`,
      invalidate: [...LESSON_INVALIDATE, 'imports'],
      onSuccess: (r) => { setResult(r); setRows(null); setTable(null); setText(''); setChecks(null); reqId.current = newRequestId() },
    },
  )
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const hasWeekly = (rows ?? []).some((r) => !r.date && r.weekday)
  const headers = table?.[headerRow] ?? []

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader back title="Program yükle" subtitle="Excel, CSV veya PDF'ten ders programı. Önizleme ve onay olmadan hiçbir kayıt oluşturulmaz." />

      {result && (
        <Card className="mb-4 flex items-start gap-3 border-emerald-200 p-4">
          <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <p className="font-semibold">Aktarım tamamlandı</p>
            <p className="text-slate-600">{result.created} ders oluşturuldu{result.new_students ? `, ${result.new_students} yeni öğrenci eklendi` : ''}{result.skipped ? `. ${result.skipped} ders çakışma nedeniyle atlandı` : ''}.</p>
            {result.problems.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">{result.problems.slice(0, 10).map((p, k) => <li key={k}>Satır {p.row}{p.date ? ` (${p.date})` : ''}: {p.reason}</li>)}</ul>
            )}
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigate('/takvim?gorunum=liste')}>Takvimde gör</Button>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <input ref={fileRef} type="file" hidden accept=".xlsx,.csv,.txt,.pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 px-4 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40">
          <FileUp className="size-8 text-brand-600" />
          <span className="font-semibold">{fileName ?? 'Dosya seçin'}</span>
          <span className="text-xs text-slate-500">Excel (.xlsx), CSV, metin içeren PDF veya metin dosyası</span>
          <span className="mt-1 flex gap-3 text-slate-400"><FileSpreadsheet className="size-4" /><FileText className="size-4" /><ImageIcon className="size-4 opacity-40" /></span>
        </button>
        <Field label="…veya programı yapıştırın" className="mt-4" hint="Her satıra bir ders: Gün – Öğrenci – Başlangıç–Bitiş">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Pazartesi – Ezgi – 11.00–13.10\nÇarşamba – Doğa – 13.45–15.55'} />
        </Field>
        <div className="mt-3 flex justify-end"><Button variant="secondary" disabled={!text.trim()} onClick={() => { setFileName(null); reqId.current = newRequestId(); fromText(text) }}>Analiz et</Button></div>
        {error && <p role="alert" className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="size-4 shrink-0" />{error}</p>}
      </Card>

      {table && (
        <Card className="mt-4 p-4">
          <p className="mb-3 font-semibold">Sütun eşleştirme</p>
          <p className="mb-3 text-xs text-slate-500">Sütunlar otomatik algılandı. Yanlışsa düzeltin; önizleme hemen güncellenir.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(FIELD_LABEL) as ImportField[]).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <span className="w-36 shrink-0 text-slate-600">{FIELD_LABEL[f]}</span>
                <Select value={mapping[f] ?? ''} onChange={(e) => remap(f, e.target.value)} className="h-10 text-sm">
                  <option value="">— Yok —</option>
                  {headers.map((h, c) => <option key={c} value={c}>{String(h ?? `Sütun ${c + 1}`)}</option>)}
                </Select>
              </label>
            ))}
          </div>
        </Card>
      )}

      {rows && (
        <>
          {hasWeekly && (
            <Card className="mt-4 grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Haftalık satırlar şu tarihten başlasın"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="Şu tarihe kadar tekrarlansın"><Input type="date" value={until} min={from} onChange={(e) => setUntil(e.target.value)} /></Field>
            </Card>
          )}
          <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Önizleme · {rows.length} satır, {ready.length} aktarılabilir{checks ? ` · ${totals.count} ders` : ''}</h2>
            <p className="flex items-center gap-1 text-xs text-slate-500"><Info className="size-3.5" />{checking ? 'Çakışmalar kontrol ediliyor…' : 'Hatalı, mükerrer ve çakışan dersler aktarılmaz.'}</p>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => {
              const m = matchStudent(r.name, students ?? [])
              const c = checkOf(i)
              const badge = r.issues.length ? { tone: 'red' as const, label: r.issues.join(', ') }
                : dupInFile.has(i) && r.include ? { tone: 'amber' as const, label: 'Dosyada mükerrer satır' }
                : !r.studentId && !r.createNew ? { tone: 'amber' as const, label: m.ambiguous.length ? 'Birden fazla öğrenci eşleşiyor – seçin' : 'Öğrenci bulunamadı' }
                : !r.include ? { tone: 'slate' as const, label: 'Aktarılmayacak' }
                : c?.error ? { tone: 'red' as const, label: c.error }
                : c && (c.duplicates || c.conflicts) ? { tone: 'amber' as const, label: `${c.duplicates ? `${c.duplicates} mükerrer` : ''}${c.duplicates && c.conflicts ? ', ' : ''}${c.conflicts ? `${c.conflicts} çakışma` : ''} (atlanır)` }
                : c ? { tone: 'green' as const, label: `Hazır · ${c.count} ders${c.warnings ? ` · ${c.warnings} uyarı` : ''}` }
                : { tone: 'slate' as const, label: '…' }
              return (
                <Card key={i} className="p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="checkbox" className="size-5 accent-brand-600" checked={r.include} disabled={r.issues.length > 0} onChange={(e) => update(i, { include: e.target.checked })} aria-label="Bu satırı aktar" />
                    <span className="font-semibold">{r.date ? r.date.split('-').reverse().join('.') : r.weekday ? `Her ${WEEKDAYS[r.weekday - 1]}` : '—'}</span>
                    <span className="tabular-nums text-slate-600">{r.start ?? '??'}–{r.end ?? '??'}</span>
                    <span className="text-slate-500">·</span>
                    <span>{r.name ?? '—'}</span>
                    <Badge tone={badge.tone} className="ml-auto">{badge.label}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-400">Satır {r.line}: {r.raw}</p>
                  {c?.messages?.map((msg) => <p key={msg} className="mt-0.5 text-xs text-amber-700">{msg}</p>)}
                  {r.issues.length === 0 && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      <Select value={r.studentId} onChange={(e) => update(i, { studentId: e.target.value, createNew: false })} aria-label="Öğrenci">
                        <option value="">{m.ambiguous.length ? 'Öğrenci seçin…' : 'Eşleşme yok'}</option>
                        {(m.ambiguous.length ? m.ambiguous : students ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                      </Select>
                      <Select value={r.instructorId} onChange={(e) => update(i, { instructorId: e.target.value })} aria-label="Eğitmen">
                        <option value="">Eğitmen yok</option>
                        {instructors?.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                      </Select>
                      <Select value={r.courseId} onChange={(e) => update(i, { courseId: e.target.value })} aria-label="Kurs">
                        <option value="">{r.course ? `"${r.course}" bulunamadı` : 'Kurs: öğrencinin kursu'}</option>
                        {courses?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </Select>
                      <Select value={r.roomId} onChange={(e) => update(i, { roomId: e.target.value })} aria-label="Sınıf">
                        <option value="">{r.room ? `"${r.room}" bulunamadı` : 'Sınıf yok'}</option>
                        {rooms?.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </Select>
                      {!r.studentId && r.name && can.students && (
                        <div className="sm:col-span-4"><Toggle checked={r.createNew} onChange={(v) => update(i, { createNew: v })} label={`"${r.name}" yeni öğrenci olarak eklensin`} /></div>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
          <Card className="mt-4 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-sm text-slate-600">
                {checks ? `${totals.count - totals.conflicts} ders oluşturulacak${totals.conflicts ? `, ${totals.conflicts} mükerrer/çakışan ders atlanacak` : ''}.` : 'Önizleme hazırlanıyor…'}
              </p>
              <Button size="lg" disabled={!ready.length || checking || !checks || totals.count - totals.conflicts <= 0} loading={save.isPending} onClick={() => save.mutate(undefined)}>
                Onayla ve içeri aktar
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Onaylanan satırlar tek işlemde (transaction) aktarılır; hata olursa hiçbir kayıt yarım kalmaz. Aynı aktarım iki kez uygulanmaz.</p>
          </Card>
        </>
      )}

      {(history ?? []).length > 0 && (
        <>
          <h2 className="mb-2 mt-8 flex items-center gap-1.5 text-sm font-bold text-slate-500"><History className="size-4" />İçe aktarma geçmişi</h2>
          <Card className="divide-y divide-slate-100">
            {history!.map((h) => (
              <div key={h.id} className="flex items-center gap-3 p-3.5 text-sm">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{h.file_name ?? 'Program'}</span><span className="text-xs text-slate-500">{formatDateTime(h.created_at)}</span></span>
                <Badge tone="green">{h.created_count} ders</Badge>
                {h.skipped_count > 0 && <Badge tone="amber">{h.skipped_count} atlandı</Badge>}
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
