import type { LessonWithRelations } from '@/types/db'

export type LessonItem = LessonWithRelations & { members: LessonWithRelations[] }

/** Grup dersinin öğrenci satırlarını tek kart olarak birleştirir (sıra korunur) */
export function collapseGroups(lessons: LessonWithRelations[]): LessonItem[] {
  const out: LessonItem[] = []
  const byGroup = new Map<string, LessonItem>()
  for (const l of lessons) {
    if (!l.group_id) { out.push({ ...l, members: [l] }); continue }
    const g = byGroup.get(l.group_id)
    if (g) g.members.push(l)
    else { const item = { ...l, members: [l] }; byGroup.set(l.group_id, item); out.push(item) }
  }
  return out
}

/** Kartta görünen öğrenci etiketi: tek öğrenci adı veya "Ezgi, Mert +1" */
export function memberLabel(item: { members?: LessonWithRelations[]; student: LessonWithRelations['student'] }) {
  const m = item.members ?? []
  if (m.length <= 1) return item.student?.full_name ?? 'Öğrenci'
  const names = m.map((x) => x.student?.full_name?.split(' ')[0] ?? '?')
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')
}
