// Cihaza özel küçük kolaylıklar (yalnızca kimlik/saat; kişisel veri saklanmaz)
function read(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') as string[] } catch { return [] }
}
function push(key: string, value: string, max: number) {
  try {
    const list = [value, ...read(key).filter((v) => v !== value)].slice(0, max)
    localStorage.setItem(key, JSON.stringify(list))
  } catch { /* depolama kapalı olabilir */ }
}
export const recentStudents = { get: () => read('mutu-recent-students'), add: (id: string) => push('mutu-recent-students', id, 6) }
/** Sık kullanılan ders saatleri: kullanım sayısına göre sıralı */
export const frequentTimes = {
  get: (): string[] => {
    try {
      const m = JSON.parse(localStorage.getItem('mutu-times') ?? '{}') as Record<string, number>
      return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t).sort()
    } catch { return [] }
  },
  add: (t: string) => {
    try {
      const m = JSON.parse(localStorage.getItem('mutu-times') ?? '{}') as Record<string, number>
      m[t] = (m[t] ?? 0) + 1
      localStorage.setItem('mutu-times', JSON.stringify(m))
    } catch { /* yoksay */ }
  },
}
