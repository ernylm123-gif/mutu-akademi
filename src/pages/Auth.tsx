import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Clock, LogOut, Mail, Share, PlusSquare, ShieldCheck, Smartphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { CODE_LENGTH, formatCode, guessDeviceName, isIosBrowserNotInstalled, normalizeCode, pairDevice } from '@/lib/pairing'
import { errorMessage } from '@/lib/errors'
import { loginSchema, registerSchema } from '@/lib/schemas'
import { useAuth } from '@/hooks/useAuth'
import { Button, Card, Field, Input } from '@/components/ui'
import { Logo } from '@/components/layout/Logo'

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-brand-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 size-72 rounded-full bg-accent-500/15 blur-3xl" />
      <div className="pointer-events-none absolute right-10 top-1/3 size-40 rounded-full bg-sun-400/20 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Mutu Akademi" width={96} height={96} />
          <p className="mt-3 text-xl font-extrabold tracking-[0.16em]">MUTU AKADEMİ</p>
          <div className="cmyk-bar mt-3 h-1 w-24 rounded-full" />
        </div>
        <Card className="p-6">
          <h1 className="text-xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </Card>
      </div>
    </div>
  )
}

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { register, handleSubmit, formState } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password })
    if (error) setError(errorMessage(error))
    else navigate('/', { replace: true })
  })

  return (
    <AuthLayout title="Giriş yap" subtitle="Yetkili kullanıcı hesabınızla giriş yapın.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-posta" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" placeholder="ornek@mutuakademi.com" {...register('email')} />
        </Field>
        <Field label="Şifre" error={formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">{error}</p>}
        <Button type="submit" block size="lg" loading={formState.isSubmitting}>Giriş yap</Button>
      </form>
      <div className="mt-5 flex flex-col gap-2 text-center text-sm">
        <Link to="/eslestir" className="font-semibold text-brand-600">Davet koduyla şifresiz bağlan</Link>
        <Link to="/sifremi-unuttum" className="font-medium text-slate-500">Şifremi unuttum</Link>
      </div>
    </AuthLayout>
  )
}

// ---------------------------------------------------------------------------
// Şifresiz cihaz eşleştirme
// ---------------------------------------------------------------------------
export function PairPage() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const [code, setCode] = useState(() => {
    const k = new URLSearchParams(window.location.search).get('kod') ?? ''
    return k ? formatCode(k) : ''
  })
  const [name, setName] = useState(guessDeviceName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [continueHere, setContinueHere] = useState(false)
  const fromLink = new URLSearchParams(window.location.search).has('kod')
  const iosBrowser = isIosBrowserNotInstalled()

  // Kodu adres çubuğundan ve geçmişten kaldır
  useEffect(() => {
    if (fromLink) window.history.replaceState(null, '', '/eslestir')
  }, [fromLink])

  const submit = async () => {
    setError(null)
    if (normalizeCode(code).length !== CODE_LENGTH) {
      setError('Davet kodu 10 karakter olmalıdır (ör. AB3K9-7XQ2M).')
      return
    }
    if (!navigator.onLine) {
      setError('İnternet bağlantısı yok.')
      return
    }
    setBusy(true)
    try {
      await pairDevice(code, name.trim() || guessDeviceName())
      await refreshProfile()
      navigate('/', { replace: true })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (iosBrowser && fromLink && !continueHere) {
    return (
      <AuthLayout title="Önce ana ekrana ekleyin" subtitle="iPhone ve iPad'de eşleştirme, ana ekrana eklenen uygulamanın içinde yapılmalıdır.">
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">1</span><span>Alttaki <Share className="inline size-4" /> <b>Paylaş</b> → <PlusSquare className="inline size-4" /> <b>Ana Ekrana Ekle</b>'ye dokunun.</span></li>
          <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">2</span><span>Ana ekrandaki <b>Mutu Akademi</b> simgesini açın.</span></li>
          <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">3</span><span>Açılan ekrana bu kodu girin:</span></li>
        </ol>
        <p className="mt-4 select-all rounded-2xl bg-slate-100 py-4 text-center font-mono text-2xl font-bold tracking-widest dark:bg-white/10">{code}</p>
        <p className="mt-2 text-center text-xs text-slate-500">Kodu not alın. Tek kullanımlıktır.</p>
        <button onClick={() => setContinueHere(true)} className="mt-5 w-full text-center text-sm font-medium text-slate-500">Ana ekrana eklemeden bu tarayıcıda devam et</button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Cihazı bağla" subtitle="Yöneticinizden aldığınız tek kullanımlık davet kodunu girin. Bu işlem cihaz başına yalnızca bir kez yapılır; sonrasında uygulama şifresiz açılır.">
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4" noValidate>
        <Field label="Davet kodu">
          <Input value={code} onChange={(e) => setCode(formatCode(e.target.value).slice(0, 11))} placeholder="XXXXX-XXXXX" autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false}
            className="text-center font-mono text-xl tracking-widest" />
        </Field>
        <Field label="Bu cihazın adı" hint="Yönetici cihaz listesinde bu adı görür.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">{error}</p>}
        <Button type="submit" block size="lg" loading={busy} icon={<Smartphone className="size-5" />}>Cihazı bağla</Button>
      </form>
      <div className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-white/5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" />
        <span>Uygulama adresi herkese açıktır ama veriler yalnızca yönetici tarafından yetkilendirilmiş cihazlarda görünür. Yönetici bir cihazın erişimini istediği an kaldırabilir.</span>
      </div>
      <p className="mt-4 text-center text-xs"><Link to="/giris" className="text-slate-400">E-posta ile giriş</Link></p>
    </AuthLayout>
  )
}

type RegisterValues = z.infer<typeof registerSchema>

export function RegisterPage() {
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) })

  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    const { error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: { data: { full_name: v.full_name }, emailRedirectTo: `${window.location.origin}/` },
    })
    if (error) setError(errorMessage(error))
    else setDone(true)
  })

  if (done) {
    return (
      <AuthLayout title="Talebiniz alındı">
        <div className="flex flex-col items-center gap-3 text-center text-sm text-slate-600 dark:text-slate-300">
          <Mail className="size-10 text-brand-600" />
          <p>E-posta adresinize bir doğrulama bağlantısı gönderildi. Doğrulamadan sonra hesabınız <b>yönetici onayı</b> bekleyecektir.</p>
          <Link to="/giris" className="font-semibold text-brand-600">Giriş sayfasına dön</Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Hesap talebi" subtitle="Açık üyelik yoktur. Talebiniz yönetici onayından sonra aktifleşir.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Ad soyad" error={formState.errors.full_name?.message}>
          <Input autoComplete="name" {...register('full_name')} />
        </Field>
        <Field label="E-posta" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" {...register('email')} />
        </Field>
        <Field label="Şifre" error={formState.errors.password?.message} hint="En az 8 karakter">
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Field label="Şifre (tekrar)" error={formState.errors.password2?.message}>
          <Input type="password" autoComplete="new-password" {...register('password2')} />
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        <Button type="submit" block size="lg" loading={formState.isSubmitting}>Talep gönder</Button>
      </form>
      <p className="mt-5 text-center text-sm"><Link to="/giris" className="font-medium text-brand-600">Girişe dön</Link></p>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: z.email('Geçerli bir e-posta girin').trim().toLowerCase() })),
  })
  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: `${window.location.origin}/sifre-yenile` })
    if (error) setError(errorMessage(error))
    else setSent(true)
  })
  return (
    <AuthLayout title="Şifre sıfırlama" subtitle="E-posta adresinize sıfırlama bağlantısı gönderilir.">
      {sent ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">Hesap varsa, sıfırlama bağlantısı e-posta adresinize gönderildi.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="E-posta" error={formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...register('email')} />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" block loading={formState.isSubmitting}>Bağlantı gönder</Button>
        </form>
      )}
      <p className="mt-5 text-center text-sm"><Link to="/giris" className="font-medium text-brand-600">Girişe dön</Link></p>
    </AuthLayout>
  )
}

