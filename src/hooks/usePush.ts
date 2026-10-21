import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Web Push yardımcıları. İzin YALNIZCA kullanıcı "Bildirimleri etkinleştir" butonuna bastığında istenir.
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: 'ios-not-installed' | 'ios-too-old' | 'unsupported' | 'not-configured' }

function isIos() {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC) return { ok: false, reason: 'not-configured' }
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (isIos()) {
    if (!isStandalone()) return { ok: false, reason: 'ios-not-installed' }
    if (!hasApi) return { ok: false, reason: 'ios-too-old' }
  }
  if (!hasApi) return { ok: false, reason: 'unsupported' }
  return { ok: true }
}

export const PUSH_SUPPORT_TEXT: Record<Exclude<PushSupport, { ok: true }>['reason'], string> = {
  'ios-not-installed': 'iPhone/iPad\'de bildirimler yalnızca uygulama ana ekrana eklendikten sonra, ana ekrandaki simgeden açıldığında çalışır.',
  'ios-too-old': 'Bu iOS sürümü web bildirimlerini desteklemiyor. iOS 16.4 veya üzeri gerekir. Uygulama içi bildirimler çalışmaya devam eder.',
  unsupported: 'Bu tarayıcı anlık bildirimleri desteklemiyor. Uygulama içi bildirimler çalışmaya devam eder.',
  'not-configured': 'Anlık bildirim sunucusu henüz yapılandırılmadı.',
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { data: existing } = await supabase.from('push_subscriptions').select('id').eq('endpoint', json.endpoint).maybeSingle()
  if (existing) return
  const { error } = await supabase.from('push_subscriptions').insert({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent.slice(0, 300),
    platform: isIos() ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'desktop',
  })
  if (error && error.code !== '23505') throw error
}

export function usePush(userId: string | undefined) {
  const support = pushSupport()
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    'Notification' in window ? Notification.permission : 'unsupported',
  )
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)

  const refresh = useCallback(async () => {
    if (!support.ok || !userId) { setChecked(true); return }
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    setPermission(Notification.permission)
    if (sub && Notification.permission === 'granted') {
      // Abonelik tarayıcıda var ama sunucuda yoksa (ör. yenilendi) tekrar kaydet
      await saveSubscription(sub).catch(() => undefined)
      setSubscribed(true)
    } else {
      setSubscribed(false)
    }
    setChecked(true)
  }, [support.ok, userId])

  useEffect(() => {
    void refresh()
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'PUSH_RESUBSCRIBE') void refresh()
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [refresh])

  const enable = useCallback(async () => {
    if (!support.ok) throw new Error(PUSH_SUPPORT_TEXT[support.reason])
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') throw new Error('Bildirim izni verilmedi. Cihaz ayarlarından Mutu Akademi için bildirimlere izin verebilirsiniz.')
      const reg = await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC!) }))
      await saveSubscription(sub)
      setSubscribed(true)
    } finally {
      setBusy(false)
    }
  }, [support])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } finally {
      setBusy(false)
    }
  }, [])

  return { support, permission, subscribed, busy, checked, enable, disable, refresh }
}
