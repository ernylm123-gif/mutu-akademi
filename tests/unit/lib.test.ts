import { describe, expect, it } from 'vitest'
import { addDays, addMonths, dateKey, fromIstanbul, isoWeekday, monthGrid, startOfWeek, timeHM, formatDate, diffDays } from '@/lib/time'
import { consumesCredit, remainingCredits, lessonStatusAfterAttendance, overlaps } from '@/lib/rules'
import { toCsv } from '@/lib/csv'
import { errorMessage, ConflictError, CONFLICT_MESSAGE } from '@/lib/errors'
import { splitInstallments, studentSchema, lessonSchema, paymentSchema, registerSchema } from '@/lib/schemas'
import { matchesSearch, trNormalize, formatMoney } from '@/lib/format'

describe('time (Europe/Istanbul)', () => {
  it('İstanbul saatini UTC anına doğru çevirir (UTC+3)', () => {
    expect(fromIstanbul('2026-10-19', '10:00').toISOString()).toBe('2026-10-19T07:00:00.000Z')
    expect(fromIstanbul('2026-01-01', '00:30').toISOString()).toBe('2025-12-31T21:30:00.000Z')
  })
  it('UTC anını İstanbul gün/saatine çevirir', () => {
    expect(dateKey('2026-10-19T22:30:00Z')).toBe('2026-10-20')
    expect(timeHM('2026-10-19T22:30:00Z')).toBe('01:30')
  })
  it('gün ve ay aritmetiği', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(diffDays('2026-11-01', '2026-10-19')).toBe(13)
  })
  it('hafta Pazartesi başlar', () => {
    expect(isoWeekday('2026-10-19')).toBe(1)
    expect(isoWeekday('2026-10-25')).toBe(7)
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19')
  })
  it('ay ızgarası 42 gün ve Pazartesi ile başlar', () => {
    const g = monthGrid('2026-10-15')
    expect(g).toHaveLength(42)
    expect(isoWeekday(g[0])).toBe(1)
    expect(g).toContain('2026-10-01')
    expect(g).toContain('2026-10-31')
  })
  it('tarih biçimi', () => {
    expect(formatDate('2026-10-19')).toBe('19.10.2026')
    expect(formatDate(null)).toBe('—')
  })
})

describe('ders hakkı kuralları', () => {
  it('yalnızca tamamlanan derste yoklamaya göre hak düşer', () => {
    expect(consumesCredit('tamamlandi', 'katildi', true)).toBe(true)
    expect(consumesCredit('tamamlandi', 'katilmadi', true)).toBe(true)
    expect(consumesCredit('tamamlandi', 'katilmadi', false)).toBe(false)
    expect(consumesCredit('tamamlandi', 'izinli', true)).toBe(false)
    expect(consumesCredit('planlandi', 'katildi', true)).toBe(false)
    expect(consumesCredit('iptal', 'katildi', true)).toBe(false)
    expect(consumesCredit('ertelendi', 'katildi', true)).toBe(false)
    expect(consumesCredit('tamamlandi', null, true)).toBe(false)
  })
  it('kalan hak idempotent hesaplanır (aynı ders iki kez sayılmaz)', () => {
    const lessons = [
      { status: 'tamamlandi' as const, attendance: 'katildi' as const },
      { status: 'tamamlandi' as const, attendance: 'katilmadi' as const },
      { status: 'iptal' as const, attendance: 'izinli' as const },
      { status: 'planlandi' as const, attendance: null },
    ]
    expect(remainingCredits(8, lessons, true)).toEqual({ used: 2, remaining: 6 })
    expect(remainingCredits(8, lessons, false)).toEqual({ used: 1, remaining: 7 })
    // tekrar hesaplama aynı sonucu verir
    expect(remainingCredits(8, lessons, true)).toEqual(remainingCredits(8, lessons, true))
  })
  it('yoklama sonrası ders durumu', () => {
    expect(lessonStatusAfterAttendance('katildi')).toBe('tamamlandi')
    expect(lessonStatusAfterAttendance('katilmadi')).toBe('tamamlandi')
    // Planlama durumu yoklamadan ayrıdır: izinli öğrenci dersi iptal etmez, yalnızca hak düşmez
    expect(lessonStatusAfterAttendance('izinli')).toBe('tamamlandi')
    expect(consumesCredit('tamamlandi', 'gec_geldi', true)).toBe(true)
    expect(consumesCredit('tamamlandi', 'erken_ayrildi', false)).toBe(true)
    expect(consumesCredit('ertelendi', 'katildi', true)).toBe(false)
  })
  it('zaman aralığı çakışması', () => {
    expect(overlaps({ start: 0, end: 60 }, { start: 30, end: 90 })).toBe(true)
    expect(overlaps({ start: 0, end: 60 }, { start: 60, end: 120 })).toBe(false)
  })
})

