import { useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet, Users, CheckCircle2, UserX, Wallet } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useBalances, useInstructors, useLessons, usePayments, useStudents, useReportSummary } from '@/lib/api'
import { saveOrShare } from '@/lib/csv'
import { addDays, addMonths, dateKey, formatDate, fromIstanbul, startOfMonth, startOfWeek, diffDays } from '@/lib/time'
import { formatMoney, PAYMENT_METHOD } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import { downloadPdf } from '@/lib/pdf'
import { useToast } from '@/components/ui/Toast'
import { Button, Card, Field, Input, PageLoader, SectionTitle, Segmented, Select, Stat } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'

type Period = 'gun' | 'hafta' | 'ay' | 'ozel'

export function ReportsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const today = dateKey()
  const [period, setPeriod] = useState<Period>('ay')
  const [customFrom, setCustomFrom] = useState(startOfMonth(today))
  const [customTo, setCustomTo] = useState(today)
  const [from, to] = useMemo(() => {
    if (period === 'gun') return [today, addDays(today, 1)]
    if (period === 'hafta') { const s = startOfWeek(today); return [s, addDays(s, 7)] }
    if (period === 'ay') { const s = startOfMonth(today); return [s, addMonths(s, 1)] }
    return [customFrom, addDays(customTo, 1)]
  }, [period, today, customFrom, customTo])

  const [instr, setInstr] = useState('')
  const lessonsQ = useLessons(fromIstanbul(from).toISOString(), fromIstanbul(to).toISOString(), { instructorId: instr || null })
  const summaryQ = useReportSummary(from, addDays(to, -1), instr || null)
  const sm = summaryQ.data
  const { data: students } = useStudents()
  const { data: instructors } = useInstructors()
  const payQ = usePayments(undefined, can.payments)
  const { data: balances } = useBalances(can.payments)
  const [busy, setBusy] = useState(false)

  const r = useMemo(() => {
    const ls = lessonsQ.data ?? []
    const pays = (payQ.data ?? []).filter((p) => !p.is_void && p.paid_at >= from && p.paid_at < to)
    const byInstr = (instructors ?? []).map((i) => {
      const mine = ls.filter((l) => l.instructor_id === i.id)
      return {
        name: i.full_name,
        planned: mine.filter((l) => l.status === 'planlandi').length,
        done: mine.filter((l) => l.status === 'tamamlandi').length,
        cancelled: mine.filter((l) => l.status === 'iptal').length,
        absent: mine.filter((l) => l.attendance?.status === 'katilmadi').length,
      }
    }).filter((x) => x.planned + x.done + x.cancelled > 0)
    const days = Math.max(1, diffDays(to, from))
    const daily = Array.from({ length: Math.min(days, 62) }, (_, i) => {
      const d = addDays(from, i)
      const dl = ls.filter((l) => dateKey(l.starts_at) === d)
      return {
        d,
        total: dl.length,
        done: dl.filter((l) => l.status === 'tamamlandi').length,
        absent: dl.filter((l) => l.attendance?.status === 'katilmadi').length,
        income: pays.filter((p) => p.paid_at === d).reduce((a, p) => a + Number(p.amount), 0),
      }
    })
    const absentees = new Map<string, number>()
    for (const l of ls) if (l.attendance?.status === 'katilmadi' && l.student) absentees.set(l.student.full_name, (absentees.get(l.student.full_name) ?? 0) + 1)
    return {
      total: ls.length,
      planned: ls.filter((l) => l.status === 'planlandi').length,
      done: ls.filter((l) => l.status === 'tamamlandi').length,
      cancelled: ls.filter((l) => l.status === 'iptal').length,
      postponed: ls.filter((l) => l.status === 'ertelendi').length,
      attended: ls.filter((l) => l.attendance?.status === 'katildi').length,
      absent: ls.filter((l) => l.attendance?.status === 'katilmadi').length,
      excused: ls.filter((l) => l.attendance?.status === 'izinli').length,
      activeStudents: students?.filter((s) => s.is_active).length ?? 0,
      passiveStudents: students?.filter((s) => !s.is_active).length ?? 0,
      newStudents: students?.filter((s) => { const k = dateKey(s.created_at); return k >= from && k < to }).length ?? 0,
      income: pays.reduce((a, p) => a + Number(p.amount), 0),
      receivable: (balances ?? []).reduce((a, b) => a + Math.max(0, Number(b.balance)), 0),
      byInstr, daily, pays,
      absentees: [...absentees.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [lessonsQ.data, payQ.data, instructors, students, balances, from, to])

  const rangeLabel = `${formatDate(from)} – ${formatDate(addDays(to, -1))}`
  const attendanceRate = r.attended + r.absent > 0 ? Math.round((r.attended / (r.attended + r.absent)) * 100) : 0

  const exportCsv = () => {
    downloadCsv(`mutu-akademi-rapor-${from}`, ['Tarih', 'Toplam ders', 'Tamamlanan', 'Devamsız', ...(can.payments ? ['Tahsilat (TL)'] : [])],
      r.daily.map((d) => [formatDate(d.d), d.total, d.done, d.absent, ...(can.payments ? [d.income.toFixed(2)] : [])]))
    toast.success('CSV indirildi')
  }
  const exportLessonsCsv = () => {
    downloadCsv(`mutu-akademi-dersler-${from}`, ['Tarih', 'Saat', 'Öğrenci', 'Eğitmen', 'Kurs', 'Durum', 'Yoklama'],
      (lessonsQ.data ?? []).map((l) => [formatDate(l.starts_at), new Date(l.starts_at).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
        l.student?.full_name, l.instructor?.full_name, l.course?.name, l.status, l.attendance?.status ?? '']))
    toast.success('Ders listesi indirildi')
  }
  const exportXlsx = async () => {
    setBusy(true)
    try {
      const { default: writeXlsxFile } = await import('write-excel-file')
      const head = (h: string[]) => h.map((value) => ({ value, fontWeight: 'bold' as const, backgroundColor: '#e2e8f0' }))
      const cells = (rows: (string | number)[][]) => rows.map((row) => row.map((value) => ({ value })))
      const summaryRows: (string | number)[][] = [
        ['Dönem', rangeLabel], ['Aktif öğrenci', sm?.active_students ?? r.activeStudents], ['Yeni kayıt', sm?.new_students ?? r.newStudents],
        ['Bugün ders', sm?.today ?? 0], ['Bu hafta ders', sm?.this_week ?? 0], ['Bu ay ders', sm?.this_month ?? 0],
        ['Tamamlanan', sm?.completed ?? r.done], ['İptal edilen', sm?.cancelled ?? r.cancelled], ['Ertelenen', sm?.postponed ?? r.postponed],
        ['Devamsızlık oranı (%)', sm?.absence_rate ?? 0], ['Verilen ders saati', sm?.hours ?? 0],
        ...(sm?.pending_payments ? [['Bekleyen ödeme (öğrenci)', sm.pending_payments.students], ['Bekleyen ödeme (TL)', Number(sm.pending_payments.amount)]] : []),
      ]
      const blob = (await writeXlsxFile([
        [head(['Özet', 'Değer']), ...cells(summaryRows)],
        [head(['Eğitmen', 'Ders', 'Tamamlanan', 'İptal', 'Ertelenen', 'Devamsız', 'Katıldı', 'Saat']),
          ...cells((sm?.by_instructor ?? []).map((x) => [x.name, x.total, x.completed, x.cancelled, x.postponed, x.absent, x.attended, x.hours]))],
        [head(['Öğrenci', 'Kalan hak', 'Toplam hak']), ...cells((sm?.low_credit ?? []).map((x) => [x.name, x.remaining, x.total]))],
      ] as never, { sheets: ['Özet', 'Eğitmenler', 'Ders hakları'] } as never)) as unknown as Blob
      await saveOrShare(blob, `mutu-akademi-rapor-${from}.xlsx`)
      toast.success('Excel hazırlandı')
    } catch (e) {
      toast.error(`Excel oluşturulamadı: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  const exportPdf = async () => {
    setBusy(true)
    try {
      await downloadPdf(`mutu-akademi-rapor-${from}`, 'Dönem Raporu', rangeLabel, [
        { title: 'Özet', headers: ['Gösterge', 'Değer'], rows: [
          ['Aktif öğrenci', r.activeStudents], ['Yeni kayıt', r.newStudents], ['Toplam ders', r.total], ['Tamamlanan', r.done],
          ['İptal', r.cancelled], ['Ertelenen', r.postponed], ['Katıldı', r.attended], ['Katılmadı', r.absent], ['İzinli', r.excused],
          ['Katılım oranı', `%${attendanceRate}`], ...(can.payments ? [['Tahsilat', formatMoney(r.income)], ['Toplam alacak', formatMoney(r.receivable)]] as [string, string][] : []),
        ] },
        { title: 'Eğitmen performansı', headers: ['Eğitmen', 'Ders', 'Tamamlanan', 'İptal', 'Ertelenen', 'Devamsız', 'Saat'],
          rows: (sm?.by_instructor ?? []).map((x) => [x.name, x.total, x.completed, x.cancelled, x.postponed, x.absent, x.hours]) },
        { title: 'Kalan ders hakkı azalan öğrenciler', headers: ['Öğrenci', 'Kalan / toplam'], rows: (sm?.low_credit ?? []).map((x) => [x.name, `${x.remaining} / ${x.total}`]) },
        { title: 'Devamsızlık', headers: ['Öğrenci', 'Devamsız ders'], rows: r.absentees.map(([n, c]) => [n, c]) },
        { title: 'Günlük', headers: ['Tarih', 'Ders', 'Tamamlanan', 'Devamsız', ...(can.payments ? ['Tahsilat'] : [])],
          rows: r.daily.filter((d) => d.total || d.income).map((d) => [formatDate(d.d), d.total, d.done, d.absent, ...(can.payments ? [formatMoney(d.income)] : [])]) },
        ...(can.payments ? [{ title: 'Ödemeler', headers: ['Tarih', 'Öğrenci', 'Yöntem', 'Tutar'],
          rows: r.pays.map((p) => [formatDate(p.paid_at), students?.find((s) => s.id === p.student_id)?.full_name ?? '', PAYMENT_METHOD[p.method], formatMoney(p.amount)]) }] : []),
      ])
      toast.success('PDF indirildi')
    } catch (e) {
      toast.error(`PDF oluşturulamadı: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Raporlar" subtitle={rangeLabel}
        actions={<>
          <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={exportCsv}>CSV</Button>
          <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={exportLessonsCsv}>Ders listesi</Button>
          <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} loading={busy} onClick={() => void exportXlsx()}>Excel</Button>
          <Button icon={<FileDown className="size-4" />} loading={busy} onClick={exportPdf}>PDF</Button>
        </>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmented value={period} onChange={setPeriod} options={[{ value: 'gun', label: 'Bugün' }, { value: 'hafta', label: 'Bu hafta' }, { value: 'ay', label: 'Bu ay' }, { value: 'ozel', label: 'Özel' }]} />
        {period === 'ozel' && (
          <div className="flex gap-2">
            <Field label="Başlangıç"><Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></Field>
            <Field label="Bitiş"><Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></Field>
          </div>
        )}
        <Select value={instr} onChange={(e) => setInstr(e.target.value)} className="h-10 w-48 text-sm" aria-label="Eğitmen filtresi">
          <option value="">Tüm eğitmenler</option>
          {instructors?.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
        </Select>
      </div>
      {sm && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[['Bugün', sm.today], ['Bu hafta', sm.this_week], ['Bu ay', sm.this_month], ['Ertelenen', sm.postponed], ['İptal', sm.cancelled], ['Devamsızlık', `%${sm.absence_rate}`]].map(([k, v]) => (
              <Card key={k as string} className="p-3 text-center"><p className="text-xl font-bold tabular-nums">{v}</p><p className="text-xs text-slate-500">{k}{k === 'Bugün' || k === 'Bu hafta' || k === 'Bu ay' ? ' ders' : ''}</p></Card>
            ))}
          </div>
          {sm.pending_payments && Number(sm.pending_payments.amount) > 0 && (
            <Card className="mb-4 flex flex-wrap items-center gap-3 p-4 text-sm">
              <Wallet className="size-5 text-amber-600" />
              <span className="flex-1"><b>Bekleyen ödemeler:</b> {sm.pending_payments.students} öğrenci · {formatMoney(sm.pending_payments.amount)}{sm.pending_payments.overdue ? ` · ${sm.pending_payments.overdue} gecikmiş taksit (${formatMoney(sm.pending_payments.overdue_amount)})` : ''}</span>
            </Card>
          )}
        </>
      )}
      {lessonsQ.isLoading ? <PageLoader /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={`Aktif öğrenci (+${r.newStudents} yeni)`} value={r.activeStudents} icon={<Users className="size-5" />} tone="brand" />
            <Stat label="Tamamlanan ders" value={`${r.done}/${r.total}`} icon={<CheckCircle2 className="size-5" />} tone="green" />
            <Stat label={`Devamsızlık (katılım %${attendanceRate})`} value={r.absent} icon={<UserX className="size-5" />} tone="accent" />
            {can.payments && <Stat label="Tahsilat" value={formatMoney(r.income)} icon={<Wallet className="size-5" />} tone="sun" />}
          </div>

          <SectionTitle>Ders durumları</SectionTitle>
          <Card className="p-4">
            {[
              ['Tamamlandı', r.done, '#10b981'], ['Planlandı', r.planned, '#29a8df'], ['Ertelendi', r.postponed, '#f59e0b'], ['İptal', r.cancelled, '#94a3b8'],
            ].map(([label, n, c]) => (
              <div key={label as string} className="mb-2 last:mb-0">
                <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="font-semibold tabular-nums">{n}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full rounded-full" style={{ width: `${r.total ? ((n as number) / r.total) * 100 : 0}%`, background: c as string }} /></div>
              </div>
            ))}
          </Card>

          <div className="grid gap-x-6 lg:grid-cols-2">
            <div>
              <SectionTitle>Eğitmen performansı</SectionTitle>
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><th className="p-3">Eğitmen</th><th className="p-3 text-right">Ders</th><th className="p-3 text-right">Tamam</th><th className="p-3 text-right">İptal</th><th className="p-3 text-right">Ertelenen</th><th className="p-3 text-right">Devamsız</th><th className="p-3 text-right">Saat</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(sm?.by_instructor ?? []).length === 0 && <tr><td colSpan={7} className="p-3 text-slate-500">Bu dönemde ders yok.</td></tr>}
                    {(sm?.by_instructor ?? []).map((x) => <tr key={x.id}><td className="p-3 font-medium">{x.name}</td><td className="p-3 text-right tabular-nums">{x.total}</td><td className="p-3 text-right tabular-nums">{x.completed}</td><td className="p-3 text-right tabular-nums">{x.cancelled}</td><td className="p-3 text-right tabular-nums">{x.postponed}</td><td className="p-3 text-right tabular-nums">{x.absent}</td><td className="p-3 text-right tabular-nums">{x.hours}</td></tr>)}
                  </tbody>
                </table>
              </Card>
              {sm && Object.keys(sm.postpone_reasons).length > 0 && (
                <>
                  <SectionTitle>Erteleme nedenleri</SectionTitle>
                  <Card className="divide-y divide-slate-100">
                    {Object.entries(sm.postpone_reasons).map(([k, v]) => <div key={k} className="flex justify-between p-3 text-sm"><span>{k}</span><b>{v}</b></div>)}
                  </Card>
                </>
              )}
              <SectionTitle>Kalan ders hakkı azalanlar</SectionTitle>
              <Card className="divide-y divide-slate-100">
                {(sm?.low_credit ?? []).length === 0 && <p className="p-3 text-sm text-slate-500">Hakkı azalan öğrenci yok.</p>}
                {(sm?.low_credit ?? []).map((x) => <div key={x.id} className="flex justify-between p-3 text-sm"><span>{x.name}</span><span className="font-semibold text-red-600">{x.remaining} / {x.total}</span></div>)}
              </Card>
            </div>
            <div>
              <SectionTitle>Devamsızlık</SectionTitle>
              <Card className="divide-y divide-slate-100 dark:divide-white/10">
                {r.absentees.length === 0 && <p className="p-3 text-sm text-slate-500">Bu dönemde devamsızlık yok.</p>}
                {r.absentees.slice(0, 15).map(([n, c]) => <div key={n} className="flex justify-between p-3 text-sm"><span>{n}</span><span className="font-semibold text-accent-600">{c} ders</span></div>)}
              </Card>
              {can.payments && (
                <>
                  <SectionTitle>Ödeme durumu</SectionTitle>
                  <Card className="divide-y divide-slate-100 text-sm dark:divide-white/10">
                    <div className="flex justify-between p-3"><span>Dönem tahsilatı</span><b>{formatMoney(r.income)}</b></div>
                    <div className="flex justify-between p-3"><span>Toplam alacak</span><b className="text-red-600">{formatMoney(r.receivable)}</b></div>
                    <div className="flex justify-between p-3"><span>Ödeme sayısı</span><b>{r.pays.length}</b></div>
                  </Card>
                </>
              )}
            </div>
          </div>

          <SectionTitle>Günlük istatistik</SectionTitle>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="p-3">Tarih</th><th className="p-3 text-right">Ders</th><th className="p-3 text-right">Tamam</th><th className="p-3 text-right">Devamsız</th>{can.payments && <th className="p-3 text-right">Tahsilat</th>}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                {r.daily.filter((d) => d.total || d.income).map((d) => (
                  <tr key={d.d}><td className="p-3">{formatDate(d.d)}</td><td className="p-3 text-right tabular-nums">{d.total}</td><td className="p-3 text-right tabular-nums">{d.done}</td><td className="p-3 text-right tabular-nums">{d.absent}</td>{can.payments && <td className="p-3 text-right tabular-nums">{formatMoney(d.income)}</td>}</tr>
                ))}
                {r.daily.every((d) => !d.total && !d.income) && <tr><td colSpan={5} className="p-3 text-slate-500">Veri yok.</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}
