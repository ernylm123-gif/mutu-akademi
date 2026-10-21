import { useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

const CHECK_INTERVAL = 15 * 60 * 1000

/**
 * Service worker sürüm yönetimi:
 * - Her 15 dakikada ve uygulama öne geldiğinde yeni sürüm kontrol edilir.
 * - Yeni sürüm varsa kullanıcıya "Güncelle" bandı gösterilir.
 * - Uygulama arka plandayken yeni sürüm bulunursa otomatik uygulanır.
 */
export function usePwaUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const updateRef = useRef<((reload?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
    let reg: ServiceWorkerRegistration | undefined
    // Yeni Service Worker kontrolü devraldığında (yeni sürüm) açık formu bozmadan bir kez yenile
    const hadController = !!navigator.serviceWorker.controller
    let reloaded = false
    const onControllerChange = () => {
      if (!hadController || reloaded) return
      if (document.querySelector('[role="dialog"]')) { setNeedRefresh(true); return }
      reloaded = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true)
        // Açık form/panel varken otomatik güncelleme yapma (kaydedilmemiş veri kaybolmasın)
        if (document.visibilityState === 'hidden' && !document.querySelector('[role="dialog"]')) void update(true)
      },
      onRegisteredSW(_url, r) {
        reg = r
      },
    })
    updateRef.current = update
    const check = () => {
      if (navigator.onLine) void reg?.update().catch(() => undefined)
    }
    const interval = setInterval(check, CHECK_INTERVAL)
    const onVis = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return {
    needRefresh,
    applyUpdate: () => {
      if (updateRef.current) void updateRef.current(true)
      else window.location.reload()
    },
    dismiss: () => setNeedRefresh(false),
  }
}
