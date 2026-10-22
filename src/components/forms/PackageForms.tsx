import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { PackagePlus, MinusCircle, PlusCircle, Ban } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDbMutation, usePackages, rpc, newRequestId } from '@/lib/api'
import { dateKey, formatDate, formatDayShort, timeHM } from '@/lib/time'
import { ATTENDANCE_STATUS, formatMoney } from '@/lib/format'
import type { LessonPackage, LessonWithRelations, Student } from '@/types/db'
import { Badge, Button, Card, EmptyState, Field, Input, Segmented, Sheet, Textarea, Toggle } from '@/components/ui'

const INV = ['packages', 'students', 'student', 'balances', 'activities']

/** Ders hakları: paket ve düzeltme hareketleri (+) ile gerçekleşen dersler (−). Kalan hak bunlardan hesaplanır. */
export function CreditsTab({ student, lessons }: { student: Student; lessons: LessonWithRelations[] }) {
  const { can } = useAuth()
  const { data: packages } = usePackages(student.id)
  const [adding, setAdding] = useState(false)
  const [voiding, setVoiding] = useState<LessonPackage | null>(null)
  const used = useMemo(() => lessons.filter((l) => l.credit_used).sort((a, b) => b.starts_at.localeCompare(a.starts_at)), [lessons])
  const moves = useMemo(() => [
    ...(packages ?? []).map((p) => ({ key: p.id, at: p.created_at, pkg: p as LessonPackage | null, lesson: null as LessonWithRelations | null })),
    ...used.map((l) => ({ key: l.id, at: l.starts_at, pkg: null as LessonPackage | null, lesson: l as LessonWithRelations | null })),
  ].sort((a, b) => b.at.localeCompare(a.at)), [packages, used])

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3.5"><p className="text-xs text-slate-500">Toplam hak</p><p className="mt-1 text-xl font-bold tabular-nums">{student.total_lessons}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-slate-500">Kullanılan</p><p className="mt-1 text-xl font-bold tabular-nums text-brand-600">{student.used_lessons}</p></Card>
        <Card className="p-3.5"><p className="text-xs text-slate-500">Kalan</p><p className={clsx('mt-1 text-xl font-bold tabular-nums', student.remaining_lessons <= 2 && student.total_lessons > 0 && 'text-red-600')}>{student.remaining_lessons}</p></Card>
      </div>
      <p className="mt-2 text-xs text-slate-500">Kalan hak elle yazılmaz: paketlerden ve gerçekleşen derslerden otomatik hesaplanır. Ertelenen ve iptal edilen dersler hak düşürmez.</p>
      {can.students && <Button className="mt-3" block icon={<PackagePlus className="size-4" />} onClick={() => setAdding(true)}>Ders paketi / düzeltme ekle</Button>}

      <h3 className="mb-2 mt-5 text-sm font-bold text-slate-500">Ders hakkı hareketleri</h3>
      {moves.length === 0 ? <Card><EmptyState title="Hareket yok" text="Paket eklendiğinde ve dersler tamamlandığında burada görünür." /></Card> : (
        <Card className="divide-y divide-slate-100">
          {moves.map((m) => m.pkg ? (
            <div key={m.key} className={clsx('flex items-center gap-3 p-3.5', m.pkg.is_void && 'opacity-50')}>
              <PlusCircle className={clsx('size-5 shrink-0', m.pkg.lesson_count > 0 ? 'text-emerald-600' : 'text-red-600')} />
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate text-sm font-semibold', m.pkg.is_void && 'line-through')}>{m.pkg.name}</span>
                <span className="block text-xs text-slate-500">{formatDate(m.pkg.purchased_at)}{m.pkg.kind === 'duzeltme' ? ' · düzeltme' : ''}{can.payments && m.pkg.price > 0 ? ` · ${formatMoney(m.pkg.price)}` : ''}{m.pkg.note ? ` · ${m.pkg.note}` : ''}</span>
                {m.pkg.is_void && <span className="block text-xs text-red-600">Geçersiz: {m.pkg.void_reason}</span>}
              </span>
              <span className={clsx('font-bold tabular-nums', m.pkg.lesson_count > 0 ? 'text-emerald-700' : 'text-red-700')}>{m.pkg.lesson_count > 0 ? '+' : ''}{m.pkg.lesson_count}</span>
              {can.students && !m.pkg.is_void && <Button size="sm" variant="ghost" icon={<Ban className="size-4" />} onClick={() => setVoiding(m.pkg)} aria-label="Hareketi geçersiz kıl" />}
            </div>
          ) : m.lesson && (
            <div key={m.key} className="flex items-center gap-3 p-3.5">
              <MinusCircle className="size-5 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{m.lesson.title || m.lesson.course?.name || 'Ders'}</span>
                <span className="block text-xs text-slate-500">{formatDayShort(dateKey(m.lesson.starts_at))} {timeHM(m.lesson.starts_at)}{m.lesson.attendance ? ` · ${ATTENDANCE_STATUS[m.lesson.attendance.status].label}` : ''}</span>
              </span>
              <span className="font-bold tabular-nums text-slate-600">−1</span>
            </div>
          ))}
        </Card>
      )}
      <PackageSheet open={adding} onClose={() => setAdding(false)} student={student} />
      <VoidPackageSheet pkg={voiding} onClose={() => setVoiding(null)} />
    </div>
  )
}

