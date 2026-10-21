import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { BookOpen, Plus, Share, PlusSquare, MoreVertical, Download, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCourses, useSettings, useAuditLogs, useProfiles, useDbMutation, insertRow } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { courseSchema, type CourseFormInput, type CourseFormValues } from '@/lib/schemas'
import { formatDateTime } from '@/lib/time'
import { formatMoney } from '@/lib/format'
import type { Course } from '@/types/db'
import { Badge, Button, Card, EmptyState, Field, Input, PageLoader, SectionTitle, Sheet, Textarea, Toggle } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { NotificationSettings } from '@/components/NotificationSettings'

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------
export function SettingsPage() {
  const { profile, can, refreshProfile } = useAuth()
  const { data: settings } = useSettings()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pw, setPw] = useState('')
  const [s, setS] = useState({ absence_consumes_credit: true, low_credit_threshold: 2, payment_reminder_days: 3 })
  useEffect(() => { if (profile) { setName(profile.full_name); setPhone(profile.phone ?? '') } }, [profile])
  useEffect(() => { if (settings) setS({ absence_consumes_credit: settings.absence_consumes_credit, low_credit_threshold: settings.low_credit_threshold, payment_reminder_days: settings.payment_reminder_days }) }, [settings])

  const saveProfile = useDbMutation(async () => {
    const { error } = await supabase.from('profiles').update({ full_name: name.trim(), phone: phone.trim() || null }).eq('id', profile!.id)
    if (error) throw error
    await refreshProfile()
  }, { success: 'Profil güncellendi', invalidate: ['profiles'] })
  const changePw = useDbMutation(async () => {
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) throw error
  }, { success: 'Şifreniz değiştirildi', onSuccess: () => setPw('') })
  const saveSettings = useDbMutation(async () => {
    const { data, error } = await supabase.from('app_settings').update(s).eq('id', 1).select().maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Ayarlar kaydedilemedi.')
  }, { success: 'Kurallar güncellendi; ders hakları yeniden hesaplandı', invalidate: ['settings', 'students'] })

  return (
    <div>
      <PageHeader title="Ayarlar" />
      <SectionTitle>Bildirimler</SectionTitle>
      <Link to="/bildirim-ayarlari" className="card flex min-h-[56px] items-center justify-between px-4 font-semibold">Bildirim ayarları ve ders hatırlatmaları<span className="text-slate-400">›</span></Link>
      <SectionTitle>Profil</SectionTitle>
      <Card className="grid gap-4 p-4">
        <Field label="Ad soyad"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Telefon"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <div className="flex justify-end"><Button loading={saveProfile.isPending} onClick={() => saveProfile.mutate(undefined)} disabled={name.trim().length < 2}>Kaydet</Button></div>
      </Card>
      {!profile?.is_device && (
        <>
          <SectionTitle>Şifre değiştir</SectionTitle>
          <Card className="flex gap-2 p-4">
            <Input type="password" placeholder="Yeni şifre (en az 8 karakter)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <Button disabled={pw.length < 8} loading={changePw.isPending} onClick={() => changePw.mutate(undefined)}>Değiştir</Button>
          </Card>
        </>
      )}
      {can.admin && settings && (
        <>
          <SectionTitle>Ders hakkı ve bildirim kuralları</SectionTitle>
          <Card className="grid gap-3 p-4">
            <Toggle checked={s.absence_consumes_credit} onChange={(v) => setS({ ...s, absence_consumes_credit: v })}
              label="Katılmadı → ders hakkından düşsün" description="Kapalıysa yalnızca 'Katıldı' olarak işaretlenen dersler haktan düşer. İzinli, iptal ve ertelenen dersler hiçbir zaman düşmez." />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Düşük ders hakkı uyarısı" hint="Kalan hak bu sayıya inince bildirim"><Input type="number" min={0} value={s.low_credit_threshold} onChange={(e) => setS({ ...s, low_credit_threshold: Number(e.target.value) })} /></Field>
              <Field label="Ödeme hatırlatma (gün)" hint="Vadeden kaç gün önce"><Input type="number" min={0} max={60} value={s.payment_reminder_days} onChange={(e) => setS({ ...s, payment_reminder_days: Number(e.target.value) })} /></Field>
            </div>
            <div className="flex justify-end"><Button loading={saveSettings.isPending} onClick={() => saveSettings.mutate(undefined)}>Kuralları kaydet</Button></div>
          </Card>
        </>
      )}
      <p className="mt-6 text-center text-xs text-slate-400">Saat dilimi: Europe/Istanbul · Sürüm {__APP_VERSION__}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kurslar
// ---------------------------------------------------------------------------
export function CoursesPage() {
  const { can } = useAuth()
  const { data, isLoading } = useCourses()
  const [editing, setEditing] = useState<Course | null | undefined>(undefined)
  if (isLoading) return <PageLoader />
  return (
    <div>
      <PageHeader title="Kurslar" subtitle="Kurs türleri, varsayılan ders sayısı ve ücretleri"
        actions={can.admin && <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>Kurs ekle</Button>} />
      {(data ?? []).length === 0 ? (
        <Card><EmptyState icon={<BookOpen className="size-6" />} title="Henüz kurs yok" text="Öğrenci eklerken seçilebilecek kursları tanımlayın." action={can.admin && <Button onClick={() => setEditing(null)}>Kurs ekle</Button>} /></Card>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {data!.map((c) => (
            <button key={c.id} disabled={!can.admin} onClick={() => setEditing(c)} className="card flex items-center gap-3 p-4 text-left">
              <span className="h-12 w-1.5 rounded-full" style={{ background: c.color }} />
              <span className="flex-1">
                <span className="flex items-center gap-2 font-semibold">{c.name}{!c.is_active && <Badge>Pasif</Badge>}</span>
                <span className="block text-xs text-slate-500">{c.default_lesson_count} ders · {c.duration_minutes} dk · {formatMoney(c.default_fee)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <CourseSheet open={editing !== undefined} course={editing} onClose={() => setEditing(undefined)} />
    </div>
  )
}

function CourseSheet({ open, course, onClose }: { open: boolean; course?: Course | null; onClose: () => void }) {
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<CourseFormInput, unknown, CourseFormValues>({ resolver: zodResolver(courseSchema) })
  useEffect(() => {
    if (open) reset(course ? { ...course, description: course.description ?? '', default_fee: Number(course.default_fee) } : { name: '', description: '', default_lesson_count: 8, default_fee: 0, duration_minutes: 60, color: '#D6268B', is_active: true })
  }, [open, course, reset])
  const save = useDbMutation(async (v: CourseFormValues) => {
    if (!course) return insertRow('courses', v)
    const { data, error } = await supabase.from('courses').update(v).eq('id', course.id).select().maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Kurs güncellenemedi.')
    return data
  }, { success: 'Kurs kaydedildi', invalidate: ['courses'], onSuccess: onClose })
  return (
    <Sheet open={open} onClose={onClose} title={course ? 'Kursu düzenle' : 'Yeni kurs'}
      footer={<div className="flex gap-2"><Button variant="secondary" block onClick={onClose}>Vazgeç</Button><Button block loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>Kaydet</Button></div>}>
      <div className="grid gap-4">
        <Field label="Kurs adı" error={errors.name?.message}><Input {...register('name')} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Ders sayısı" error={errors.default_lesson_count?.message}><Input type="number" {...register('default_lesson_count')} /></Field>
          <Field label="Süre (dk)" error={errors.duration_minutes?.message}><Input type="number" {...register('duration_minutes')} /></Field>
          <Field label="Ücret (₺)" error={errors.default_fee?.message}><Input type="number" step="0.01" {...register('default_fee')} /></Field>
        </div>
        <Field label="Renk"><Input type="color" className="h-11 p-1" {...register('color')} /></Field>
        <Field label="Açıklama"><Textarea rows={2} {...register('description')} /></Field>
        <Controller control={control} name="is_active" render={({ field }) => <Toggle checked={field.value} onChange={field.onChange} label="Aktif" />} />
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// İşlem geçmişi (audit log)
// ---------------------------------------------------------------------------
const T: Record<string, string> = { students: 'Öğrenci', lessons: 'Ders', attendance: 'Yoklama', payments: 'Ödeme', installments: 'Taksit', instructors: 'Eğitmen', courses: 'Kurs', profiles: 'Kullanıcı', weekly_schedules: 'Program', app_settings: 'Ayarlar' }
const A = { insert: 'Ekleme', update: 'Güncelleme', delete: 'Silme' }

export function AuditPage() {
  const [limit, setLimit] = useState(100)
  const { data, isLoading } = useAuditLogs(true, limit)
  const { data: profiles } = useProfiles()
  if (isLoading) return <PageLoader />
  return (
    <div>
      <PageHeader title="İşlem Geçmişi" subtitle="Önemli değişikliklerin değiştirilemez kaydı" />
      <Card className="divide-y divide-slate-100 dark:divide-white/10">
        {(data ?? []).map((a) => {
          const who = profiles?.find((p) => p.id === a.actor_id)
          const d = (a.new_data ?? a.old_data) as Record<string, unknown> | null
          const changed = a.action === 'update' && a.old_data && a.new_data
            ? Object.keys(a.new_data).filter((k) => !['updated_at', 'version'].includes(k) && JSON.stringify(a.new_data![k]) !== JSON.stringify(a.old_data![k]))
            : []
          return (
            <div key={a.id} className="p-3.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={a.action === 'delete' ? 'red' : a.action === 'insert' ? 'green' : 'brand'}>{A[a.action]}</Badge>
                <b>{T[a.table_name] ?? a.table_name}</b>
                <span className="text-slate-600 dark:text-slate-300">{String(d?.full_name ?? d?.name ?? d?.status ?? d?.amount ?? '')}</span>
                <span className="ml-auto text-xs text-slate-400">{formatDateTime(a.created_at)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{who ? who.full_name : a.actor_id ? 'Kullanıcı' : 'Sistem'}{changed.length > 0 && ` · değişen: ${changed.join(', ')}`}</p>
            </div>
          )
        })}
        {(data ?? []).length === 0 && <p className="p-4 text-sm text-slate-500">Kayıt yok.</p>}
      </Card>
      {(data?.length ?? 0) >= limit && <div className="mt-3 text-center"><Button variant="secondary" onClick={() => setLimit(limit + 200)}>Daha fazla yükle</Button></div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Telefona kurulum
// ---------------------------------------------------------------------------
interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferredPrompt: BeforeInstallPromptEvent | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e as BeforeInstallPromptEvent })
}

export function InstallPage() {
  const [canPrompt, setCanPrompt] = useState(!!deferredPrompt)
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); deferredPrompt = e as BeforeInstallPromptEvent; setCanPrompt(true) }
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  return (
    <div>
      <PageHeader title="Telefona yükle" subtitle="Uygulama mağazası veya APK gerekmez." />
      {standalone ? (
        <Card className="flex items-center gap-3 p-4"><CheckCircle2 className="size-6 text-emerald-600" /><p className="text-sm">Uygulama bu cihazda yüklü olarak çalışıyor.</p></Card>
      ) : canPrompt ? (
        <Card className="p-4">
          <p className="mb-3 text-sm">Bu cihaz tek dokunuşla kurulumu destekliyor.</p>
          <Button icon={<Download className="size-4" />} onClick={async () => { await deferredPrompt?.prompt(); deferredPrompt = null; setCanPrompt(false) }}>Ana ekrana ekle</Button>
        </Card>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-bold">iPhone / iPad (Safari)</h3>
          <ol className="mt-3 space-y-3 text-sm">
            <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">1</span>Uygulama adresini <b>Safari</b> ile açın.</li>
            <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">2</span><span>Alttaki <Share className="inline size-4" /> <b>Paylaş</b> düğmesine dokunun.</span></li>
            <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">3</span><span><PlusSquare className="inline size-4" /> <b>Ana Ekrana Ekle</b>'yi seçin ve <b>Ekle</b>'ye dokunun.</span></li>
          </ol>
        </Card>
        <Card className="p-5">
          <h3 className="font-bold">Android (Chrome)</h3>
          <ol className="mt-3 space-y-3 text-sm">
            <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-50 font-bold text-accent-700">1</span>Uygulama adresini <b>Chrome</b> ile açın.</li>
            <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-50 font-bold text-accent-700">2</span><span>Sağ üstteki <MoreVertical className="inline size-4" /> menüye dokunun.</span></li>
            <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-50 font-bold text-accent-700">3</span><span><b>Uygulamayı yükle</b> veya <b>Ana ekrana ekle</b>'yi seçin.</span></li>
          </ol>
        </Card>
      </div>
      <Card className="mt-4 flex gap-3 p-4 text-sm text-slate-600 dark:text-slate-300">
        <ShieldCheck className="size-5 shrink-0 text-brand-600" />
        <p>Uygulama adresini herkes açabilir, ancak öğrenci ve ders verilerini yalnızca yönetici tarafından davet koduyla yetkilendirilmiş cihazlar görebilir. Yetkilendirilmiş cihaz her açılışta şifre sormadan doğrudan ana panele girer. Yeni sürüm yayınlandığında uygulama otomatik olarak güncellenir.</p>
      </Card>
    </div>
  )
}

export function NotificationSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back title="Bildirim ayarları" subtitle="Ders hatırlatmaları ve anlık bildirimler" />
      <NotificationSettings />
    </div>
  )
}
