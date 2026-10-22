import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Move, Upload, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useAuth } from '@/hooks/useAuth'
import { useInstructors, useLessons, useDbMutation, useStudents, useCourses, useRooms, planRpc, LESSON_INVALIDATE } from '@/lib/api'
import {
  addDays, addMonths, dateKey, formatDayLong, fromIstanbul, istanbulParts, minutesBetween, monthGrid, MONTHS,
  startOfMonth, startOfWeek, timeHM, WEEKDAYS_SHORT,
} from '@/lib/time'
import { ATTENDANCE_STATUS } from '@/lib/format'
import { collapseGroups, memberLabel, type LessonItem } from '@/lib/lessons'
import type { LessonStatus, LessonWithRelations } from '@/types/db'
import { Button, Card, EmptyState, ErrorBox, Input, PageLoader, Segmented, Select } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { LessonRow, LessonSheet } from '@/components/forms/LessonActions'
import { LessonFormSheet } from '@/components/forms/LessonForm'

type View = 'gun' | 'hafta' | 'ay' | 'liste' | 'egitmen' | 'sinif'
const FILTER_KEY = 'mutu-takvim-filtre'
interface Filters { instr: string; student: string; course: string; room: string; status: string }
function loadFilters(): Filters {
  try { return { instr: '', student: '', course: '', room: '', status: '', ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') } }
  catch { return { instr: '', student: '', course: '', room: '', status: '' } }
}
const START_HOUR = 7
const END_HOUR = 23
const SLOT_MIN = 30
const HOUR_PX = 56

export function CalendarPage() {
  const { can, instructorId } = useAuth()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>(() => (params.get('gorunum') as View) || (window.innerWidth >= 1024 ? 'hafta' : 'gun'))
  const [cursor, setCursor] = useState(params.get('tarih') || dateKey())
  // Son kullanılan filtreler uygulama yeniden açıldığında korunur
  const [f, setF] = useState<Filters>(() => ({ ...loadFilters(), ...(params.get('ogrenci') ? { student: params.get('ogrenci')! } : {}) }))
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)) } catch { /* yoksay */ } }, [f])
  const setFilter = (p: Partial<Filters>) => setF((x) => ({ ...x, ...p }))
  const instr = f.instr
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ date: string; time?: string } | null>(null)
  const { data: instructors } = useInstructors()
  const { data: students } = useStudents()
  const { data: courses } = useCourses()
  const { data: rooms } = useRooms()
  const navigate = useNavigate()

  const range = useMemo(() => {
    if (view === 'gun' || view === 'egitmen' || view === 'sinif') return [cursor, addDays(cursor, 1)]
    if (view === 'hafta' || view === 'liste') { const s = startOfWeek(cursor); return [s, addDays(s, 7)] }
    const g = monthGrid(cursor); return [g[0], addDays(g[41], 1)]
  }, [view, cursor])

  const filterInstr = can.instructor ? instructorId : instr || null
  const q = useLessons(fromIstanbul(range[0]).toISOString(), fromIstanbul(range[1]).toISOString(), { instructorId: filterInstr })
  const rawLessons = useMemo(
    () => (q.data ?? []).filter((l) => (!f.student || l.student_id === f.student) && (!f.course || l.course_id === f.course)
      && (!f.room || l.room_id === f.room) && (!f.status || l.status === (f.status as LessonStatus))),
    [q.data, f],
  )
  // Grup dersleri tek kart; filtre öğrenciye göreyse yalnızca o öğrencinin satırı kalır
  const lessons = useMemo(() => collapseGroups(rawLessons), [rawLessons])
  const filtered = !!(instr || f.student || f.course || f.room || f.status)
  const selected = (q.data ?? []).find((l) => l.id === selectedId) ?? null

  const move = (dir: number) => {
    const next = view === 'hafta' || view === 'liste' ? addDays(cursor, dir * 7) : view === 'ay' ? addMonths(cursor, dir) : addDays(cursor, dir)
    setCursor(next)
    setParams({ tarih: next, gorunum: view }, { replace: true })
  }
  const changeView = (v: View) => {
    setView(v)
    setParams({ tarih: cursor, gorunum: v }, { replace: true })
  }
  const goTo = (d: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return; setCursor(d); setParams({ tarih: d, gorunum: view }, { replace: true }) }
  const title = view === 'gun' || view === 'egitmen' || view === 'sinif' ? formatDayLong(cursor)
    : view === 'hafta' || view === 'liste' ? (() => { const s = startOfWeek(cursor); const e = addDays(s, 6); return `${Number(s.slice(8))} ${MONTHS[Number(s.slice(5, 7)) - 1]} – ${Number(e.slice(8))} ${MONTHS[Number(e.slice(5, 7)) - 1]}` })()
    : `${MONTHS[Number(cursor.slice(5, 7)) - 1]} ${cursor.slice(0, 4)}`

  return (
    <div>
      <PageHeader title="Takvim" actions={can.lessons && <>
        <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => navigate('/program-yukle')}>Program yükle</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => setCreating({ date: cursor })}>Ders oluştur</Button>
      </>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <Segmented value={view} onChange={changeView} options={[
            { value: 'gun', label: 'Gün' }, { value: 'hafta', label: 'Hafta' }, { value: 'ay', label: 'Ay' }, { value: 'liste', label: 'Liste' },
            ...(can.staff ? [{ value: 'egitmen' as View, label: 'Eğitmen' }] : []), { value: 'sinif', label: 'Sınıf' },
          ]} />
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => move(-1)} aria-label="Önceki"><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="secondary" onClick={() => goTo(dateKey())}>Bugüne dön</Button>
          <Button size="sm" variant="secondary" onClick={() => move(1)} aria-label="Sonraki"><ChevronRight className="size-4" /></Button>
          <Input type="date" aria-label="Tarihe git" value={cursor} onChange={(e) => goTo(e.target.value)} className="h-10 w-40 text-sm" />
        </div>
      </div>
      <div className="-mt-2 mb-4 flex gap-2 overflow-x-auto pb-1">
        {can.staff && (
          <Select value={instr} onChange={(e) => setFilter({ instr: e.target.value })} className="h-10 w-44 shrink-0 text-sm" aria-label="Eğitmen filtresi">
            <option value="">Tüm eğitmenler</option>
            {instructors?.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
          </Select>
        )}
        <Select value={f.student} onChange={(e) => setFilter({ student: e.target.value })} className="h-10 w-44 shrink-0 text-sm" aria-label="Öğrenci filtresi">
          <option value="">Tüm öğrenciler</option>
          {students?.filter((s) => s.is_active || s.id === f.student).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </Select>
        <Select value={f.course} onChange={(e) => setFilter({ course: e.target.value })} className="h-10 w-40 shrink-0 text-sm" aria-label="Kurs filtresi">
          <option value="">Tüm kurslar</option>
          {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={f.room} onChange={(e) => setFilter({ room: e.target.value })} className="h-10 w-40 shrink-0 text-sm" aria-label="Sınıf filtresi">
          <option value="">Tüm sınıflar</option>
          {rooms?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select value={f.status} onChange={(e) => setFilter({ status: e.target.value })} className="h-10 w-36 shrink-0 text-sm" aria-label="Durum filtresi">
          <option value="">Tüm durumlar</option>
          <option value="planlandi">Planlandı</option>
          <option value="tamamlandi">Tamamlandı</option>
          <option value="ertelendi">Ertelendi</option>
          <option value="iptal">İptal edildi</option>
        </Select>
        {filtered && (
          <Button size="sm" variant="ghost" className="h-10 shrink-0" icon={<X className="size-4" />} onClick={() => setF({ instr: '', student: '', course: '', room: '', status: '' })}>Temizle</Button>
        )}
      </div>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <PageLoader /> : (
        <>
          {view === 'gun' && (
            lessons.length === 0 ? (
              <Card><EmptyState icon={<CalendarDays className="size-6" />} title="Bu gün ders yok" action={can.lessons && <Button icon={<Plus className="size-4" />} onClick={() => setCreating({ date: cursor })}>Ders oluştur</Button>} /></Card>
            ) : <div className="space-y-2.5">{lessons.map((l) => <LessonRow key={l.id} lesson={l} onClick={() => setSelectedId(l.id)} />)}</div>
          )}
          {view === 'hafta' && <WeekGrid start={startOfWeek(cursor)} lessons={lessons} onOpen={setSelectedId} onCreate={(date, time) => can.lessons && setCreating({ date, time })} draggable={can.lessons} />}
          {view === 'ay' && <MonthGrid cursor={cursor} lessons={lessons} onPick={(d) => { setCursor(d); changeView('gun') }} />}
          {view === 'liste' && (
            lessons.length === 0 ? <Card><EmptyState icon={<CalendarDays className="size-6" />} title="Bu hafta ders yok" /></Card> : (
              <div className="space-y-5">
                {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i)).map((d) => {
                  const items = lessons.filter((l) => dateKey(l.starts_at) === d)
                  if (!items.length) return null
                  return (
                    <section key={d}>
                      <h3 className={clsx('mb-2 px-1 text-xs font-bold uppercase tracking-wide', d === dateKey() ? 'text-brand-600' : 'text-slate-500')}>{formatDayLong(d)}</h3>
                      <div className="space-y-2.5">{items.map((l) => <LessonRow key={l.id} lesson={l} onClick={() => setSelectedId(l.id)} />)}</div>
                    </section>
                  )
                })}
              </div>
            )
          )}
          {(view === 'egitmen' || view === 'sinif') && (
            <ColumnsView
              columns={view === 'egitmen'
                ? [...(instructors ?? []).filter((i) => i.is_active || lessons.some((l) => l.instructor_id === i.id)).map((i) => ({ id: i.id, name: i.full_name, color: i.color })), { id: '', name: 'Eğitmen atanmamış', color: '#94a3b8' }]
                : [...(rooms ?? []).filter((r) => r.is_active || lessons.some((l) => l.room_id === r.id)).map((r) => ({ id: r.id, name: r.name + (r.capacity ? ` (${r.capacity})` : ''), color: '#2563eb' })), { id: '', name: 'Sınıfsız / online', color: '#94a3b8' }]}
              lessons={lessons}
              keyOf={(l) => (view === 'egitmen' ? l.instructor_id : l.room_id) ?? ''}
              onOpen={setSelectedId}
            />
          )}
        </>
      )}
      <LessonSheet lesson={selected} onClose={() => setSelectedId(null)} />
      <LessonFormSheet open={!!creating} onClose={() => setCreating(null)} defaults={creating ? { date: creating.date, time: creating.time, instructor_id: instr || undefined } : undefined} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Eğitmen / sınıf bazlı günlük görünüm
// ---------------------------------------------------------------------------
function ColumnsView({ columns, lessons, keyOf, onOpen }: {
  columns: { id: string; name: string; color: string }[]; lessons: LessonItem[]; keyOf: (l: LessonItem) => string; onOpen: (id: string) => void
}) {
  const visible = columns.filter((c) => c.id !== '' || lessons.some((l) => keyOf(l) === ''))
  if (lessons.length === 0) return <Card><EmptyState icon={<CalendarDays className="size-6" />} title="Bu gün ders yok" /></Card>
  return (
    <div className="flex snap-x gap-3 overflow-x-auto pb-2">
      {visible.map((c) => {
        const items = lessons.filter((l) => keyOf(l) === c.id)
        return (
          <section key={c.id || 'none'} className="w-[78vw] max-w-72 shrink-0 snap-start sm:w-64">
            <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-bold"><span className="size-2.5 rounded-full" style={{ background: c.color }} />{c.name}<span className="ml-auto text-xs font-medium text-slate-400">{items.length}</span></h3>
            <div className="space-y-2">
              {items.length === 0 && <p className="rounded-2xl border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">Boş</p>}
              {items.map((l) => (
                <button key={l.id} onClick={() => onOpen(l.id)} className={clsx('card block w-full p-3 text-left', (l.status === 'iptal' || l.status === 'ertelendi') && 'opacity-50')}>
                  <span className="block text-sm font-bold tabular-nums">{timeHM(l.starts_at)}–{timeHM(l.ends_at)}</span>
                  <span className="block truncate text-sm font-semibold">{memberLabel(l)}</span>
                  <span className="block truncate text-xs text-slate-500">{l.title || l.course?.name || '—'}{l.room ? ` · ${l.room.name}` : ''}</span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Haftalık ızgara + sürükle-bırak
// ---------------------------------------------------------------------------
function WeekGrid({ start, lessons, onOpen, onCreate, draggable }: {
  start: string; lessons: LessonWithRelations[]; onOpen: (id: string) => void; onCreate: (date: string, time: string) => void; draggable: boolean
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const today = dateKey()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 6 } }),
  )
  // Taşıma sunucuda çakışma kontrollü yapılır; grup dersinin tüm öğrencileri birlikte taşınır
  const moveLesson = useDbMutation(
    ({ lesson, start: s }: { lesson: LessonWithRelations; start: Date }) => {
      const dur = minutesBetween(lesson.starts_at, lesson.ends_at)
      const e = new Date(s.getTime() + dur * 60000)
      return planRpc.update(lesson, { date: dateKey(s), start: timeHM(s), end: timeHM(e) }, 'this')
    },
    { success: (_r, v) => `Ders ${timeHM(v.start)} saatine taşındı`, invalidate: LESSON_INVALIDATE },
  )

  const onDragEnd = (e: DragEndEvent) => {
    const lesson = e.active.data.current?.lesson as LessonWithRelations | undefined
    const slot = e.over?.id as string | undefined
    if (!lesson || !slot) return
    const [d, hm] = slot.split('|')
    const s = fromIstanbul(d, hm)
    if (s.getTime() === new Date(lesson.starts_at).getTime()) return
    moveLesson.mutate({ lesson, start: s })
  }

  const slots: string[] = []
  for (let m = START_HOUR * 60; m < END_HOUR * 60; m += SLOT_MIN) slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {draggable && <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-500"><Move className="size-3.5" /> Planlı dersleri sürükleyerek taşıyabilirsiniz (mobilde basılı tutun).</p>}
      <div className="card overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="sticky top-0 z-10 grid grid-cols-[52px_repeat(7,1fr)] border-b border-slate-100 bg-white dark:border-white/10 dark:bg-[#121821]">
            <div />
            {days.map((d, i) => (
              <div key={d} className={clsx('py-2 text-center text-xs font-semibold', d === today ? 'text-brand-600' : 'text-slate-500')}>
                {WEEKDAYS_SHORT[i]}
                <span className={clsx('mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-sm', d === today && 'bg-brand-600 text-white')}>{Number(d.slice(8))}</span>
              </div>
            ))}
          </div>
          <div className="relative grid grid-cols-[52px_repeat(7,1fr)]">
            <div>
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                <div key={i} style={{ height: HOUR_PX }} className="pr-2 text-right text-[11px] text-slate-400">{String(START_HOUR + i).padStart(2, '0')}:00</div>
              ))}
            </div>
            {days.map((d) => (
              <div key={d} className="relative border-l border-slate-100 dark:border-white/5">
                {slots.map((hm) => <Slot key={hm} id={`${d}|${hm}`} onClick={() => onCreate(d, hm)} />)}
                {lessons.filter((l) => dateKey(l.starts_at) === d).map((l) => <WeekLesson key={l.id} lesson={l} onOpen={onOpen} draggable={draggable && l.status === 'planlandi'} />)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DndContext>
  )
}

function Slot({ id, onClick }: { id: string; onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const isHour = id.endsWith(':00')
  return (
    <div ref={setNodeRef} onClick={onClick} style={{ height: HOUR_PX / 2 }}
      className={clsx('cursor-pointer transition-colors', isHour && 'border-t border-slate-100 dark:border-white/5', isOver ? 'bg-brand-100 dark:bg-brand-500/20' : 'hover:bg-slate-50 dark:hover:bg-white/5')} />
  )
}

function WeekLesson({ lesson, onOpen, draggable }: { lesson: LessonWithRelations; onOpen: (id: string) => void; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lesson.id, data: { lesson }, disabled: !draggable })
  const p = istanbulParts(lesson.starts_at)
  const top = ((p.hh - START_HOUR) * 60 + p.mm) * (HOUR_PX / 60)
  const height = Math.max(22, minutesBetween(lesson.starts_at, lesson.ends_at) * (HOUR_PX / 60) - 2)
  if (p.hh < START_HOUR || p.hh >= END_HOUR) return null
  const color = lesson.instructor?.color ?? '#29a8df'
  const faded = lesson.status === 'iptal' || lesson.status === 'ertelendi'
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onOpen(lesson.id) }}
      className={clsx('absolute inset-x-0.5 z-[1] overflow-hidden rounded-lg px-1.5 py-1 text-left text-[11px] leading-tight text-white shadow-sm', faded && 'opacity-40', isDragging && 'z-20 shadow-xl ring-2 ring-white', draggable && 'touch-none')}
      style={{ top, height, background: color, transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
    >
      <span className="block font-semibold">{timeHM(lesson.starts_at)} {memberLabel(lesson)}</span>
      {height > 34 && <span className="block truncate opacity-90">{lesson.attendance ? ATTENDANCE_STATUS[lesson.attendance.status].label : lesson.instructor?.full_name}</span>}
    </button>
  )
}

function MonthGrid({ cursor, lessons, onPick }: { cursor: string; lessons: LessonWithRelations[]; onPick: (d: string) => void }) {
  const grid = monthGrid(cursor)
  const month = startOfMonth(cursor).slice(0, 7)
  const today = dateKey()
  const byDay = useMemo(() => {
    const m = new Map<string, LessonWithRelations[]>()
    for (const l of lessons) {
      const k = dateKey(l.starts_at)
      m.set(k, [...(m.get(k) ?? []), l])
    }
    return m
  }, [lessons])
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-100 text-center text-xs font-semibold text-slate-500 dark:border-white/10">
        {WEEKDAYS_SHORT.map((w) => <div key={w} className="py-2">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {grid.map((d) => {
          const items = byDay.get(d) ?? []
          const active = items.filter((l) => l.status === 'planlandi' || l.status === 'tamamlandi')
          return (
            <button key={d} onClick={() => onPick(d)} className={clsx('flex min-h-[72px] flex-col items-start gap-1 border-b border-r border-slate-100 p-1.5 text-left dark:border-white/5 sm:min-h-[96px]', d.slice(0, 7) !== month && 'opacity-40')}>
              <span className={clsx('grid size-6 place-items-center rounded-full text-xs font-semibold', d === today && 'bg-brand-600 text-white')}>{Number(d.slice(8))}</span>
              {active.length > 0 && (
                <>
                  <span className="hidden w-full space-y-0.5 sm:block">
                    {active.slice(0, 3).map((l) => (
                      <span key={l.id} className="block truncate rounded px-1 text-[10px] font-medium text-white" style={{ background: l.instructor?.color ?? '#29a8df' }}>
                        {timeHM(l.starts_at)} {memberLabel(l)}
                      </span>
                    ))}
                    {active.length > 3 && <span className="block text-[10px] text-slate-500">+{active.length - 3} ders</span>}
                  </span>
                  <span className="rounded-full bg-brand-50 px-1.5 text-[10px] font-bold text-brand-700 sm:hidden dark:bg-brand-500/15 dark:text-brand-300">{active.length}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