function PackageSheet({ open, onClose, student }: { open: boolean; onClose: () => void; student: Student }) {
  const { can } = useAuth()
  const [kind, setKind] = useState<'paket' | 'duzeltme'>('paket')
  const [name, setName] = useState('')
  const [count, setCount] = useState(8)
  const [price, setPrice] = useState(0)
  const [addFee, setAddFee] = useState(true)
  const [note, setNote] = useState('')
  const reqId = useRef(newRequestId())
  useEffect(() => {
    if (!open) return
    setKind('paket'); setName(''); setCount(8); setPrice(0); setAddFee(true); setNote('')
    reqId.current = newRequestId()
  }, [open])
  const valid = kind === 'paket' ? count >= 1 && count <= 500 : count !== 0 && Math.abs(count) <= 500
  const save = useDbMutation(
    () => rpc<LessonPackage>('add_lesson_package', {
      p_student_id: student.id, p_name: name.trim() || (kind === 'paket' ? `${count} derslik paket` : 'Düzeltme'),
      p_lesson_count: count, p_price: kind === 'paket' ? price : 0, p_add_fee: kind === 'paket' && addFee,
      p_note: note.trim() || null, p_kind: kind, p_request_id: reqId.current,
    }),
    { success: (p) => `${p.lesson_count > 0 ? '+' : ''}${p.lesson_count} ders hakkı kaydedildi`, invalidate: INV, onSuccess: onClose },
  )
  return (
    <Sheet open={open} onClose={onClose} title="Ders hakkı ekle" dirty={!!(name || note)}
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>Kaydet</Button></div>}>
      <div className="grid gap-4">
        <Segmented value={kind} onChange={setKind} options={[{ value: 'paket', label: 'Yeni paket' }, { value: 'duzeltme', label: 'Düzeltme (±)' }]} />
        <Field label="Açıklama"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={kind === 'paket' ? 'Ör. 24 derslik Python paketi' : 'Ör. Telafi dersi hakkı'} /></Field>
        <Field label={kind === 'paket' ? 'Ders sayısı' : 'Hak değişimi (eksi değer azaltır)'}>
          <Input type="number" inputMode="numeric" min={kind === 'paket' ? 1 : -500} max={500} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </Field>
        {kind === 'paket' && can.payments && (
          <>
            <Field label="Paket bedeli (₺)"><Input type="number" inputMode="decimal" min={0} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></Field>
            {price > 0 && <Toggle checked={addFee} onChange={setAddFee} label="Bedeli öğrencinin kurs ücretine ekle" description="Kalan ödeme otomatik güncellenir." />}
          </>
        )}
        <Field label="Not"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">Mevcut kalan hak: {student.remaining_lessons} → kayıttan sonra {student.remaining_lessons + (valid ? count : 0)}</p>
      </div>
    </Sheet>
  )
}

function VoidPackageSheet({ pkg, onClose }: { pkg: LessonPackage | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  useEffect(() => setReason(''), [pkg?.id])
  const save = useDbMutation(() => rpc('void_lesson_package', { p_package_id: pkg!.id, p_reason: reason.trim() }), {
    success: 'Hareket geçersiz kılındı (kayıt silinmez)', invalidate: INV, onSuccess: onClose,
  })
  return (
    <Sheet open={!!pkg} onClose={onClose} title="Hareketi geçersiz kıl"
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button variant="danger" block disabled={reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate(undefined)}>Geçersiz kıl</Button></div>}>
      {pkg && (
        <div className="grid gap-4">
          <p className="text-sm text-slate-600">"{pkg.name}" ({pkg.lesson_count > 0 ? '+' : ''}{pkg.lesson_count} ders) geçersiz sayılacak; kayıt geçmişte kalır.{pkg.fee_added ? ' Eklenen bedel kurs ücretinden düşülür.' : ''}</p>
          <Field label="Neden"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      )}
    </Sheet>
  )
}

/** Öğrencinin yoklama geçmişi */
export function AttendanceTab({ lessons }: { lessons: LessonWithRelations[] }) {
  const rows = lessons.filter((l) => l.attendance).sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  if (!rows.length) return <Card><EmptyState title="Yoklama kaydı yok" text="Ders tamamlandığında yoklama burada görünür." /></Card>
  const count = (s: string) => rows.filter((l) => l.attendance?.status === s).length
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(['katildi', 'katilmadi', 'izinli', 'gec_geldi', 'erken_ayrildi'] as const).map((s) => (
          <Badge key={s} tone={ATTENDANCE_STATUS[s].tone}>{ATTENDANCE_STATUS[s].label}: {count(s)}</Badge>
        ))}
      </div>
      <Card className="divide-y divide-slate-100">
        {rows.map((l) => (
          <div key={l.id} className="flex items-center gap-3 p-3.5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{formatDayShort(dateKey(l.starts_at))} {timeHM(l.starts_at)}</span>
              <span className="block truncate text-xs text-slate-500">{l.title || l.course?.name || 'Ders'}{l.attendance?.note ? ` · ${l.attendance.note}` : ''}</span>
            </span>
            <Badge tone={ATTENDANCE_STATUS[l.attendance!.status].tone}>{ATTENDANCE_STATUS[l.attendance!.status].label}</Badge>
          </div>
        ))}
      </Card>
    </div>
  )
}