describe('CSV', () => {
  it('ayırıcı, tırnak ve formül enjeksiyonu', () => {
    const csv = toCsv(['Ad', 'Not'], [['Ayşe; Yılmaz', '=HYPERLINK("x")'], ['Ali', 5]])
    expect(csv).toBe('Ad;Not\r\n"Ayşe; Yılmaz";"\'=HYPERLINK(""x"")"\r\nAli;5')
  })
})

describe('hata mesajları', () => {
  it('çakışma ve yetki hataları Türkçe', () => {
    expect(errorMessage({ code: '23P01', message: 'conflicting key value violates exclusion constraint "lessons_no_instructor_overlap"' })).toMatch(/Eğitmenin/)
    expect(errorMessage({ code: '23P01', message: 'lessons_no_student_overlap' })).toMatch(/Öğrencinin/)
    expect(errorMessage({ code: '42501', message: 'new row violates row-level security policy' })).toBe('Bu işlem için yetkiniz yok.')
    expect(errorMessage(new ConflictError())).toBe(CONFLICT_MESSAGE)
    expect(errorMessage({ code: 'PGRST116', message: '' })).toBe(CONFLICT_MESSAGE)
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/KAYDEDİLMEDİ/)
    expect(errorMessage({ message: 'Invalid login credentials' })).toBe('E-posta veya şifre hatalı.')
  })
})

describe('form şemaları', () => {
  it('öğrenci şeması boş alanları null yapar ve doğrular', () => {
    const r = studentSchema.safeParse({ full_name: '  Elif Kaya ', phone: '', email: 'ELIF@X.COM', birth_date: '', guardian_name: '', guardian_phone: '', address: '', course_id: '', instructor_id: '', total_lessons: '8', total_fee: '1500', notes: '', is_active: true })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.full_name).toBe('Elif Kaya')
      expect(r.data.phone).toBeNull()
      expect(r.data.email).toBe('elif@x.com')
      expect(r.data.course_id).toBeNull()
      expect(r.data.total_lessons).toBe(8)
    }
    expect(studentSchema.safeParse({ full_name: 'A', phone: 'abc', email: 'x', birth_date: '', course_id: '', instructor_id: '', total_lessons: -1, total_fee: 0, is_active: true }).success).toBe(false)
  })
  it('tekrarlayan derste bitiş tarihi zorunlu', () => {
    const base = { student_id: 'x', instructor_id: '', date: '2026-10-20', time: '10:00', duration_minutes: 60, notes: '' }
    expect(lessonSchema.safeParse({ ...base, repeat_weekly: false }).success).toBe(true)
    expect(lessonSchema.safeParse({ ...base, repeat_weekly: true, repeat_until: '2026-10-01' }).success).toBe(false)
    expect(lessonSchema.safeParse({ ...base, repeat_weekly: true, repeat_until: '2026-12-01' }).success).toBe(true)
  })
  it('ödeme tutarı pozitif olmalı', () => {
    expect(paymentSchema.safeParse({ amount: 0, paid_at: '2026-10-19', method: 'nakit' }).success).toBe(false)
    expect(paymentSchema.safeParse({ amount: '250.5', paid_at: '2026-10-19', method: 'kart' }).success).toBe(true)
  })
  it('kayıt şifreleri eşleşmeli', () => {
    expect(registerSchema.safeParse({ full_name: 'Test Kişi', email: 'a@b.co', password: '12345678', password2: '12345679' }).success).toBe(false)
  })
  it('taksitler toplamı korur', () => {
    const parts = splitInstallments(1000, 3)
    expect(parts).toEqual([333.33, 333.33, 333.34])
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 2)
  })
})

describe('arama ve biçimlendirme', () => {
  it('Türkçe karakter duyarsız arama', () => {
    expect(trNormalize('IŞIK Çağrı')).toBe('isik cagri')
    expect(matchesSearch(['Şükrü Öztürk'], 'sukru')).toBe(true)
    expect(matchesSearch(['Ali'], 'veli')).toBe(false)
  })
  it('TL biçimi', () => {
    expect(formatMoney(1250.5)).toMatch(/1\.250,5/)
  })
})
