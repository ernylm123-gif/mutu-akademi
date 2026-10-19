import { describe, expect, it } from 'vitest'
import { parseScheduleText, matchStudent, rowsToText, parseCsv } from '@/lib/scheduleParser'
import { waHref } from '@/lib/format'

describe('ders programı ayrıştırıcı', () => {
  it('örnek satırları doğru ayrıştırır', () => {
    const rows = parseScheduleText('Pazartesi – Ezgi – 11.00–13.10\nÇarşamba – Doğa – 13.45–15.55\nCuma – Burcu – 13.30–15.40')
    expect(rows.map((r) => [r.weekday, r.name, r.start, r.end, r.issues.length])).toEqual([
      [1, 'Ezgi', '11:00', '13:10', 0],
      [3, 'Doğa', '13:45', '15:55', 0],
      [5, 'Burcu', '13:30', '15:40', 0],
    ])
  })
  it('farklı yazımları tanır (kısaltma, iki nokta, noktalı virgül, ç/ş olmadan)', () => {
    const [a, b, c] = parseScheduleText('Cmt;Azra Yılmaz;9:30-10:30\ncarsamba Rüzgar 14:00 - 15:10\nPzt | Doğa Kaya | 08.15 – 09.15')
    expect([a.weekday, a.name, a.start, a.end]).toEqual([6, 'Azra Yılmaz', '09:30', '10:30'])
    expect([b.weekday, b.name, b.start]).toEqual([3, 'Rüzgar', '14:00'])
    expect([c.weekday, c.name, c.end]).toEqual([1, 'Doğa Kaya', '09:15'])
  })
  it('eksik ve belirsiz veriyi tahmin etmez, işaretler', () => {
    const [noDay, noEnd, backwards] = parseScheduleText('Ezgi 11.00-12.00\nSalı Ezgi 11.00\nPerşembe Can 15.00-14.00')
    expect(noDay.weekday).toBeNull()
    expect(noDay.issues).toContain('Gün bulunamadı')
    expect(noEnd.end).toBeNull()
    expect(noEnd.issues).toContain('Bitiş saati yok')
    expect(backwards.issues).toContain('Bitiş saati başlangıçtan önce')
  })
  it('başlık satırlarını atlar', () => {
    expect(parseScheduleText('Gün;Öğrenci;Saat\nCuma;Burcu;13.30-15.40')).toHaveLength(1)
  })
  it('Excel saat kesirlerini ve CSV tırnaklarını çözer', () => {
    expect(rowsToText([['Pazartesi', 'Ezgi', 0.4583333, 0.5486111]])).toBe('Pazartesi – Ezgi – 11:00 – 13:10')
    expect(parseCsv('Gün;Öğrenci\n"Cuma";"Burcu ""B"""')).toEqual([['Gün', 'Öğrenci'], ['Cuma', 'Burcu "B"']])
  })
  it('öğrenci eşleştirme: tam, tek ön ek, belirsiz', () => {
    const list = [
      { id: '1', full_name: 'Ezgi Kaya', instructor_id: null, is_active: true },
      { id: '2', full_name: 'Doğa Yıldız', instructor_id: null, is_active: true },
      { id: '3', full_name: 'Doğa Demir', instructor_id: null, is_active: true },
    ]
    expect(matchStudent('ezgi kaya', list).id).toBe('1')
    expect(matchStudent('Ezgi', list).id).toBe('1')
    expect(matchStudent('Doğa', list).ambiguous).toHaveLength(2)
    expect(matchStudent('Burcu', list)).toEqual({ id: null, ambiguous: [] })
  })
})

describe('iletişim kısayolu', () => {
  it('WhatsApp numarasını uluslararası biçime çevirir', () => {
    expect(waHref('0532 123 45 67')).toBe('https://wa.me/905321234567')
    expect(waHref('+90 532 123 45 67')).toBe('https://wa.me/905321234567')
    expect(waHref(null)).toBeUndefined()
  })
})
