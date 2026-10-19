import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserPlus, Users, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useStudents, useInstructors, useCourses, useBalances } from '@/lib/api'
import { formatMoney, matchesSearch } from '@/lib/format'
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Input, PageLoader, Segmented, Select } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { StudentFormSheet } from '@/components/forms/StudentForm'

export function StudentsPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useStudents()
  const { data: instructors } = useInstructors()
  const { data: courses } = useCourses()
  const { data: balances } = useBalances(can.payments)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'aktif' | 'pasif' | 'hepsi'>('aktif')
  const [instructor, setInstructor] = useState('')
  const [adding, setAdding] = useState(false)

  const list = useMemo(() => {
    return (data ?? []).filter((s) =>
      (filter === 'hepsi' || (filter === 'aktif' ? s.is_active : !s.is_active)) &&
      (!instructor || s.instructor_id === instructor) &&
      matchesSearch([s.full_name, s.phone, s.guardian_name, s.guardian_phone], q),
    )
  }, [data, filter, instructor, q])

  if (isLoading) return <PageLoader />

  return (
    <div>
      <PageHeader
        title="Öğrenciler"
        subtitle={`${data?.filter((s) => s.is_active).length ?? 0} aktif öğrenci`}
        actions={can.students && <Button icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>Öğrenci ekle</Button>}
      />
      {error && <ErrorBox error={error} onRetry={() => refetch()} />}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input placeholder="İsim, telefon veya veli ara…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" type="search" />
        </div>
        <div className="flex items-center gap-2">
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'aktif', label: 'Aktif' }, { value: 'pasif', label: 'Pasif' }, { value: 'hepsi', label: 'Tümü' }]} />
          {can.staff && (
            <Select value={instructor} onChange={(e) => setInstructor(e.target.value)} className="h-10 w-40 text-sm">
              <option value="">Tüm eğitmenler</option>
              {instructors?.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
            </Select>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<Users className="size-6" />} title={q ? 'Sonuç bulunamadı' : 'Henüz öğrenci yok'} text={q ? 'Farklı bir arama deneyin.' : 'İlk öğrencinizi ekleyerek başlayın.'}
            action={can.students && !q && <Button icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>Öğrenci ekle</Button>} />
        </Card>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {list.map((s) => {
            const inst = instructors?.find((i) => i.id === s.instructor_id)
            const course = courses?.find((c) => c.id === s.course_id)
            const bal = balances?.find((b) => b.student_id === s.id)
            const pct = s.total_lessons > 0 ? Math.min(100, Math.round((s.used_lessons / s.total_lessons) * 100)) : 0
            return (
              <button key={s.id} onClick={() => navigate(`/ogrenciler/${s.id}`)} className="card flex items-center gap-3 p-3.5 text-left transition hover:-translate-y-0.5">
                <Avatar name={s.full_name} color={inst?.color} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{s.full_name}</span>
                    {!s.is_active && <Badge>Pasif</Badge>}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{course?.name ?? 'Kurs yok'} · {inst?.full_name ?? 'Eğitmen yok'}</span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <span className="block h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                    </span>
                    <span className={`text-xs font-semibold tabular-nums ${s.remaining_lessons <= 2 && s.total_lessons > 0 ? 'text-accent-600' : 'text-slate-500'}`}>
                      {s.remaining_lessons}/{s.total_lessons} hak
                    </span>
                  </span>
                  {bal && Number(bal.balance) > 0 && <span className="mt-1 block text-xs font-medium text-red-600">Kalan borç: {formatMoney(bal.balance)}</span>}
                </span>
                <ChevronRight className="size-4 text-slate-300" />
              </button>
            )
          })}
        </div>
      )}
      <StudentFormSheet open={adding} onClose={() => setAdding(false)} onSaved={(s) => navigate(`/ogrenciler/${s.id}`)} />
    </div>
  )
}
