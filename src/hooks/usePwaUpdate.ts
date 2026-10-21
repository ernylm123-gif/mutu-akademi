import { useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

const CHECK_INTERVAL = 10 * 60 * 1000
const ATTEMPT_KEY = 'mutu-update-attempt'
const LAST_VERSION_KEY = 'mutu-last-version'

/** Kaydedilmemiş form / açık panel varken güncelleme yapılmaz */
function safeToReload() {
  return !document.querySelector('[role="dialog"]')
}

function storage(kind: 'local' | 'session') {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage } catch { return null }
}

/**
 * PWA sürüm yönetimi (iPhone, Android ve tarayıcıda aynı):
 * 1. Açılışta, uygulama öne geldiğinde ve 10 dk'da bir /version.json sunucudan (önbelleksiz) okunur.
 * 2. Sunucu sürümü çalışan sürümden farklıysa Service Worker güncellemesi tetiklenir.
 * 3. Yeni SW (skipWaiting + clientsClaim) devralınca, açık form yoksa uygulama bir kez yenilenir.
 * 4. Aynı sürüm için en fazla bir otomatik yenileme denenir (sonsuz döngü yok); olmazsa "Güncelle" bandı gösterilir.
 * 5. Yeni sürüm açıldığında "Mutu Akademi güncellendi" bilgisi gösterilir.
 */
export function usePwaUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [justUpdated, setJustUpdated] = useState(false)
  const regRef = useRef<ServiceWorkerRegistration | undefined>(undefined)

  // Yeni sürümle açıldıysa bilgilendir
  useEffect(() => {
    const ls = storage('local')
    const last = ls?.getItem(LAST_VERSION_KEY)
    if (last && last !== __APP_VERSION__) setJustUpdated(true)
    ls?.setItem(LAST_VERSION_KEY, __APP_VERSION__)
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
    const hadController = !!navigator.serviceWorker.controller
    let reloaded = false

    const reloadOnce = (target: string) => {
      const ss = storage('session')
      if (ss?.getItem(ATTEMPT_KEY) === target) { setNeedRefresh(true); return } // döngü koruması
      if (!safeToReload()) { setNeedRefresh(true); return }
      ss?.setItem(ATTEMPT_KEY, target)
      reloaded = true
      window.location.reload()
    }

    const onControllerChange = () => {
      if (!hadController || reloaded) return
      reloadOnce(`sw:${__APP_VERSION__}`)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    registerSW({
      immediate: true,
      onNeedRefresh() { setNeedRefresh(true) },
      onRegisteredSW(_url, r) { regRef.current = r },
    })

    const check = async () => {
      if (!navigator.onLine) return
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const { version } = (await res.json()) as { version?: string }
        if (!version || version === __APP_VERSION__) return
        // Sunucuda yeni sürüm var: SW güncellemesini tetikle; devralma gelmezse güvenli anda doğrudan yenile
        await regRef.current?.update().catch(() => undefined)
        setTimeout(() => { if (!reloaded) reloadOnce(version) }, 6000)
      } catch { /* ağ hatası: sonraki kontrolde tekrar denenir */ }
    }
    void check()
    const interval = setInterval(() => void check(), CHECK_INTERVAL)
    const onVis = () => { if (document.visibilityState === 'visible') void check() }
    const onOnline = () => void check()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onOnline)
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  return {
    needRefresh,
    justUpdated,
    dismissUpdated: () => setJustUpdated(false),
    applyUpdate: () => window.location.reload(),
    dismiss: () => setNeedRefresh(false),
  }
}
