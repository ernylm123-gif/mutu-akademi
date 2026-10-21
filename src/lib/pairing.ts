// Şifresiz cihaz eşleştirme yardımcıları
import { supabase } from '@/lib/supabase'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 (I, L, O, U yok)
export const CODE_LENGTH = 10 // 50 bit rastgelelik

export const LINK_KEY_LENGTH = 24 // özel bağlantı anahtarı: 120 bit rastgelelik

export function generateInviteCode(length = CODE_LENGTH): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => ALPHABET[b & 31]).join('') // 256 % 32 = 0 → eşit dağılım
}

/**
 * Tek kullanımlık özel bağlantı: https://…/#k=ANAHTAR
 * Anahtar adresin # bölümündedir; tarayıcı bu bölümü sunucuya hiç göndermez (log/Referer sızıntısı yok).
 */
export function privateLink(key: string): string {
  return `${window.location.origin}/#k=${normalizeCode(key)}`
}

/** Adres çubuğundaki özel bağlantı anahtarını okur (eski /eslestir?kod= biçimi de desteklenir) */
export function readLinkKey(): string | null {
  const p = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const raw = h.get('k') ?? p.get('k') ?? p.get('kod')
  if (!raw) return null
  const k = normalizeCode(raw)
  return k.length >= CODE_LENGTH && k.length <= 40 ? k : null
}

/** Anahtarı adres çubuğundan ve tarayıcı geçmişinden kaldırır */
export function clearLinkKey() {
  const u = new URL(window.location.href)
  u.searchParams.delete('k')
  u.searchParams.delete('kod')
  const path = u.pathname === '/eslestir' ? '/' : u.pathname
  window.history.replaceState(window.history.state, '', path + (u.search || ''))
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

/**
 * Şifresiz eşleştirme: cihaz Supabase anonim oturumu açar (tek başına hiçbir veriye erişemez),
 * ardından tek kullanımlık davet kodunu sunucuda doğrulatır. Kod doğruysa cihaz yetkilendirilir.
 * Oturum cihazda kalıcıdır; her açılışta şifre sorulmaz.
 */
export async function pairDevice(code: string, deviceName: string) {
  const { data: current } = await supabase.auth.getSession()
  if (!current.session) {
    const { error } = await supabase.auth.signInAnonymously({ options: { data: { full_name: deviceName } } })
    if (error) {
      if (/anonymous/i.test(error.message)) throw new Error('Sunucuda şifresiz cihaz girişi henüz açılmamış (Anonymous sign-ins). Yöneticiye bildirin.')
      if (/fetch/i.test(error.message)) throw new Error('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.')
      throw new Error(error.message)
    }
  }
  const { data, error } = await supabase.rpc('redeem_device_invite', { p_code: normalizeCode(code), p_name: deviceName })
  if (error) throw new Error(error.message || 'Eşleştirme başarısız oldu.')
  return data as { full_name: string; role: string }
}
