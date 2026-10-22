import { useEffect, useState } from 'react'
import { DoorOpen, Plus, Trash2, Clock } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useRooms, useAvailability, useDbMutation, insertRow } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { WEEKDAYS } from '@/lib/time'
import type { Room } from '@/types/db'
import { Badge, Button, Card, EmptyState, Field, Input, PageLoader, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'

/** Sınıf ve oda yönetimi: aynı sınıfa çakışan saatte iki ders konulamaz (veritabanı kuralı) */
export function RoomsPage() {
  const { can } = useAuth()
  const { data: rooms, isLoading } = useRooms()
  const [editing, setEditing] = useState<Room | 'new' | null>(null)
  if (isLoading) return <PageLoader />
  return (
    <div>
      <PageHeader title="Sınıflar" subtitle="Derslik, laboratuvar ve atölyeler"
        actions={can.lessons && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Sınıf ekle</Button>} />
      {(rooms ?? []).length === 0 ? (
        <Card><EmptyState icon={<DoorOpen className="size-6" />} title="Henüz sınıf yok" text="Ör. Bilgisayar Laboratuvarı, Tasarım Atölyesi, Bireysel Eğitim Odası"
          action={can.lessons && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Sınıf ekle</Button>} /></Card>
      ) : (
        <Card className="divide-y divide-slate-100">
          {rooms!.map((r) => (
            <button key={r.id} disabled={!can.lessons} onClick={() => setEditing(r)} className="flex min-h-16 w-full items-center gap-3 p-4 text-left">
              <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><DoorOpen className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.name}</span>
                <span className="block truncate text-xs text-slate-500">{r.capacity ? `${r.capacity} kişilik` : 'Kapasite belirtilmedi'}{r.description ? ` · ${r.description}` : ''}</span>
              </span>
              <Badge tone={r.is_active ? 'green' : 'slate'}>{r.is_active ? 'Kullanımda' : 'Kapalı'}</Badge>
            </button>
          ))}
        </Card>
      )}
      <RoomSheet room={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function RoomSheet({ room, onClose }: { room: Room | 'new' | null; onClose: () => void }) {
  const { can } = useAuth()
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('')
  const [description, setDescription] = useState('')
  const [active, setActive] = useState(true)
  useEffect(() => {
    if (!room) return
    const r = room === 'new' ? null : room
    setName(r?.name ?? ''); setCapacity(r?.capacity ? String(r.capacity) : ''); setDescription(r?.description ?? ''); setActive(r?.is_active ?? true)
  }, [room])
  const payload = () => ({ name: name.trim(), capacity: capacity ? Number(capacity) : null, description: description.trim() || null, is_active: active })
  const save = useDbMutation(async () => {
    if (room === 'new') return insertRow<Room>('rooms', payload())
    const { error } = await supabase.from('rooms').update(payload()).eq('id', (room as Room).id)
    if (error) throw error
  }, { success: 'Sınıf kaydedildi', invalidate: ['rooms'], onSuccess: onClose })
  const del = useDbMutation(async () => {
    const { error } = await supabase.from('rooms').delete().eq('id', (room as Room).id)
    if (error) throw error
  }, { success: 'Sınıf silindi (derslerdeki sınıf bilgisi boşaltıldı)', invalidate: ['rooms', 'lessons'], onSuccess: onClose })
  const valid = name.trim().length >= 2 && (!capacity || (Number(capacity) >= 1 && Number(capacity) <= 500))
  return (
    <Sheet open={!!room} onClose={onClose} title={room === 'new' ? 'Yeni sınıf' : 'Sınıfı düzenle'}
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>Kaydet</Button></div>}>
      <div className="grid gap-4">
        <Field label="Sınıf adı *"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ör. Bilgisayar Laboratuvarı" /></Field>
        <Field label="Kapasite (kişi)"><Input type="number" inputMode="numeric" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
        <Field label="Açıklama"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Toggle checked={active} onChange={setActive} label="Kullanımda" description="Kapalı sınıflar yeni derslerde seçilemez." />
        {room !== 'new' && room && can.admin && (
          <Button variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} loading={del.isPending}
            onClick={() => { if (window.confirm('Sınıf silinsin mi? Geçmiş derslerin sınıf bilgisi boşaltılır. Bunun yerine "Kullanımda" seçeneğini kapatabilirsiniz.')) del.mutate(undefined) }}>Sınıfı sil</Button>
        )}
      </div>
    </Sheet>
  )
}

/** Eğitmen müsaitlik saatleri: dışına ders konulursa uyarı gösterilir */
export function AvailabilityEditor({ instructorId, editable }: { instructorId: string; editable: boolean }) {
  const { data: slots } = useAvailability(instructorId)
  const [day, setDay] = useState(1)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('18:00')
  const add = useDbMutation(() => insertRow('instructor_availability', { instructor_id: instructorId, weekday: day, start_time: start, end_time: end }),
    { success: 'Çalışma saati eklendi', invalidate: ['availability'] })
  const remove = useDbMutation(async (id: string) => {
    const { error } = await supabase.from('instructor_availability').delete().eq('id', id)
    if (error) throw error
  }, { success: 'Çalışma saati silindi', invalidate: ['availability'] })
  return (
    <div>
      {(slots ?? []).length === 0 ? (
        <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">Çalışma saati tanımlanmadı; tüm saatler uygun kabul edilir.</p>
      ) : (
        <Card className="divide-y divide-slate-100">
          {slots!.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3">
              <Clock className="size-4 text-slate-400" />
              <span className="flex-1 text-sm"><b>{WEEKDAYS[s.weekday - 1]}</b> {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</span>
              {editable && <button onClick={() => remove.mutate(s.id)} aria-label="Sil" className="grid size-11 place-items-center text-slate-400 hover:text-red-600"><Trash2 className="size-4" /></button>}
            </div>
          ))}
        </Card>
      )}
      {editable && (
        <div className="mt-3 grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
          <Field label="Gün"><Select value={day} onChange={(e) => setDay(Number(e.target.value))}>{WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</Select></Field>
          <Field label="Başlangıç"><Input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} className="w-28" /></Field>
          <Field label="Bitiş"><Input type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} className="w-28" /></Field>
          <Button disabled={end <= start} loading={add.isPending} onClick={() => add.mutate(undefined)} aria-label="Çalışma saati ekle"><Plus className="size-4" /></Button>
        </div>
      )}
    </div>
  )
}
