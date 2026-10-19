import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, FileSpreadsheet, FileText, Image as ImageIcon, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { useAllSchedules, useInstructors, useStudents, useDbMutation, insertRow, lessonRpc } from '@/lib/api'
import { parseScheduleText, rowsToText, parseCsv, matchStudent, toMinutes, type ParsedRow } from '@/lib/scheduleParser'
import { addMonths, dateKey, WEEKDAYS } from '@/lib/time'
import type { Student, WeeklySchedule } from '@/types/db'
import { Badge, Button, Card, Field, Input, Select, Textarea, Toggle } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'

interface Row extends ParsedRow {
  studentId: string
  instructorId: string
  createNew: boolean
  include: boolean
}

type Status = { tone: 'green' | 'amber' | 'red' | 'slate'; label: string; ok: boolean }

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const lines: string[] = []
  for (let p = 1; p <= Math.min(doc.numPages, 20); p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    // Aynı satırdaki parçaları y koordinatına göre birleştir
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
  const { data: students } = useStudents()
  const { data: instructors } = useInstructors()
  const { data: schedules } = useAllSchedules()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileInfo, setFileInfo] = useState<string | null>(null)
  const [until, setUntil] = useState(addMonths(dateKey(), 1))
  const [result, setResult] = useState<{ schedules: number; lessons: number; skipped: number; students: number } | null>(null)

  const analyze = (source: string) => {
    setError(null)
    setResult(null)
    const parsed = parseScheduleText(source)
    if (!parsed.length) {
      setRows(null)
      setError('Dosyada ders programı satırı bulunamadı. Her satırda gün, öğrenci adı ve saat aralığı olmalıdır (ör. "Pazartesi – Ezgi – 11.00–13.10").')
      return
    }
    setRows(parsed.map((p) => {
      const m = matchStudent(p.name, students ?? [])
      const st = students?.find((s) => s.id === m.id)
      return { ...p, studentId: m.id ?? '', instructorId: st?.instructor_id ?? '', createNew: false, include: p.issues.length === 0 }
    }))
  }

  const onFile = async (file: File) => {
    setError(null)
    setFileInfo(file.name)
    const name = file.name.toLowerCase()
    try {
      if (file.type.startsWith('image/')) {
        setRows(null)
        setError('Görselden program okuma desteklenmiyor: güvenilir bir metin tanıma (OCR) yöntemi olmadan yanlış ders oluşturma riski var. Lütfen programı Excel, CSV, PDF veya metin olarak yükleyin ya da aşağıya yapıştırın.')
        return
      }
      let src = ''
      if (name.endsWith('.xlsx')) {
        const { default: readXlsx } = await import('read-excel-file/browser')
        const sheets = await readXlsx(file)
        src = sheets.map((sh) => rowsToText(sh.data as unknown[][])).join('\n')
      } else if (name.endsWith('.xls')) {
        throw new Error('Eski .xls biçimi desteklenmiyor. Dosyayı Excel\'de .xlsx olarak kaydedip tekrar deneyin.')
      } else if (name.endsWith('.csv')) {
        src = rowsToText(parseCsv(await file.text()))
      } else if (name.endsWith('.pdf')) {
        src = await extractPdfText(file)
        if (!src.trim()) throw new Error('PDF içinde okunabilir metin yok (taranmış görüntü olabilir). Metin içeren bir PDF, Excel veya CSV yükleyin.')
      } else {
        src = await file.text()
      }
      setText(src)
      analyze(src)
    } catch (e) {
      setRows(null)
      setError((e as Error).message)
    }
  }

  const statusOf = useMemo(() => (r: Row, all: Row[]): Status => {
    if (r.issues.length) return { tone: 'red', label: r.issues.join(', '), ok: false }
    if (!r.studentId && !r.createNew) {
      const m = matchStudent(r.name, students ?? [])
      return { tone: 'amber', label: m.ambiguous.length ? 'Birden fazla öğrenci eşleşiyor – seçin' : 'Öğrenci bulunamadı', ok: false }
    }
    const s = toMinutes(r.start!), e = toMinutes(r.end!)
    const overlaps = (ws: Pick<WeeklySchedule, 'weekday' | 'start_time' | 'duration_minutes'>) => {
      const ws0 = toMinutes(ws.start_time.slice(0, 5))
      return ws.weekday === r.weekday && ws0 < e && s < ws0 + ws.duration_minutes
    }
    const existing = (schedules ?? []).filter((w) => w.student_id === r.studentId && w.weekday === r.weekday && w.start_time.slice(0, 5) === r.start)
    if (r.studentId && existing.length) return { tone: 'slate', label: 'Bu program zaten kayıtlı', ok: false }
    const instrConflict = r.instructorId && (schedules ?? []).some((w) => {
      const ins = w.instructor_id ?? students?.find((x) => x.id === w.student_id)?.instructor_id
      return ins === r.instructorId && overlaps(w)
    })
    const dupInFile = all.some((o) => o !== r && o.include && o.weekday === r.weekday && o.start === r.start && ((r.studentId && o.studentId === r.studentId) || (r.instructorId && o.instructorId === r.instructorId)))
    if (instrConflict) return { tone: 'red', label: 'Eğitmenin bu saatte başka programı var', ok: false }
    if (dupInFile) return { tone: 'amber', label: 'Dosyada aynı saatte tekrar ediyor', ok: false }
    return { tone: 'green', label: 'Hazır', ok: true }
  }, [schedules, students])

  const ready = (rows ?? []).filter((r) => r.include && statusOf(r, rows!).ok)

  const save = useDbMutation(
    async () => {
      let created = 0, lessons = 0, skipped = 0, newStudents = 0
      const createdIds = new Map<string, string>()
      for (const r of ready) {
        let sid = r.studentId
        if (!sid && r.createNew && r.name) {
          sid = createdIds.get(r.name) ?? ''
          if (!sid) {
            const s = await insertRow<Student>('students', { full_name: r.name, instructor_id: r.instructorId || null })
            sid = s.id
            createdIds.set(r.name, sid)
            newStudents++
          }
        }
        const sc = await insertRow<WeeklySchedule>('weekly_schedules', {
          student_id: sid, instructor_id: r.instructorId || null, weekday: r.weekday, start_time: r.start,
          duration_minutes: toMinutes(r.end!) - toMinutes(r.start!),
        })
        created++
        const g = await lessonRpc.generate(sc.id, dateKey(), until)
        lessons += g.created
        skipped += g.skipped
      }
      return { schedules: created, lessons, skipped, students: newStudents }
    },
    {
      success: (r) => `${r.schedules} program, ${r.lessons} ders oluşturuldu${r.skipped ? ` (${r.skipped} çakışma atlandı)` : ''}`,
      invalidate: ['all-schedules', 'schedules', 'lessons', 'students'],
      onSuccess: (r) => { setResult(r); setRows(null); setText('') },
    },
  )

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader back title="Program yükle" subtitle="Mevcut ders programınızı dosyadan aktarın. Onaylamadan hiçbir kayıt oluşturulmaz." />

      {result && (
        <Card className="mb-4 flex items-start gap-3 border-emerald-200 p-4 dark:border-emerald-500/30">
          <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <p className="font-semibold">Aktarım tamamlandı</p>
            <p className="text-slate-600 dark:text-slate-300">{result.schedules} haftalık program ve {result.lessons} ders oluşturuldu{result.students ? `, ${result.students} yeni öğrenci eklendi` : ''}{result.skipped ? `. ${result.skipped} ders çakışma nedeniyle atlandı` : ''}.</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigate('/takvim?gorunum=hafta')}>Takvimde gör</Button>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <input ref={fileRef} type="file" hidden accept=".xlsx,.csv,.txt,.pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 px-4 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40 dark:border-white/10 dark:hover:bg-white/5">
          <FileUp className="size-8 text-brand-600" />
          <span className="font-semibold">{fileInfo ?? 'Dosya seçin'}</span>
          <span className="text-xs text-slate-500">Excel (.xlsx), CSV, PDF veya metin dosyası</span>
          <span className="mt-1 flex gap-3 text-slate-400"><FileSpreadsheet className="size-4" /><FileText className="size-4" /><ImageIcon className="size-4 opacity-40" /></span>
        </button>
        <Field label="…veya programı yapıştırın" className="mt-4" hint="Her satıra bir ders: Gün – Öğrenci – Başlangıç–Bitiş">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Pazartesi – Ezgi – 11.00–13.10\nÇarşamba – Doğa – 13.45–15.55\nCuma – Burcu – 13.30–15.40'} />
        </Field>
        <div className="mt-3 flex justify-end"><Button variant="secondary" disabled={!text.trim()} onClick={() => analyze(text)}>Önizle</Button></div>
        {error && <p role="alert" className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"><AlertTriangle className="size-4 shrink-0" />{error}</p>}
      </Card>

      {rows && (
        <>
          <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Önizleme · {rows.length} satır, {ready.length} hazır</h2>
            <p className="flex items-center gap-1 text-xs text-slate-500"><Info className="size-3.5" />Sorunlu satırlar aktarılmaz.</p>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => {
              const st = statusOf(r, rows)
              const m = matchStudent(r.name, students ?? [])
              return (
                <Card key={i} className="p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="checkbox" className="size-5 accent-brand-600" checked={r.include} disabled={r.issues.length > 0} onChange={(e) => update(i, { include: e.target.checked })} aria-label="Bu satırı aktar" />
                    <span className="font-semibold">{r.weekday ? WEEKDAYS[r.weekday - 1] : '—'}</span>
                    <span className="tabular-nums text-slate-600 dark:text-slate-300">{r.start ?? '??'}–{r.end ?? '??'}</span>
                    <span className="text-slate-500">·</span>
                    <span>{r.name ?? '—'}</span>
                    <Badge tone={st.tone} className="ml-auto">{st.label}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-400">Satır {r.line}: {r.raw}</p>
                  {r.issues.length === 0 && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <Select value={r.studentId} onChange={(e) => { const s = students?.find((x) => x.id === e.target.value); update(i, { studentId: e.target.value, createNew: false, instructorId: s?.instructor_id ?? r.instructorId }) }} aria-label="Öğrenci">
                        <option value="">{m.ambiguous.length ? 'Öğrenci seçin…' : 'Eşleşme yok'}</option>
                        {(m.ambiguous.length ? m.ambiguous : students ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                      </Select>
                      <Select value={r.instructorId} onChange={(e) => update(i, { instructorId: e.target.value })} aria-label="Eğitmen">
                        <option value="">Eğitmen yok</option>
                        {instructors?.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                      </Select>
                      {!r.studentId && r.name && (
                        <Toggle checked={r.createNew} onChange={(v) => update(i, { createNew: v })} label={`"${r.name}" yeni öğrenci olarak eklensin`} />
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
          <Card className="mt-4 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Şu tarihe kadar ders oluştur" className="w-52"><Input type="date" value={until} min={dateKey()} onChange={(e) => setUntil(e.target.value)} /></Field>
              <Button size="lg" className="ml-auto" disabled={!ready.length} loading={save.isPending} onClick={() => save.mutate(undefined)}>
                {ready.length} programı onayla ve oluştur
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Zaten kayıtlı programlar ve çakışan dersler otomatik atlanır; aynı ders iki kez oluşturulmaz.</p>
          </Card>
        </>
      )}
    </div>
  )
}
