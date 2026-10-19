// Supabase / PostgreSQL hatalarını kullanıcıya anlaşılır Türkçe mesajlara çevirir.
// Başarısız bir işlem hiçbir zaman başarılı gösterilmez.
export const CONFLICT_MESSAGE = 'Bu kayıt başka bir cihazda güncellendi. Güncel veriler yüklendi; lütfen tekrar deneyin.'

export class ConflictError extends Error {
  constructor(message = CONFLICT_MESSAGE) {
    super(message)
    this.name = 'ConflictError'
  }
}

interface PgLikeError { code?: string; message?: string }

export function errorMessage(err: unknown): string {
  if (!err) return 'Bilinmeyen hata'
  if (err instanceof ConflictError) return err.message
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'İnternet bağlantısı yok. Değişiklik KAYDEDİLMEDİ.'
  }
  const e = err as PgLikeError
  const msg = e.message ?? String(err)
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) {
    return 'Sunucuya ulaşılamadı. Değişiklik KAYDEDİLMEDİ; bağlantınızı kontrol edin.'
  }
  switch (e.code) {
    case '23P01':
      if (msg.includes('instructor')) return 'Çakışma: Eğitmenin bu saatte başka bir dersi var.'
      return 'Çakışma: Öğrencinin bu saatte başka bir dersi var.'
    case '40001':
      return msg || CONFLICT_MESSAGE
    case '42501':
      return msg && !/row-level security|permission denied/i.test(msg) ? msg : 'Bu işlem için yetkiniz yok.'
    case 'PGRST116':
      return CONFLICT_MESSAGE
    case '23505':
      return 'Bu kayıt zaten mevcut.'
    case '23514':
      return 'Girilen değerlerden biri geçersiz.'
    case '23503':
      return 'İlişkili kayıt bulunamadı veya kullanımda.'
    case 'P0001':
    case 'P0002':
    case '22023':
      return msg
  }
  if (/Invalid login credentials/i.test(msg)) return 'E-posta veya şifre hatalı.'
  if (/Email not confirmed/i.test(msg)) return 'E-posta adresiniz henüz doğrulanmadı. Gelen kutunuzu kontrol edin.'
  if (/User already registered|already been registered/i.test(msg)) return 'Bu e-posta ile zaten bir hesap var.'
  if (/Password should be/i.test(msg)) return 'Şifre en az 8 karakter olmalıdır.'
  if (/rate limit/i.test(msg)) return 'Çok fazla deneme yapıldı. Lütfen biraz bekleyin.'
  return msg
}

export function assertOnline() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('İnternet bağlantısı yok. Değişiklik KAYDEDİLMEDİ.')
  }
}
