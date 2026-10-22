import { describe, expect, it } from 'vitest'
import { detectMapping, parseDate, parseTime, parseWeekday, rowsFromTable, findByName } from '@/lib/importMapping'
import { collapseGroups, memberLabel } from '@/lib/lessons'
import { displayStatus } from '@/lib/format'
import type { LessonWithRelations } from '@/types/db'

describe('program içe aktarma – sütun eşleştirme', () => {
  const sheet = [
    ['MUTU AKADEMİ EKİM PROGRAMI'],
    ['Öğrenci Adı', 'Eğitmen', 'Kurs', 'Tarih', 'Başlangıç', 'Bitiş', 'Sınıf'],
    ['Ezgi Kaya', 'Deniz Hoca', 'Python Eğitimi', '22.10.2026', '14.00', '16.00', 'Bilgisayar Laboratuvarı'],
    ['Mert', '', 'Python Eğitimi', '2026-10-23', 0.5833333, '', ''],
    ['', '', '', '', '', '', ''],
  ]
  it('başlık satırını ve sütunları otomatik algılar', () => {
    const d = detectMapping(sheet)
    expect(d?.headerRow).toBe(1)
    expect(d?.mapping).toMatchObject({ ogrenci: 0, egitmen: 1, kurs: 2, tarih: 3, baslangic: 4, bitis: 5, sinif: 6 })
  })
  it('satırları ayrıştırır, eksik bitişi işaretler, boş satırı atlar', () => {
    const d = detectMapping(sheet)!
    const rows = rowsFromTable(sheet, d.headerRow, d.mapping)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Ezgi Kaya', date: '2026-10-22', start: '14:00', end: '16:00', room: 'Bilgisayar Laboratuvarı', issues: [] })
    expect(rows[1].start).toBe('14:00')
    expect(rows[1].issues).toContain('Bitiş saati/süre yok')
  })
  it('süre sütunundan bitiş saati hesaplanır', () => {
    const t = [['Öğrenci', 'Gün', 'Saat', 'Süre'], ['Doğa', 'Çarşamba', '13:45', '90 dk']]
    const d = detectMapping(t)!
    const r = rowsFromTable(t, d.headerRow, d.mapping)[0]
    expect(r).toMatchObject({ weekday: 3, start: '13:45', end: '15:15', issues: [] })
  })
  it('tarih ve saat biçimleri', () => {
    expect(parseDate('05.11.2026')).toBe('2026-11-05')
    expect(parseDate(46317)).toBe('2026-10-22')
    expect(parseDate('31.13.2026')).toBeNull()
    expect(parseTime('9.30')).toBe('09:30')
    expect(parseTime('25:00')).toBeNull()
    expect(parseWeekday('Cumartesi')).toBe(6)
    expect(parseWeekday('cuma')).toBe(5)
  })
  it('ada göre eşleştirme Türkçe karakter duyarsız ve tekil', () => {
    const list = [{ id: '1', name: 'Python Eğitimi' }, { id: '2', name: 'Grafik Tasarım' }]
    expect(findByName('python egitimi', list, (x) => x.name)).toBe('1')
    expect(findByName('Bilinmeyen', list, (x) => x.name)).toBe('')
  })
})

describe('grup dersi gösterimi ve durumlar', () => {
  const base = { status: 'planlandi', starts_at: '2026-10-22T11:00:00Z', ends_at: '2026-10-22T12:00:00Z', attendance: null } as unknown as LessonWithRelations
  const mk = (id: string, group: string | null, name: string) => ({ ...base, id, group_id: group, student: { id, full_name: name, remaining_lessons: 5, phone: null } }) as LessonWithRelations
  it('grup satırları tek kartta birleşir', () => {
    const items = collapseGroups([mk('a', 'g', 'Ezgi Kaya'), mk('b', null, 'Can Demir'), mk('c', 'g', 'Mert Yılmaz'), mk('d', 'g', 'Zeynep Ak')])
    expect(items).toHaveLength(2)
    expect(items[0].members).toHaveLength(3)
    expect(memberLabel(items[0])).toBe('Ezgi, Mert +1')
    expect(memberLabel(items[1])).toBe('Can Demir')
  })
  it('zamana göre "Yaklaşıyor" ve "Devam ediyor"', () => {
    const now = new Date('2026-10-22T10:00:00Z').getTime()
    expect(displayStatus(base, now).label).toBe('Yaklaşıyor')
    expect(displayStatus(base, now + 3600_000 + 60_000).label).toBe('Devam ediyor')
    expect(displayStatus({ ...base, status: 'iptal' }, now).label).toBe('İptal edildi')
  })
})
