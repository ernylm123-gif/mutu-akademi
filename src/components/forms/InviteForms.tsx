import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Share2, Smartphone, Trash2, QrCode, Check } from 'lucide-react'
import { useInstructors, useInvites, useDbMutation } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { generateInviteCode, LINK_KEY_LENGTH, privateLink, sha256Hex } from '@/lib/pairing'
import { formatDateTime, relativeTime } from '@/lib/time'
import { ROLE_LABEL } from '@/lib/format'
import type { AppRole, Permissions } from '@/types/db'
import { Badge, Button, Card, Field, Input, Select, Sheet, Toggle } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'

export function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const { data: instructors } = useInstructors()
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<AppRole>('personel')
  const [perms, setPerms] = useState<Permissions>({ students: true, lessons: true, payments: false })
  const [instructorId, setInstructorId] = useState('')
  const [hours, setHours] = useState(24)
  const [result, setResult] = useState<{ code: string; link: string; qr: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setLabel(''); setRole('personel'); setPerms({ students: true, lessons: true, payments: false }); setInstructorId(''); setHours(24); setResult(null); setCopied(false)
  }, [open])

  const create = useDbMutation(
    async () => {
      const code = generateInviteCode(LINK_KEY_LENGTH)
      const { error } = await supabase.from('device_invites').insert({
        code_hash: await sha256Hex(code),
        label: label.trim() || (role === 'egitmen' ? instructors?.find((i) => i.id === instructorId)?.full_name : null) || ROLE_LABEL[role],
        role,
        permissions: role === 'personel' ? perms : {},
        instructor_id: role === 'egitmen' && instructorId ? instructorId : null,
        expires_at: new Date(Date.now() + hours * 3600_000).toISOString(),
      })
      if (error) throw error
      const link = privateLink(code)
      const qr = await QRCode.toDataURL(link, { margin: 1, width: 480, color: { dark: '#0f1115', light: '#ffffff' } })
      return { code, link, qr }
    },
    { success: 'Özel bağlantı oluşturuldu', invalidate: ['invites'], onSuccess: (r) => setResult(r) },
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result!.link)
      setCopied(true)
      toast.success('Kopyalandı')
    } catch {
      toast.error('Kopyalanamadı; kodu elle iletin.')
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: 'Mutu Akademi', text: 'Mutu Akademi uygulaması için bu telefona özel, tek kullanımlık bağlantı. Telefonunuzda açın.', url: result!.link })
    } catch { /* kullanıcı vazgeçti */ }
  }

  return (
    <Sheet open={open} onClose={onClose} title={result ? 'Özel bağlantı hazır' : 'Yeni cihaz için özel bağlantı'}
      footer={result
        ? <Button block onClick={onClose}>Tamam</Button>
        : <div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block loading={create.isPending} icon={<QrCode className="size-4" />} onClick={() => create.mutate(undefined)}>Bağlantı oluştur</Button></div>}>
      {result ? (
        <div className="text-center">
          <img src={result.qr} alt="Eşleştirme QR kodu" className="mx-auto w-64 rounded-2xl border border-slate-200 bg-white p-2" />
          <p className="mt-3 text-sm text-slate-500">Bağlantıyı yeni telefona gönderin (WhatsApp, SMS) veya telefonun kamerasıyla QR'ı okutun. Telefon bağlantıyı açınca hiçbir şey sormadan yetkilendirilir.</p>
          <p className="mt-2 select-all break-all rounded-xl bg-slate-50 p-2 font-mono text-xs dark:bg-white/5">{result.link}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>Kopyala</Button>
            {'share' in navigator && <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={share}>Paylaş</Button>}
          </div>
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-left text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            Bu bağlantı yalnızca bir kez gösterilir, yalnızca tek bir cihazda bir kez kullanılabilir ve {hours === 1 ? '1 saat' : hours < 48 ? `${hours} saat` : `${hours / 24} gün`} sonra geçersiz olur. Bağlantıyı yalnızca ilgili kişiyle paylaşın; açıldığı anda geçersiz olur.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          <Field label="Cihaz / kişi adı" hint="ör. Ayşe Hoca, Sekreterlik tableti"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} /></Field>
          <Field label="Rol">
            <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
              <option value="personel">Personel – izin verilen işlemler</option>
              <option value="egitmen">Eğitmen – kendi dersleri ve yoklama</option>
              <option value="admin">Yönetici – tüm sistem</option>
            </Select>
          </Field>
          {role === 'egitmen' && (
            <Field label="Eğitmen kaydı" hint="Cihaz bu eğitmenin derslerini görür.">
              <Select value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
                <option value="">Sonra bağlanacak</option>
                {instructors?.filter((i) => i.is_active && !i.profile_id).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
              </Select>
            </Field>
          )}
          {role === 'personel' && (
            <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5">
              <Toggle checked={!!perms.students} onChange={(v) => setPerms({ ...perms, students: v })} label="Öğrenci kaydı" />
              <Toggle checked={!!perms.lessons} onChange={(v) => setPerms({ ...perms, lessons: v })} label="Ders planlama ve yoklama" />
              <Toggle checked={!!perms.payments} onChange={(v) => setPerms({ ...perms, payments: v })} label="Ödemeler" />
            </div>
          )}
          <Field label="Geçerlilik süresi">
            <Select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              <option value={1}>1 saat</option>
              <option value={24}>24 saat</option>
              <option value={72}>3 gün</option>
              <option value={168}>7 gün</option>
            </Select>
          </Field>
        </div>
      )}
    </Sheet>
  )
}

export function PendingInvites() {
  const { data } = useInvites()
  const remove = useDbMutation(async (id: string) => {
    const { error } = await supabase.from('device_invites').delete().eq('id', id)
    if (error) throw error
  }, { success: 'Davet iptal edildi', invalidate: ['invites'] })
  const now = Date.now()
  const open = (data ?? []).filter((i) => !i.used_at && new Date(i.expires_at).getTime() > now)
  if (open.length === 0) return null
  return (
    <Card className="mb-2 divide-y divide-slate-100 dark:divide-white/10">
      {open.map((i) => (
        <div key={i.id} className="flex items-center gap-3 p-3.5">
          <Smartphone className="size-5 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{i.label}</p>
            <p className="text-xs text-slate-500">Bekliyor · son geçerlilik {formatDateTime(i.expires_at)}</p>
          </div>
          <Badge tone="brand">{ROLE_LABEL[i.role]}</Badge>
          <button onClick={() => remove.mutate(i.id)} className="grid size-9 place-items-center rounded-full text-slate-400 hover:text-red-600" aria-label="Daveti iptal et"><Trash2 className="size-4" /></button>
        </div>
      ))}
    </Card>
  )
}

export function lastSeenText(iso: string | null) {
  return iso ? `son görülme ${relativeTime(iso)}` : 'henüz bağlanmadı'
}
