import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Share, PlusSquare, ShieldCheck, Lock, RefreshCw } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { clearLinkKey, guessDeviceName, isIosBrowserNotInstalled, pairDevice } from '@/lib/pairing'
import { Button, PageLoader } from '@/components/ui'

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-white px-6 py-10 text-center dark:bg-[#0b0f14]">
      <img src="/logo.png" alt="Mutu Akademi" width={96} height={96} />
      <p className="mt-3 text-xl font-extrabold tracking-[0.16em]">MUTU AKADEMİ</p>
      <div className="cmyk-bar mb-6 mt-3 h-1 w-24 rounded-full" />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}

/**
 * Yetkisiz cihaz için açılış kapısı. Giriş, şifre, kod veya QR formu YOKTUR.
 * - Özel bağlantıyla (…/?k=ANAHTAR) açıldıysa cihaz otomatik ve tek seferlik yetkilendirilir.
 * - iPhone'da Safari içindeyse anahtar harcanmaz; önce ana ekrana ekleme gösterilir
 *   (ana ekran uygulaması Safari'den ayrı depolama kullanır).
 * - Anahtar yoksa yalnızca bilgilendirme gösterilir; hiçbir veri görünmez.
 */
export function DeviceGate({ linkKey }: { linkKey: string | null }) {
  const { refreshProfile } = useAuth()
  const [state, setState] = useState<'idle' | 'pairing' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [useHere, setUseHere] = useState(false)
  const started = useRef(false)
  const iosSafari = isIosBrowserNotInstalled()
  const waitInstall = !!linkKey && iosSafari && !useHere

  useEffect(() => {
    if (!linkKey || waitInstall || started.current) return
    started.current = true
    setState('pairing')
    pairDevice(linkKey, guessDeviceName())
      .then(async () => {
        clearLinkKey()
        await refreshProfile()
      })
      .catch((e: Error) => {
        clearLinkKey()
        setError(e.message)
        setState('error')
      })
  }, [linkKey, waitInstall, refreshProfile])

  if (waitInstall) {
    return (
      <Screen>
        <h1 className="text-xl font-bold">Ana ekrana ekleyin</h1>
        <p className="mt-2 text-sm text-slate-500">Bu özel bağlantı bu iPhone'u Mutu Akademi'ye bağlar. Uygulama olarak kullanmak için:</p>
        <ol className="mt-5 space-y-3 text-left text-sm">
          <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">1</span><span>Alttaki <Share className="inline size-4" /> <b>Paylaş</b> düğmesine dokunun.</span></li>
          <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">2</span><span><PlusSquare className="inline size-4" /> <b>Ana Ekrana Ekle</b> → <b>Ekle</b>.</span></li>
          <li className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">3</span><span>Ana ekrandaki <b>Mutu Akademi</b> simgesini açın. Uygulama kendiliğinden yetkilendirilir ve ana panel açılır.</span></li>
        </ol>
        <button onClick={() => setUseHere(true)} className="mt-6 min-h-[44px] text-sm font-medium text-slate-500">Ana ekrana eklemeden Safari'de kullan</button>
      </Screen>
    )
  }

  if (linkKey && state !== 'error') {
    return (
      <Screen>
        <PageLoader />
        <p className="text-sm text-slate-500">Cihaz güvenli şekilde yetkilendiriliyor…</p>
      </Screen>
    )
  }

  return (
    <Screen>
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"><Lock className="size-6" /></span>
      <h1 className="mt-4 text-xl font-bold">Bu cihaz yetkili değil</h1>
      {error ? (
        <p className="mt-2 text-sm text-red-600">{/geçersiz|kullanılmış|süresi/i.test(error) ? 'Bu özel bağlantı daha önce kullanılmış veya süresi dolmuş. Yöneticinizden yeni bir bağlantı isteyin.' : error}</p>
      ) : (
        <p className="mt-2 text-sm text-slate-500">Mutu Akademi'yi kullanmak için yöneticinizden bu cihaza özel, tek kullanımlık bağlantıyı isteyin ve bu cihazda açın. Bir kez açtıktan sonra uygulama her seferinde doğrudan açılır.</p>
      )}
      {error && <Button variant="secondary" className="mt-4" icon={<RefreshCw className="size-4" />} onClick={() => window.location.replace('/')}>Yeniden dene</Button>}
      <p className="mt-6 flex items-start gap-2 rounded-2xl bg-slate-50 p-3 text-left text-xs text-slate-500 dark:bg-white/5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" />
        Öğrenci, veli ve ödeme bilgileri yalnızca yetkilendirilmiş cihazlarda görünür.
      </p>
    </Screen>
  )
}
