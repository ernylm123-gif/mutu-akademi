import { useMemo, useState } from 'react'
import { Radio } from 'lucide-react'
import { useActivities } from '@/lib/api'
import { dateKey, formatDayLong } from '@/lib/time'
import { Button, Card, EmptyState, ErrorBox, PageLoader, Segmented } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { ActivityRow } from '@/components/ActivityList'
import { useSyncStatus } from '@/hooks/useRealtimeSync'

type Filter = 'hepsi' | 'ders' | 'yoklama' | 'ogrenci' | 'odeme'
const MATCH: Record<Filter, string[]> = {
  hepsi: [],
  ders: ['lessons', 'weekly_schedules'],
  yoklama: ['attendance'],
  ogrenci: ['students', 'student_notes'],
  odeme: ['payments', 'installments'],
}

export function ActivitiesPage() {
  const [limit, setLimit] = useState(60)
  const [filter, setFilter] = useState<Filter>('hepsi')
  const { data, isLoading, error, refetch } = useActivities(limit)
  const { status } = useSyncStatus()

  const groups = useMemo(() => {
    const list = (data ?? []).filter((a) => filter === 'hepsi' || MATCH[filter].includes(a.table_name))
    const m = new Map<string, typeof list>()
    for (const a of list) {
      const k = dateKey(a.created_at)
      m.set(k, [...(m.get(k) ?? []), a])
    }
    return [...m.entries()]
  }, [data, filter])

  return (
    <div>
      <PageHeader title="Canlı Aktiviteler" subtitle="Tüm cihazlarda yapılan işlemler, anında"
        actions={<span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${status === 'live' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-50 text-amber-700'}`}>
          <Radio className="size-3.5" /> {status === 'live' ? 'Canlı' : 'Bağlanıyor'}
        </span>} />
      <div className="mb-4 overflow-x-auto">
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'hepsi', label: 'Tümü' }, { value: 'ders', label: 'Dersler' }, { value: 'yoklama', label: 'Yoklama' },
          { value: 'ogrenci', label: 'Öğrenciler' }, { value: 'odeme', label: 'Ödemeler' },
        ]} />
      </div>
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      {isLoading ? <PageLoader /> : groups.length === 0 ? (
        <Card><EmptyState icon={<Radio className="size-6" />} title="Henüz aktivite yok" text="Öğrenci ekleme, ders planlama, yoklama ve ödeme işlemleri burada anında görünür." /></Card>
      ) : (
        <div className="space-y-5">
          {groups.map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-500">{day === dateKey() ? 'Bugün' : formatDayLong(day)}</h2>
              <Card className="divide-y divide-slate-100 dark:divide-white/10">
                {items.map((a) => <ActivityRow key={a.id} a={a} />)}
              </Card>
            </section>
          ))}
          {(data?.length ?? 0) >= limit && (
            <div className="text-center"><Button variant="secondary" onClick={() => setLimit(Math.min(200, limit + 60))}>Daha eski aktiviteler</Button></div>
          )}
        </div>
      )}
    </div>
  )
}
