import { StrictMode, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from '@/hooks/useAuth'
import { ToastProvider } from '@/components/ui/Toast'
import { applyTheme } from '@/hooks/useTheme'
import { isIosBrowserNotInstalled, readLinkKey } from '@/lib/pairing'
import './index.css'

applyTheme()

// iPhone: Safari'de özel bağlantıyla açıldıysa ana ekrana eklenen uygulama da aynı anahtarla başlasın
// (ana ekran uygulaması Safari'den ayrı depolama kullanır). Yalnızca iOS Safari'de yapılır.
{
  const k = readLinkKey()
  const link = document.querySelector('link[rel="manifest"]')
  if (k && link && isIosBrowserNotInstalled()) link.setAttribute('href', `/api/manifest?k=${k}`)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (count, err) => count < 2 && !/JWT|permission|42501/i.test(String((err as Error)?.message)),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { networkMode: 'always', retry: false },
  },
})

/** index.html'deki logo ekranının aynısı; askıda kalırsa boot-watchdog.js kurtarma seçeneklerini buraya ekler */
function BootSplash() {
  return (
    <div id="boot-splash" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#fff', fontFamily: 'system-ui,sans-serif' }}>
      <img src="/logo.png" alt="" width={112} height={112} />
      <div style={{ fontWeight: 800, letterSpacing: '.12em', color: '#172033' }}>MUTU AKADEMİ</div>
    </div>
  )
}

/** React ilk ekranı gerçekten çizdiğinde açılış güvencesine (boot-watchdog.js) haber verir */
function Mounted() {
  useEffect(() => {
    ;(window as unknown as { __mutuMounted?: boolean }).__mutuMounted = true
    // Başarılı açılıştan sonra "eski sürüm" kurtarma bayrağını sıfırla
    const t = setTimeout(() => {
      try { sessionStorage.removeItem('mutu-chunk-reload'); sessionStorage.removeItem('mutu-boot-retry') } catch { /* yoksay */ }
    }, 10_000)
    return () => clearTimeout(t)
  }, [])
  return null
}

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            {/* Kök hiçbir zaman sessizce askıda kalmaz: tembel yüklenen parça beklenirken logo ekranı ve süre sınırı */}
            <Suspense fallback={<BootSplash />}>
              <App />
              <Mounted />
            </Suspense>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
} catch (e) {
  ;(window as unknown as { __mutuBootFail?: (m: string) => void }).__mutuBootFail?.(String((e as Error)?.message ?? e))
}
