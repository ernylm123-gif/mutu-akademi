import { Component, useEffect, useState, type ReactNode } from 'react'
import { RefreshCw, WifiOff, ServerCrash } from 'lucide-react'
import { Button, PageLoader } from '@/components/ui'

/**
 * Güvenli önbellek yenileme: Service Worker ve uygulama dosyası önbelleklerini siler, sayfayı yeniden yükler.
 * Oturum ve cihaz yetkisi (localStorage) KORUNUR; kaydedilmiş hiçbir veri silinmez.
 */
export async function hardRefresh() {
  try {
    if ('serviceWorker' in navigator) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
    }
    if ('caches' in window) {
      for (const k of await caches.keys()) await caches.delete(k)
    }
  } catch { /* yoksay */ }
  window.location.reload()
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-white px-6 py-10 text-center dark:bg-[#0b0f14]">
      <img src="/logo.png" alt="Mutu Akademi" width={88} height={88} />
      <p className="mt-3 text-lg font-extrabold tracking-[0.16em]">MUTU AKADEMİ</p>
      <div className="mt-6 w-full max-w-sm">{children}</div>
    </div>
  )
}

export function BootErrorScreen({ kind, message, onRetry }: { kind: 'network' | 'server' | 'app'; message: string; onRetry: () => void }) {
  const Icon = kind === 'network' ? WifiOff : ServerCrash
  const title = kind === 'network' ? 'Sunucuya bağlanılamadı' : kind === 'server' ? 'Sunucu hatası' : 'Uygulama yüklenemedi'
  const hint = kind === 'network'
    ? 'İnternet bağlantınızı kontrol edin. Cihazınızın yetkisi ve verileriniz korunuyor.'
    : 'Kısa süre sonra yeniden deneyin. Sorun devam ederse "Uygulamayı yenile"ye dokunun.'
  return (
    <Shell>
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-500/15"><Icon className="size-6" /></span>
      <h1 className="mt-4 text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{hint}</p>
      <p className="mt-3 break-words rounded-xl bg-slate-50 p-2 font-mono text-xs text-slate-500 dark:bg-white/5">{message}</p>
      <div className="mt-5 grid gap-2">
        <Button block size="lg" icon={<RefreshCw className="size-4" />} onClick={onRetry}>Yeniden dene</Button>
        <Button block variant="ghost" onClick={() => void hardRefresh()}>Uygulamayı yenile (önbelleği temizle)</Button>
      </div>
    </Shell>
  )
}

/** Yükleme göstergesi: belirli süreyi aşarsa kurtarma seçenekleri gösterir (asla sonsuz bekleme yok) */
export function BootLoader({ onRetry, limitMs = 15_000 }: { onRetry: () => void; limitMs?: number }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), limitMs)
    return () => clearTimeout(t)
  }, [limitMs])
  if (slow) return <BootErrorScreen kind={navigator.onLine ? 'server' : 'network'} message="Açılış beklenenden uzun sürdü." onRetry={onRetry} />
  return <Shell><PageLoader /></Shell>
}

/** Eski sürüm dosyası (silinmiş JS parçası) yüklenemezse bir kez otomatik yeniler, yine olmazsa kurtarma ekranı gösterir */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    const chunk = /dynamically imported module|Importing a module script failed|ChunkLoadError|Failed to fetch/i.test(error.message)
    if (chunk) {
      try {
        if (!sessionStorage.getItem('mutu-chunk-reload')) {
          sessionStorage.setItem('mutu-chunk-reload', '1')
          void hardRefresh()
        }
      } catch { /* yoksay */ }
    }
  }
  render() {
    if (this.state.error) {
      return <BootErrorScreen kind="app" message={this.state.error.message} onRetry={() => window.location.reload()} />
    }
    return this.props.children
  }
}
