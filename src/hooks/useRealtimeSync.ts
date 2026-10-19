import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { TABLE_KEYS } from '@/lib/api'

export type SyncStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

// Küçük global durum deposu (bağlantı göstergesi için)
let status: SyncStatus = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'connecting'
let lastSync = Date.now()
const listeners = new Set<() => void>()
function setStatus(s: SyncStatus) {
  if (s === status) return
  status = s
  listeners.forEach((l) => l())
}
function touch() {
  lastSync = Date.now()
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useSyncStatus() {
  const s = useSyncExternalStore(subscribe, () => status)
  const t = useSyncExternalStore(subscribe, () => lastSync)
  return { status: s, lastSync: t }
}

/**
 * Supabase Realtime ile tüm tablolardaki değişiklikleri dinler ve ilgili sorguları yeniler.
 * Bağlantı koparsa uyarı gösterilir; yeniden bağlanınca tüm veriler sunucudan doğrulanır.
 */
export function useRealtimeSync(userId: string | undefined) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!userId) return
    let wasLive = false
    let disposed = false
    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      timer = null
      for (const k of pending) void qc.invalidateQueries({ queryKey: [k] as QueryKey })
      pending.clear()
      touch()
    }

    const revalidateAll = () => {
      void qc.invalidateQueries()
      touch()
    }

    let channel = supabase.channel(`db-sync-${userId}`)
    for (const table of Object.keys(TABLE_KEYS)) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        for (const k of TABLE_KEYS[table]) pending.add(k)
        if (!timer) timer = setTimeout(flush, 120) // ani toplu değişiklikleri birleştir
      })
    }
    channel.subscribe((s) => {
      if (disposed) return
      if (s === 'SUBSCRIBED') {
        if (wasLive) revalidateAll() // yeniden bağlandı: kaçırılan değişiklikleri al
        wasLive = true
        setStatus('live')
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        setStatus(navigator.onLine ? 'reconnecting' : 'offline')
      }
    })

    const onOnline = () => {
      setStatus('reconnecting')
      revalidateAll()
    }
    const onOffline = () => setStatus('offline')
    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidateAll()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [userId, qc])
}
