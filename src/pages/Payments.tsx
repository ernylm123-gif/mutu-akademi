import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Wallet, AlertTriangle, CalendarClock, TrendingUp, Plus } from 'lucide-react'
import { useBalances, useInstallments, usePayments, useStudents } from '@/lib/api'
import { addDays, dateKey, formatDate } from '@/lib/time'
import { formatMoney, INSTALLMENT_STATUS, matchesSearch, PAYMENT_METHOD } from '@/lib/format'
import { Badge, Button, Card, Input, PageLoader, SectionTitle, Segmented, Sheet, Stat } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { PaymentFormSheet } from '@/components/forms/PaymentForms'

export function PaymentsPage() {
  const navigate = useNavigate()
  const { data: students } = useStudents()
  const balancesQ = useBalances()
  const instQ = useInstallments()
  const payQ = usePayments()
  const [tab, setTab] = useState<'borclu' | 'vade' | 'gecmis'>('borclu')
  const [params] = useSearchParams()
  const [pick, setPick] = useState(params.get('yeni') === '1')
  const [search, setSearch] = useState('')
  const [payFor, setPayFor] = useState<{ id: string; name: string } | null>(null)

  const today = dateKey()
  const monthPrefix = today.slice(0, 7)
  const totals = useMemo(() => {
    const valid = (payQ.data ?? []).filter((p) => !p.is_void)
    return {
      month: valid.filter((p) => p.paid_at.startsWith(monthPrefix)).reduce((a, p) => a + Number(p.amount), 0),
      receivable: (balancesQ.data ?? []).reduce((a, b) => a + Math.max(0, Number(b.balance)), 0),
      overdue: (instQ.data ?? []).filter((i) => i.status === 'gecikti').reduce((a, i) => a + Number(i.amount) - Number(i.covered), 0),
    }
  }, [payQ.data, balancesQ.data, instQ.data, monthPrefix])

  if (balancesQ.isLoading || instQ.isLoading || payQ.isLoading) return <PageLoader />
  const name = (id: string) => students?.find((s) => s.id === id)?.full_name ?? 'Öğrenci'
  const debtors = (balancesQ.data ?? []).filter((b) => Number(b.balance) > 0).sort((a, b) => Number(b.balance) - Number(a.balance))
  const due = (instQ.data ?? []).filter((i) => i.status !== 'odendi' && i.due_date <= addDays(today, 30))

  return (
    <div>
      <PageHeader title="Ödemeler" actions={<Button icon={<Plus className="size-4" />} onClick={() => setPick(true)}>Ödeme ekle</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Bu ay tahsilat" value={formatMoney(totals.month)} icon={<TrendingUp className="size-5" />} tone="green" />
        <Stat label="Toplam alacak" value={formatMoney(totals.receivable)} icon={<Wallet className="size-5" />} tone="brand" />
        <Stat label="Gecikmiş" value={formatMoney(totals.overdue)} icon={<AlertTriangle className="size-5" />} tone="red" />
      </div>
      <div className="mt-5 mb-3"><Segmented value={tab} onChange={setTab} options={[{ value: 'borclu', label: 'Borçlular' }, { value: 'vade', label: 'Vadesi gelen' }, { value: 'gecmis', label: 'Geçmiş' }]} /></div>
      {tab === 'borclu' && (
        <Card className="divide-y divide-slate-100 dark:divide-white/10">
          {debtors.length === 0 && <p className="p-4 text-sm text-slate-500">Borcu olan öğrenci yok.</p>}
          {debtors.map((b) => (
            <div key={b.student_id} className="flex items-center gap-3 p-3.5">
              <button onClick={() => navigate(`/ogrenciler/${b.student_id}`)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-semibold">{b.full_name}</span>
                <span className="block text-xs text-slate-500">Ödenen {formatMoney(b.paid)} / {formatMoney(b.total_fee)}</span>
              </button>
              <span className="font-bold tabular-nums text-red-600">{formatMoney(b.balance)}</span>
              <Button size="sm" variant="secondary" onClick={() => setPayFor({ id: b.student_id, name: b.full_name })}>Tahsil et</Button>
            </div>
          ))}
        </Card>
      )}
      {tab === 'vade' && (
        <Card className="divide-y divide-slate-100 dark:divide-white/10">
          {due.length === 0 && <p className="p-4 text-sm text-slate-500">30 gün içinde vadesi gelen taksit yok.</p>}
          {due.map((i) => (
            <button key={i.id} onClick={() => navigate(`/ogrenciler/${i.student_id}`)} className="flex w-full items-center gap-3 p-3.5 text-left">
              <CalendarClock className="size-4 text-slate-400" />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{name(i.student_id)}</span><span className="block text-xs text-slate-500">Vade {formatDate(i.due_date)}</span></span>
              <span className="font-semibold tabular-nums">{formatMoney(Number(i.amount) - Number(i.covered))}</span>
              <Badge tone={INSTALLMENT_STATUS[i.status].tone}>{INSTALLMENT_STATUS[i.status].label}</Badge>
            </button>
          ))}
        </Card>
      )}
      {tab === 'gecmis' && (
        <>
          <SectionTitle>Son ödemeler</SectionTitle>
          <Card className="divide-y divide-slate-100 dark:divide-white/10">
            {(payQ.data ?? []).slice(0, 100).map((p) => (
              <button key={p.id} onClick={() => navigate(`/ogrenciler/${p.student_id}`)} className={`flex w-full items-center gap-3 p-3.5 text-left ${p.is_void ? 'opacity-50' : ''}`}>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{name(p.student_id)}</span><span className="block text-xs text-slate-500">{formatDate(p.paid_at)} · {PAYMENT_METHOD[p.method]}{p.is_void ? ' · İPTAL' : ''}</span></span>
                <span className={`font-bold tabular-nums ${p.is_void ? 'line-through' : 'text-emerald-600'}`}>{formatMoney(p.amount)}</span>
              </button>
            ))}
          </Card>
        </>
      )}
      <Sheet open={pick} onClose={() => setPick(false)} title="Öğrenci seçin">
        <Input placeholder="Öğrenci ara…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div className="mt-3 max-h-[50vh] divide-y divide-slate-100 overflow-y-auto dark:divide-white/10">
          {(students ?? []).filter((s) => matchesSearch([s.full_name, s.phone], search)).map((s) => (
            <button key={s.id} className="flex w-full items-center justify-between p-3 text-left" onClick={() => { setPick(false); setPayFor({ id: s.id, name: s.full_name }) }}>
              <span className="font-medium">{s.full_name}</span>
              <span className="text-xs text-slate-500">{formatMoney(balancesQ.data?.find((b) => b.student_id === s.id)?.balance ?? 0)}</span>
            </button>
          ))}
        </div>
      </Sheet>
      {payFor && <PaymentFormSheet open onClose={() => setPayFor(null)} studentId={payFor.id} studentName={payFor.name} />}
    </div>
  )
}
