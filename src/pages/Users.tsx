import { useEffect, useState } from 'react'
import { ShieldCheck, Check, QrCode, Smartphone } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useProfiles, useDbMutation } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/time'
import { ROLE_LABEL } from '@/lib/format'
import type { AppRole, Permissions, Profile } from '@/types/db'
import { Avatar, Badge, Button, Card, Field, Input, PageLoader, SectionTitle, Select, Sheet, Toggle } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { InviteSheet, PendingInvites, lastSeenText } from '@/components/forms/InviteForms'

async function updateProfile(id: string, patch: Partial<Profile>) {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select().maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Profil güncellenemedi (yetki veya kayıt yok).')
  return data as Profile
}

export function UsersPage() {
  const { session } = useAuth()
  const { data, isLoading } = useProfiles()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const approve = useDbMutation((p: Profile) => updateProfile(p.id, { approved: true, is_active: true }), { success: 'Kullanıcı onaylandı', invalidate: ['profiles'] })

  if (isLoading) return <PageLoader />
  // E-posta ile kayıt talepleri (anonim, henüz kod girmemiş cihazlar listelenmez)
  const pending = (data ?? []).filter((p) => !p.approved && !!p.email)
  const users = (data ?? []).filter((p) => p.approved)

  return (
    <div>
      <PageHeader title="Cihazlar ve Kullanıcılar" subtitle="Şifresiz cihaz davetleri, roller ve erişim"
        actions={<Button icon={<QrCode className="size-4" />} onClick={() => setInviting(true)}>Telefon ekle</Button>} />
      <Card className="mb-4 flex gap-3 p-4 text-sm text-slate-600 dark:text-slate-300">
        <Smartphone className="size-5 shrink-0 text-brand-600" />
        <p><b>Yeni telefon eklemek için:</b> "Telefon ekle" → oluşan tek kullanımlık özel bağlantıyı o telefona gönderin. Telefon bağlantıyı bir kez açınca kendiliğinden yetkilendirilir; sonraki açılışlarda hiçbir şey sormadan doğrudan ana panel açılır. Erişimi kaldırmak için cihaza dokunup "Cihaz yetkili" seçeneğini kapatın.</p>
      </Card>
      <PendingInvites />
      {pending.length > 0 && (
        <>
          <SectionTitle>Onay bekleyen talepler ({pending.length})</SectionTitle>
          <Card className="mb-2 divide-y divide-slate-100 dark:divide-white/10">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3.5">
                <Avatar name={p.full_name || p.email} size={38} />
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{p.full_name}</p><p className="truncate text-xs text-slate-500">{p.email} · {formatDate(p.created_at)}</p></div>
                <Button size="sm" icon={<Check className="size-4" />} loading={approve.isPending} onClick={() => approve.mutate(p)}>Onayla</Button>
              </div>
            ))}
          </Card>
        </>
      )}
      <SectionTitle>Bağlı cihazlar ve hesaplar</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-white/10">
        {users.map((p) => (
          <button key={p.id} onClick={() => setEditing(p)} className="flex w-full items-center gap-3 p-3.5 text-left">
            <Avatar name={p.full_name || p.email || 'Cihaz'} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{p.full_name} {p.id === session?.user.id && <span className="text-xs font-normal text-slate-400">(bu cihaz)</span>}</p>
              <p className="truncate text-xs text-slate-500">{p.is_device ? `Şifresiz cihaz · ${lastSeenText(p.last_seen_at)}` : p.email}</p>
            </div>
            <Badge tone={p.role === 'admin' ? 'accent' : p.role === 'egitmen' ? 'brand' : 'slate'}>{ROLE_LABEL[p.role]}</Badge>
            {!p.is_active && <Badge tone="red">Pasif</Badge>}
          </button>
        ))}
      </Card>
      <Card className="mt-4 flex gap-3 p-4 text-sm text-slate-600 dark:text-slate-300">
        <ShieldCheck className="size-5 shrink-0 text-brand-600" />
        <p>Yetkiler veritabanında Row Level Security ile uygulanır. Kod girmemiş bir cihaz hiçbir veriyi göremez; eğitmenler yalnızca kendi derslerini, personel yalnızca izin verilen işlemleri görür.</p>
      </Card>
      <InviteSheet open={inviting} onClose={() => setInviting(false)} />
      <EditUserSheet profile={editing} onClose={() => setEditing(null)} isSelf={editing?.id === session?.user.id} />
    </div>
  )
}

function EditUserSheet({ profile, onClose, isSelf }: { profile: Profile | null; onClose: () => void; isSelf: boolean }) {
  const [role, setRole] = useState<AppRole>('personel')
  const [active, setActive] = useState(true)
  const [perms, setPerms] = useState<Permissions>({})
  const [name, setName] = useState('')
  useEffect(() => {
    if (!profile) return
    setRole(profile.role); setActive(profile.is_active); setPerms(profile.permissions ?? {}); setName(profile.full_name)
  }, [profile])
  const save = useDbMutation(() => updateProfile(profile!.id, { role, is_active: active, permissions: perms, full_name: name.trim() }), { success: 'Güncellendi', invalidate: ['profiles'], onSuccess: onClose })
  if (!profile) return null
  return (
    <Sheet open={!!profile} onClose={onClose} title={profile.is_device ? 'Cihazı düzenle' : 'Kullanıcıyı düzenle'}
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block loading={save.isPending} onClick={() => save.mutate(undefined)}>Kaydet</Button></div>}>
      <div className="grid gap-4">
        <p className="text-sm text-slate-500">{profile.is_device ? `Şifresiz cihaz · ${lastSeenText(profile.last_seen_at)}` : profile.email}</p>
        <Field label="Ad"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Rol">
          <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)} disabled={isSelf}>
            <option value="admin">Yönetici – tüm sisteme erişim</option>
            <option value="egitmen">Eğitmen – kendi dersleri ve yoklama</option>
            <option value="personel">Personel – izin verilen işlemler</option>
          </Select>
        </Field>
        {role === 'personel' && (
          <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5">
            <p className="mb-1 text-sm font-semibold">Personel izinleri</p>
            <Toggle checked={!!perms.students} onChange={(v) => setPerms({ ...perms, students: v })} label="Öğrenci kaydı" description="Öğrenci ekleme ve düzenleme" />
            <Toggle checked={!!perms.lessons} onChange={(v) => setPerms({ ...perms, lessons: v })} label="Ders planlama" description="Ders oluşturma, taşıma, iptal, yoklama" />
            <Toggle checked={!!perms.payments} onChange={(v) => setPerms({ ...perms, payments: v })} label="Ödemeler" description="Ödeme ve taksit görüntüleme / ekleme" />
          </div>
        )}
        {!isSelf && <Toggle checked={active} onChange={setActive} label={profile.is_device ? 'Cihaz yetkili' : 'Hesap aktif'} description="Kapatıldığında bu cihaz anında hiçbir veriye erişemez." />}
      </div>
    </Sheet>
  )
}
