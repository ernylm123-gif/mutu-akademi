/// <reference lib="webworker" />
// MUTU AKADEMİ Service Worker
// - Uygulama kabuğu (JS/CSS/ikon) önbelleğe alınır; öğrenci/ders verileri ASLA önbelleğe alınmaz.
// - Web Push: uygulama kapalıyken ve telefon kilitliyken bildirim gösterir.
// - Bildirime dokunulunca ilgili ekran (ör. ders detayı) açılır.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

interface PushPayload { title?: string; body?: string; url?: string; tag?: string }

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }
  const title = data.title || 'MUTU AKADEMİ'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/' },
      lang: 'tr',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data?.url as string) || '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus()
          c.postMessage({ type: 'NAVIGATE', url })
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})

// Tarayıcı aboneliği yenilerse uygulama açıldığında yeniden kaydedilir (bkz. usePush)
self.addEventListener('pushsubscriptionchange', () => {
  void self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'PUSH_RESUBSCRIBE' })))
})
