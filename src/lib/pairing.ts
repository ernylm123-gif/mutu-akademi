// Şifresiz cihaz eşleştirme yardımcıları
import { supabase } from '@/lib/supabase'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 (I, L, O, U yok)
export const CODE_LENGTH = 10 // 50 bit rastgelelik

export function generateInviteCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => ALPHABET[b & 31]).join('') // 256 % 32 = 0 → eşit dağılım
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

export function formatCode(code: string): string {
  const c = normalizeCode(code)
  return c.length > 5 ? `${c.slice(0, 5)}-${c.slice(5)}` : c
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function pairingLink(code: string): string {
  return `${window.location.origin}/eslestir?kod=${formatCode(code)}`
}

export function guessDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android telefon' : 'Android tablet'
  if (/Windows/.test(ua)) return 'Windows bilgisayar'
  if (/Macintosh/.test(ua)) return 'Mac'
  return 'Cihaz'
}

export function isIosBrowserNotInstalled(): boolean {
  const ua = navigator.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches
  return ios && !standalone
}

/** Davet kodunu sunucuda tüketir ve cihaz için kalıcı, şifresiz oturum açar. */
export async function pairDevice(code: string, deviceName: string) {
  const { data, error } = await supabase.functions.invoke('device-pair', { body: { code: normalizeCode(code), device_name: deviceName } })
  if (error) {
    let msg = 'Eşleştirme başarısız oldu.'
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try { msg = (await ctx.json())?.error ?? msg } catch { /* yoksay */ }
    } else if (/fetch/i.test(error.message)) {
      msg = 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.'
    }
    throw new Error(msg)
  }
  const tokenHash = (data as { token_hash?: string })?.token_hash
  if (!tokenHash) throw new Error((data as { error?: string })?.error ?? 'Eşleştirme başarısız oldu.')
  const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  if (vErr) throw new Error('Oturum başlatılamadı. Yöneticinizden yeni bir davet kodu isteyin.')
  return data as { name: string; role: string }
}