export function UpdatePasswordPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const schema = z.object({ password: z.string().min(8, 'En az 8 karakter').max(72) })
  const { register, handleSubmit, formState } = useForm<{ password: string }>({ resolver: zodResolver(schema) })
  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: v.password })
    if (error) setError(errorMessage(error))
    else navigate('/', { replace: true })
  })
  return (
    <AuthLayout title="Yeni şifre belirle">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Yeni şifre" error={formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" block loading={formState.isSubmitting}>Kaydet</Button>
      </form>
    </AuthLayout>
  )
}

export function PendingApprovalPage() {
  const { profile, signOut, refreshProfile, profileError } = useAuth()
  const inactive = profile && !profile.is_active
  return (
    <AuthLayout title={inactive ? 'Hesap pasif' : 'Onay bekleniyor'}>
      <div className="flex flex-col items-center gap-3 text-center text-sm text-slate-600 dark:text-slate-300">
        <Clock className="size-10 text-amber-500" />
        {profileError ? (
          <p>Profil bilgisi alınamadı: {profileError}</p>
        ) : inactive ? (
          <p>{profile?.is_device ? 'Bu cihazın yetkisi yönetici tarafından kaldırıldı.' : 'Hesabınız yönetici tarafından pasif duruma alınmış.'} Lütfen yöneticinizle iletişime geçin.</p>
        ) : (
          <p>Hesabınız oluşturuldu ve <b>yönetici onayı</b> bekliyor. Onaylandığında bu sayfa otomatik olarak açılacaktır.</p>
        )}
        <p className="text-xs text-slate-400">{profile?.email}</p>
        <div className="mt-2 flex w-full gap-2">
          <Button variant="secondary" block onClick={() => void refreshProfile()}>Yenile</Button>
          <Button variant="ghost" block icon={<LogOut className="size-4" />} onClick={() => void signOut()}>{profile?.is_device ? 'Yeni kodla bağla' : 'Çıkış'}</Button>
        </div>
      </div>
    </AuthLayout>
  )
}

export function MissingConfigPage() {
  return (
    <AuthLayout title="Yapılandırma eksik">
      <p className="text-sm text-slate-600">
        <code>VITE_SUPABASE_URL</code> ve <code>VITE_SUPABASE_ANON_KEY</code> ortam değişkenleri tanımlı değil. README dosyasındaki kurulum adımlarını izleyin.
      </p>
    </AuthLayout>
  )
}

export { Logo }
