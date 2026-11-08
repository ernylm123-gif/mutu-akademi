import { describe, expect, it } from 'vitest'
import { applyFilters, minAndHours, rangeOf, summarize } from '@/lib/reportCalc'
import type { ReportRow } from '@/lib/staffApi'

const row = (o: Partial<ReportRow>): ReportRow => ({
  lesson_id: 'l1', starts_at: '2026-10-05T07:00:00Z', ends_at: '2026-10-05T08:30:00Z', course_name: 'Piyano', student_id: 's1', student_name: 'Ezgi',
  instructor_id: 'i1', instructor_name: 'Ahmet', status: 'tamamlandi', attendance: 'katildi', scheduled_min: 90, taught_min: 90, attended_min: 90, is_group: false, ...o,
})

describe('rapor hesapları', () => {
  it('10 adet 90 dakikalık tamamlanan ders = 15 saat', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ lesson_id: `l${i}` }))
    const s = summarize(rows)
    expect(s.completed).toBe(10)
    expect(s.completedMin).toBe(900)
    expect(minAndHours(s.completedMin)).toBe('900 dk (15 saat)')
    expect(s.byStudent[0].min).toBe(900)
  })

  it('iptal, ertelenen ve planlanan dersler tamamlanan süreye eklenmez', () => {
    const s = summarize([
      row({ lesson_id: 'a' }),
      row({ lesson_id: 'b', status: 'iptal', attendance: null }),
      row({ lesson_id: 'c', status: 'ertelendi', attendance: null }),
      row({ lesson_id: 'd', status: 'planlandi', attendance: null, scheduled_min: 180 }),
    ])
    expect(s.completedMin).toBe(90)
    expect([s.planned, s.completed, s.postponed, s.cancelled]).toEqual([2, 1, 1, 1])
    expect(s.scheduledMin).toBe(270)
  })

  it('grup dersi eğitmen ve toplamda bir kez, öğrencilerde ayrı sayılır; gelmeyen öğrenciye süre yazılmaz', () => {
    const s = summarize([
      row({ lesson_id: 'g', student_id: 's1', student_name: 'Ezgi', is_group: true }),
      row({ lesson_id: 'g', student_id: 's2', student_name: 'Mert', is_group: true, attendance: 'katilmadi' }),
    ])
    expect(s.completed).toBe(1)
    expect(s.completedMin).toBe(90)
    expect(s.byInstructor).toEqual([{ key: 'i1', name: 'Ahmet', completed: 1, min: 90 }])
    expect(s.byStudent.find((x) => x.name === 'Ezgi')?.min).toBe(90)
    expect(s.byStudent.find((x) => x.name === 'Mert')?.min).toBe(0)
  })

  it('180 dakikalık ders 3 saat olarak hesaplanır', () => {
    expect(minAndHours(summarize([row({ scheduled_min: 180 })]).completedMin)).toBe('180 dk (3 saat)')
  })

  it('durum, ders ve tür filtreleri', () => {
    const rows = [row({ lesson_id: 'a' }), row({ lesson_id: 'b', status: 'iptal' }), row({ lesson_id: 'c', course_name: 'Keman', is_group: true })]
    expect(applyFilters(rows, { status: 'iptal' }).map((r) => r.lesson_id)).toEqual(['b'])
    expect(applyFilters(rows, { course: 'Keman' }).map((r) => r.lesson_id)).toEqual(['c'])
    expect(applyFilters(rows, { kind: 'bireysel' }).map((r) => r.lesson_id)).toEqual(['a', 'b'])
  })

  it('hızlı tarih aralıkları ay sınırlarında doğru (bitiş günü dahil)', () => {
    expect(rangeOf('bu_ay', '2026-11-08')).toEqual(['2026-11-01', '2026-11-30'])
    expect(rangeOf('gecen_ay', '2026-11-08')).toEqual(['2026-10-01', '2026-10-31'])
    expect(rangeOf('son_3_ay', '2026-11-08')).toEqual(['2026-09-01', '2026-11-30'])
    expect(rangeOf('gecen_ay', '2027-01-15')).toEqual(['2026-12-01', '2026-12-31'])
    expect(rangeOf('bu_ay', '2028-02-10')).toEqual(['2028-02-01', '2028-02-29'])
  })
})
