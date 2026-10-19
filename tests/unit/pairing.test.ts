import { describe, expect, it } from 'vitest'
import { generateInviteCode, normalizeCode, formatCode, sha256Hex, CODE_LENGTH } from '@/lib/pairing'

describe('cihaz davet kodu', () => {
  it('10 karakter, karışabilecek harf içermez, her seferinde farklı', () => {
    const codes = new Set(Array.from({ length: 500 }, generateInviteCode))
    expect(codes.size).toBe(500)
    for (const c of codes) {
      expect(c).toHaveLength(CODE_LENGTH)
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/)
    }
  })
  it('kullanıcı girişini normalleştirir (küçük harf, tire, O/I/L)', () => {
    expect(normalizeCode('ab3k9-7xq2m')).toBe('AB3K97XQ2M')
    expect(normalizeCode('o1l1i 22222')).toBe('0111122222')
    expect(formatCode('ab3k97xq2m')).toBe('AB3K9-7XQ2M')
  })
  it('sunucuyla aynı SHA-256 özetini üretir', async () => {
    expect(await sha256Hex('AB3K97XQ2M')).toMatch(/^[0-9a-f]{64}$/)
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
