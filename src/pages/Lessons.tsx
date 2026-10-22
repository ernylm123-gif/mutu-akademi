import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Plus, Search, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCourses, useInstructors, useLessons, useStudents } from '@/lib/api'
import { addDays, dateKey, formatDayLong, fromIstanbul } from '@/lib/time'
import { matchesSearch } from '@/lib/format'
import { collapseGroups } from '@/lib/lessons'
import { Button, Card, EmptyState, ErrorBox, Input, PageLoader, Segmented, Select } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { LessonRow, LessonSheet } from '@/components/forms/LessonActions'
import { LessonFormSheet } from '@/components/forms/LessonForm'

type Tab = 'yaklasan' | 'gecmis'

/** Dersler: yaklaşan / geçmiş dersler, öğrenci–eğitmen–kurs filtresi ve arama */
export function LessonsPage() {
  const { can, instructorId } = useAuth()
  const navigate = useNavigate()
  const today = dateKey()
  const [tab, setTab] = useState<Tab>('yaklasan')
  const [q, setQ] = useState('')
  const [student, setStudent] = useState('')
  const [instructor, setInstructor] = useState('')
  const [course, setCourse] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const range = tab === 'yaklasan' ? [today, addDays(today, 31)] : [addDays(today, -60), addDays(today, 1)]
  const lessonsQ = useLessons(fromIstanbul(range[0]).toISOString(), fromIstanbul(range[1]).toISOString(), { instructorId: can.instructor ? instructorId : null })
  const { data: students } = useStudents()
  const { data: instructors } = useInstructors()
  const { data: courses } = useCourses()

  const now = Date.now()
  const list = useMemo(() => {
    const ls = (lessonsQ.data ?? []).filter((l) =>
      (tab === 'yaklasan' ? new Date(l.ends_at).getTime() >= now && l.status === 'planlandi' : new Date(l.starts_at).getTime() < now) &&
      (!student || l.student_id === student) && (!instructor || l.instructor_id === instructor) && (!course || l.course_id === course) &&
      matchesSearch([l.student?.full_name, l.course?.name, l.instructor?.full_name, l.title, l.room?.name], q))
    return collapseGroups(tab === 'gecmis' ? [...ls].reverse() : ls)
  }, [lessonsQ.data, tab, student, instructor, course, q, now])

  const groups = useMemo(() => {
    const m = new Map<string, typeof list>()
    for (const l of list) m.set(dateKey(l.starts_at), [...(m.get(dateKey(l.starts_at)) ?? []), l])
    return [...m.entries()]
  }, [list])
  const filtered = !!(student || instructor || course || q)
  const selected = (lessonsQ.data ?? []).find((l) => l.id === selectedId) ?? null

  return (
    <div>
      <PageHeader title="Dersler" subtitle={tab === 'yaklasan' ? 'Önümüzdeki 31 gün' : 'Son 60 gün'}
        actions={can.lessons && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Ders ekle</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'yaklasan', label: 'Yaklaşan' }, { value: 'gecmis', label: 'Geçmiş' }]} />
        <Button size="sm" variant="secondary" className="h-10" icon={<CalendarDays className="size-4" />} onClick={() => navigate('/takvim')}>Takvim</Button>
      </div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input type="search" placeholder="Öğrenci, kurs veya eğitmen ara…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <Select value={student} onChange={(e) => setStudent(e.target.value)} className="h-10 w-40 shrink-0 text-sm" aria-label="Öğrenci">
          <option value="">Tüm öğrenciler</option>
          {students?.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </Select>
        {can.staff && (
          <Select value={instructor} onChange={(e) => setInstructor(e.target.value)} className="h-10 w-40 shrink-0 text-sm" aria-label="Eğitmen">
            <option value="">Tüm eğitmenler</option>
            {instructors?.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
          </Select>
        )}
        <Select value={course} onChange={(e) => setCourse(e.target.value)} className="h-10 w-36 shrink-0 text-sm" aria-label="Kurs">
          <option value="">Tüm kurslar</option>
          {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        {filtered && <Button size="sm" variant="ghost" className="h-10 shrink-0" icon={<X className="size-4" />} onClick={() => { setStudent(''); setInstructor(''); setCourse(''); setQ('') }}>Temizle</Button>}
      </div>

      {lessonsQ.error && <ErrorBox error={lessonsQ.error} onRetry={() => lessonsQ.refetch()} />}
      {lessonsQ.isLoading ? <PageLoader /> : groups.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="size-6" />} title={filtered ? 'Filtreye uyan ders yok' : tab === 'yaklasan' ? 'Yaklaşan ders yok' : 'Geçmiş ders yok'}
          action={can.lessons && tab === 'yaklasan' && !filtered && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Ders ekle</Button>} /></Card>
      ) : (
        <div className="space-y-5">
          {groups.map(([d, items]) => (
            <section key={d}>
              <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-500">{d === today ? 'Bugün' : formatDayLong(d)}</h2>
              <div className="space-y-2.5">{items.map((l) => <LessonRow key={l.id} lesson={l} showAttendance={tab === 'yaklasan'} onClick={() => setSelectedId(l.id)} />)}</div>
            </section>
          ))}
        </div>
      )}
      <LessonSheet lesson={selected} onClose={() => setSelectedId(null)} />
      <LessonFormSheet open={creating} onClose={() => setCreating(false)} defaults={student ? { student_id: student } : undefined} />
    </div>
  )
}
