import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { paymentSchema, installmentPlanSchema, splitInstallments, type PaymentFormInput, type PaymentFormValues, type InstallmentPlanInput } from '@/lib/schemas'
import { useDbMutation, insertRow, updateVersioned } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { addMonths, dateKey, formatDate } from '@/lib/time'
import { formatMoney, PAYMENT_METHOD } from '@/lib/format'
import type { Payment } from '@/types/db'
import { Button, Field, Input, Select, Sheet, Textarea } from '@/components/ui'

const PAY_KEYS = ['payments', 'installments', 'balances']

export function PaymentFormSheet({ open, onClose, studentId, studentName, suggested }: {
  open: boolean; onClose: () => void; studentId: string; studentName: string; suggested?: number
}) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<PaymentFormInput, unknown, PaymentFormValues>({ resolver: zodResolver(paymentSchema) })
  useEffect(() => {
    if (open) reset({ amount: suggested && suggested > 0 ? suggested : ('' as unknown as number), paid_at: dateKey(), method: 'nakit', note: '' })
  }, [open, reset, suggested])
  const save = useDbMutation((v: PaymentFormValues) => insertRow<Payment>('payments', { ...v, student_id: studentId }), {
    success: (_r, v) => `${formatMoney(v.amount)} ödeme kaydedildi`,
    invalidate: PAY_KEYS,
    onSuccess: onClose,
  })
  return (
    <Sheet open={open} onClose={onClose} title={`Ödeme ekle – ${studentName}`}
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>Kaydet</Button></div>}
    >
      <form className="grid gap-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Tutar (₺) *" error={errors.amount?.message}>
          <Input type="number" inputMode="decimal" step="0.01" min="0" autoFocus {...register('amount')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ödeme tarihi" error={errors.paid_at?.message}><Input type="date" {...register('paid_at')} /></Field>
          <Field label="Yöntem">
            <Select {...register('method')}>
              {Object.entries(PAYMENT_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Not" error={errors.note?.message}><Textarea rows={2} {...register('note')} /></Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}

export function InstallmentPlanSheet({ open, onClose, studentId, defaultTotal }: { open: boolean; onClose: () => void; studentId: string; defaultTotal: number }) {
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<InstallmentPlanInput>({ resolver: zodResolver(installmentPlanSchema) })
  useEffect(() => {
    if (open) reset({ total: defaultTotal || ('' as unknown as number), count: 3, first_due: dateKey() })
  }, [open, reset, defaultTotal])
  const total = Number(watch('total')) || 0
  const count = Number(watch('count')) || 0
  const first = watch('first_due')
  const preview = total > 0 && count > 0 && count <= 48 && first ? splitInstallments(total, count).map((a, i) => ({ a, d: addMonths(first, i) })) : []

  const save = useDbMutation(
    async (v: { total: number; count: number; first_due: string }) => {
      const rows = splitInstallments(v.total, v.count).map((amount, i) => ({ student_id: studentId, amount, due_date: addMonths(v.first_due, i), note: `${i + 1}/${v.count}. taksit` }))
      const { error } = await supabase.from('installments').insert(rows)
      if (error) throw error
      return rows.length
    },
    { success: (n) => `${n} taksit oluşturuldu`, invalidate: PAY_KEYS, onSuccess: onClose },
  )
  return (
    <Sheet open={open} onClose={onClose} title="Taksit planı oluştur"
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v as { total: number; count: number; first_due: string }))}>Oluştur</Button></div>}
    >
      <div className="grid gap-4">
        <Field label="Toplam tutar (₺)" error={errors.total?.message}><Input type="number" inputMode="decimal" step="0.01" {...register('total')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taksit sayısı" error={errors.count?.message}><Input type="number" inputMode="numeric" min={1} max={48} {...register('count')} /></Field>
          <Field label="İlk vade" error={errors.first_due?.message}><Input type="date" {...register('first_due')} /></Field>
        </div>
        {preview.length > 0 && (
          <div className="rounded-2xl bg-slate-50 p-3 text-sm dark:bg-white/5">
            {preview.map((p, i) => (
              <div key={i} className="flex justify-between py-1"><span>{i + 1}. taksit · {formatDate(p.d)}</span><span className="font-semibold tabular-nums">{formatMoney(p.a)}</span></div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

export function VoidPaymentSheet({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const [reason, setReason] = useState('')
  useEffect(() => setReason(''), [payment])
  const save = useDbMutation(
    async () => {
      const { data: u } = await supabase.auth.getUser()
      return updateVersioned('payments', payment!.id, payment!.version, {
        is_void: true, void_reason: reason.trim(), voided_by: u.user?.id ?? null, voided_at: new Date().toISOString(),
      })
    },
    { success: 'Ödeme iptal edildi (kayıt geçmişte korunur)', invalidate: PAY_KEYS, onSuccess: onClose },
  )
  if (!payment) return null
  return (
    <Sheet open={!!payment} onClose={onClose} title="Ödemeyi düzelt / iptal et"
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button variant="danger" block disabled={reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate(undefined)}>Ödemeyi iptal et</Button></div>}
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {formatDate(payment.paid_at)} tarihli <b>{formatMoney(payment.amount)}</b> ödeme iptal edilecek. Kayıt silinmez, işlem geçmişinde saklanır. Doğru tutarı yeni ödeme olarak ekleyebilirsiniz.
      </p>
      <Field label="Düzeltme nedeni *" className="mt-4"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Sheet>
  )
}
