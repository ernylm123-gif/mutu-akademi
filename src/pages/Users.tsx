import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus, ShieldCheck, Check, X, KeyRound, Trash2, QrCode, Smartphone } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useProfiles, useDbMutation, adminUsers } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { newUserSchema, type NewUserInput } from '@/lib/schemas'
import { formatDate } from '@/lib/time'
import { ROLE_LABEL } from '@/lib/format'
import type { AppRole, Permissions, Profile } from '@/types/db'
import { Avatar, Badge, Button, Card, ConfirmSheet, Field, Input, PageLoader, SectionTitle, Select, Sheet, Toggle } from '@/components/ui'
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
  const [creating, setCreating] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const approve = useDbMutation((p: Profile) => updateProfile(p.id, { approved: true, is_active: true }), { success: 'Kullanıcı onaylandı', invalidate: ['profiles'] })
  const [rejecting, setRejecting] = useState<Profile | null>(null)
  const reject = useDbMutation((p: Profile) => adminUsers({ action: 'delete', user_id: p.id }), { success: 'Talep reddedildi ve hesap silindi', invalidate: ['profiles'], onSuccess: () => setRejecting(null) })

  if (isLoading) return <PageLoader />
  const pending = (data ?? []).filter((p) => !p.approved)
  const users = (data ?? []).filter((p) => p.approved)

  return (
    <div>
      <PageHeader title="Cihazlar ve Kullanıcılar" subtitle="Şifresiz cihaz davetleri, roller ve erişim"
        actions={<>
          <Button icon={<QrCode className="size-4" />} onClick={() => setInviting(true)}>Cihaz davet et</Button>
          <Button variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>E-posta hesabı</Button>
        </>} />
      <Card className="mb-4 flex gap-3 p-4 text-sm text-slate-600 dark:text-slate-300">
        <Smartphone className="size-5 shrink-0 text-brand-600" />
        <p><b>Yeni telefon eklemek için:</b> "Cihaz davet et" → oluşan QR kodu yeni telefonun kamerasıyla okutun (veya kodu girin). Telefon bir kez bağlandıktan sonra uygulama şifre sormadan doğrudan ana panele açılır. Erişimi kaldırmak için cihazı açıp "Hesap aktif" seçeneğini kapatın.</p>
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
                <Button size="sm" variant="secondary" icon={<X className="size-4" />} onClick={() => setRejecting(p)}>Reddet</Button>
                <Button size="sm" icon={<Check className="size-4" />} loading={approve.isPending} onClick={() => approve.mutate(p)}>Onayla</Button>
              </div>
            ))}
          </Card>
          <p className="mb-4 text-xs text-slate-500">Onaylanan kullanıcı varsayılan olarak "Personel" rolüyle başlar. Rolünü aşağıdan değiştirebilirsiniz.</p>
        </>
      )}
      <SectionTitle>Bağlı cihazlar ve hesaplar</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-white/10">
        {users.map((p) => (
          <button key={p.id} onClick={() => setEditing(p)} className="flex w-full items-center gap-3 p-3.5 text-left">
            <Avatar name={p.full_name || p.email} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{p.full_name} {p.id === session?.user.id && <span className="text-xs font-normal text-slate-400">(siz)</span>}</p>
              <p className="truncate text-xs text-slate-500">{p.is_device ? `Şifresiz cihaz · ${lastSeenText(p.last_seen_at)}` : p.email}</p>
            </div>
            <Badge tone={p.role === 'admin' ? 'accent' : p.role === 'egitmen' ? 'brand' : 'slate'}>{ROLE_LABEL[p.role]}</Badge>
            {!p.is_active && <Badge tone="red">Pasif</Badge>}
          </button>
        ))}
      </Card>
      <Card className="mt-4 flex gap-3 p-4 text-sm text-slate-600 dark:text-slate-300">
        <ShieldCheck className="size-5 shrink-0 text-brand-600" />
        <p>Yetkiler veritabanında Row Level Security ile uygulanır. Eğitmenler yalnızca kendi derslerini ve öğrencilerini görür; personel yalnızca izin verilen işlemleri yapabilir. Şifreler Supabase Auth tarafından güvenli biçimde saklanır.</p>
      </Card>
      <CreateUserSheet open={creating} onClose={() => setCreating(false)} />
      <InviteSheet open={inviting} onClose={() => setInviting(false)} />
      <EditUserSheet profile={editing} onClose={() => setEditing(null)} isSelf={editing?.id === session?.user.id} />
      <ConfirmSheet open={!!rejecting} onClose={() => setRejecting(null)} onConfirm={() => rejecting && reject.mutate(rejecting)} loading={reject.isPending} danger
        title="Talep reddedilsin mi?" confirmLabel="Reddet ve sil" text={`${rejecting?.email ?? ''} hesabı kalıcı olarak silinecek.`} />
    </div>
  )
}

function CreateUserSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<NewUserInput>({ resolver: zodResolver(newUserSchema) })
  useEffect(() => { if (open) reset({ full_name: '', email: '', password: '', role: 'personel' }) }, [open, reset])
  const create = useDbMutation((v: NewUserInput) => adminUsers({ action: 'create', ...v }), { success: 'Kullanıcı oluşturuldu', invalidate: ['profiles'], onSuccess: onClose })
  return (
    <Sheet open={open} onClose={onClose} title="Kullanıcı oluştur"
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block loading={create.isPending} onClick={handleSubmit((v) => create.mutate(v))}>Oluştur</Button></div>}>
      <div className="grid gap-4">
        <Field label="Ad soyad" error={errors.full_name?.message}><Input {...register('full_name')} /></Field>
        <Field label="E-posta" error={errors.email?.message}><Input type="email" autoComplete="off" {...register('email')} /></Field>
        <Field label="Geçici şifre" error={errors.password?.message} hint="Kullanıcıya güvenli bir kanaldan iletin; ilk girişten sonra Ayarlar'dan değiştirebilir.">
          <Input type="text" autoComplete="new-password" {...register('password')} />
        </Field>
        <Field label="Rol">
          <Select {...register('role')}>
            <option value="personel">Personel</option>
            <option value="egitmen">Eğitmen</option>
            <option value="admin">Yönetici</option>
          </Select>
        </Field>
        <p className="text-xs text-slate-500">Eğitmen hesabını, Eğitmenler sayfasından ilgili eğitmen kaydına bağlayın.</p>
      </div>
    </Sheet>
  )
}

function EditUserSheet({ profile, onClose, isSelf }: { profile: Profile | null; onClose: () => void; isSelf: boolean }) {
  const [role, setRole] = useState<AppRole>('personel')
  const [active, setActive] = useState(true)
  const [perms, setPerms] = useState<Permissions>({})
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => {
    if (!profile) return
    setRole(profile.role); setActive(profile.is_active); setPerms(profile.permissions ?? {}); setName(profile.full_name); setPw('')
  }, [profile])
  const save = useDbMutation(() => updateProfile(profile!.id, { role, is_active: active, permissions: perms, full_name: name.trim() }), { success: 'Kullanıcı güncellendi', invalidate: ['profiles'], onSuccess: onClose })
  const resetPw = useDbMutation(() => adminUsers({ action: 'set_password', user_id: profile!.id, password: pw }), { success: 'Şifre güncellendi', onSuccess: () => setPw('') })
  const del = useDbMutation(() => adminUsers({ action: 'delete', user_id: profile!.id }), { success: 'Kullanıcı silindi', invalidate: ['profiles'], onSuccess: () => { setConfirmDel(false); onClose() } })
  if (!profile) return null
  return (
    <Sheet open={!!profile} onClose={onClose} title="Kullanıcıyı düzenle"
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block loading={save.isPending} onClick={() => save.mutate(undefined)}>Kaydet</Button></div>}>
      <div className="grid gap-4">
        <p className="text-sm text-slate-500">{profile.is_device ? `Şifresiz cihaz · ${lastSeenText(profile.last_seen_at)}` : profile.email}</p>
        <Field label="Ad soyad"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
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
        {!isSelf && <Toggle checked={active} onChange={setActive} label={profile.is_device ? 'Cihaz yetkili' : 'Hesap aktif'} description="Kapatıldığında bu cihaz/hesap anında hiçbir veriye erişemez." />}
        {!profile.is_device && <div className="rounded-2xl border border-slate-200 p-3 dark:border-white/10">
          <p className="mb-2 text-sm font-semibold">Şifre belirle</p>
          <div className="flex gap-2">
            <Input type="text" placeholder="Yeni şifre (en az 8)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <Button variant="secondary" icon={<KeyRound className="size-4" />} disabled={pw.length < 8} loading={resetPw.isPending} onClick={() => resetPw.mutate(undefined)}>Ayarla</Button>
          </div>
        </div>}
        {!isSelf && <Button variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDel(true)}>{profile.is_device ? 'Cihazı kaldır' : 'Hesabı sil'}</Button>}
      </div>
      <ConfirmSheet open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={() => del.mutate(undefined)} loading={del.isPending} danger title="Hesap silinsin mi?" confirmLabel="Sil"
        text="Kullanıcı hesabı kalıcı olarak silinir. Oluşturduğu kayıtlar korunur. Geçici olarak engellemek için 'Hesap aktif' seçeneğini kapatın." />
    </Sheet>
  )
}
