// MUTU AKADEMİ – Web Push gönderici (Vercel sunucu fonksiyonu)
// Supabase pg_cron her dakika bekleyen bildirim varsa bu adresi uyandırır.
// Fonksiyon kuyruğu yalnızca kendi gizli anahtarıyla (DB'de sadece SHA-256 özeti var) alır,
// VAPID özel anahtarıyla gönderir ve sonuçları geri bildirir. Service role anahtarı kullanılmaz.
import webpush from 'web-push'

interface Delivery { delivery_id: string; endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string; tag: string }
interface Result { id: string; ok: boolean; status?: number; error?: string }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SECRET = process.env.PUSH_DISPATCH_SECRET ?? ''
const VAPID_PUBLIC = process.env.VITE_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:bildirim@mutuakademi.app'

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`${fn} ${res.status}`)
  return (await res.json()) as T
}

async function sendOne(d: Delivery): Promise<Result> {
  try {
    await webpush.sendNotification(
      { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
      JSON.stringify({ title: d.title, body: d.body, url: d.url, tag: d.tag }),
      { TTL: 60 * 60, urgency: 'high', topic: d.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined },
    )
    return { id: d.delivery_id, ok: true }
  } catch (e) {
    const err = e as { statusCode?: number; body?: string; message?: string }
    return { id: d.delivery_id, ok: false, status: err.statusCode, error: String(err.body || err.message || 'hata').slice(0, 300) }
  }
}

export default async function handler(req: { method?: string }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'method' })
  if (!SUPABASE_URL || !SUPABASE_KEY || !SECRET || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(500).json({ error: 'Sunucu yapılandırması eksik' })
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  let sent = 0
  let failed = 0
  try {
    for (let round = 0; round < 5; round++) {
      const batch = await rpc<Delivery[]>('claim_push_batch', { p_secret: SECRET, p_limit: 100 })
      if (!batch.length) break
      const results: Result[] = []
      for (let i = 0; i < batch.length; i += 10) {
        results.push(...(await Promise.all(batch.slice(i, i + 10).map(sendOne))))
      }
      await rpc<number>('report_push_results', { p_secret: SECRET, p_results: results })
      sent += results.filter((r) => r.ok).length
      failed += results.filter((r) => !r.ok).length
    }
    return res.status(200).json({ sent, failed })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message, sent, failed })
  }
}
