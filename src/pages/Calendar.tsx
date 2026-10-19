import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Move } from 'lucide-react'
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useAuth } from '@/hooks/useAuth'
import { useInstructors, useLessons, useDbMutation, updateVersioned } from '@/lib/api'
import {
  addDays, addMonths, dateKey, formatDayLong, fromIstanbul, istanbulParts, minutesBetween, monthGrid, MONTHS,
  startOfMonth, startOfWeek, timeHM, WEEKDAYS_SHORT,
} from '@/lib/time'
import { ATTENDANCE_STATUS } from '@/lib/format'
import type { LessonWithRelations } from '@/types/db'
import { Button, Card, EmptyState, ErrorBox, PageLoader, Segmented, Select } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'
import { LessonRow, LessonSheet } from '@/components/forms/LessonActions'
import { LessonFormSheet } from '@/components/forms/LessonForm'

type View = 'gun' | 'hafta' | 'ay'
const START_HOUR = 7
const END_HOUR = 23
const SLOT_MIN = 30
const HOUR_PX = 56

export function CalendarPage() {
  const { can, instructorId } = useAuth()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>(() => (params.get('gorunum') as View) || (window.innerWidth >= 1024 ? 'hafta' : 'gun'))
  const [cursor, setCursor] = useState(params.get('tarih') || dateKey())
  const [instr, setInstr] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ date: string; time?: string } | null>(null)
  const { data: instructors } = useInstructors()

  const range = useMemo(() => {
    if (view === 'gun') return [cursor, addDays(cursor, 1)]
    if (view === 'hafta') { const s = startOfWeek(cursor); return [s, addDays(s, 7)] }
    const g = monthGrid(cursor); return [g[0], addDays(g[41], 1)]
  }, [view, cursor])

  const filterInstr = can.instructor ? instructorId : instr || null
  const q = useLessons(fromIstanbul(range[0]).toISOString(), fromIstanbul(range[1]).toISOString(), { instructorId: filterInstr })
  const lessons = q.data ?? []
  const selected = lessons.find((l) => l.id === selectedId) ?? null

  const move = (dir: number) => {
    const next = view === 'gun' ? addDays(cursor, dir) : view === 'hafta' ? addDays(cursor, dir * 7) : addMonths(cursor, dir)
    setCursor(next)
    setParams({ tarih: next, gorunum: view }, { replace: true })
  }
  const changeView = (v: View) => {
    setView(v)
    setParams({ tarih: cursor, gorunum: v }, { replace: true })
  }
  const title = view === 'gun' ? formatDayLong(cursor)
    : view === 'hafta' ? (() => { const s = startOfWeek(cursor); const e = addDays(s, 6); return `${Number(s.slice(8))} ${MONTHS[Number(s.slice(5, 7)) - 1]} – ${Number(e.slice(8))} ${MONTHS[Number(e.slice(5, 7)) - 1]}` })()
    : `${MONTHS[Number(cursor.slice(5, 7)) - 1]} ${cursor.slice(0, 4)}`

  return (
    <div>
      <PageHeader title="Takvim" actions={can.lessons && <Button icon={<Plus className="size-4" />} onClick={() => setCreating({ date: cursor })}>Ders oluştur</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={changeView} options={[{ value: 'gun', label: 'Gün' }, { value: 'hafta', label: 'Hafta' }, { value: 'ay', label: 'Ay' }]} />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => move(-1)} aria-label="Önceki"><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="secondary" onClick={() => { setCursor(dateKey()); setParams({ tarih: dateKey(), gorunum: view }, { replace: true }) }}>Bugün</Button>
          <Button size="sm" variant="secondary" onClick={() => move(1)} aria-label="Sonraki"><ChevronRight className="size-4" /></Button>
        </div>
        {can.staff && (
          <Select value={instr} onChange={(e) => setInstr(e.target.value)} className="h-9 w-44 text-sm">
            <option value="">Tüm eğitmenler</option>
            {instructors?.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
          </Select>
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
        </>
      )}
      <LessonSheet lesson={selected} onClose={() => setSelectedId(null)} />
      <LessonFormSheet open={!!creating} onClose={() => setCreating(null)} defaults={creating ? { date: creating.date, time: creating.time, instructor_id: instr || undefined } : undefined} />
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
  const moveLesson = useDbMutation(
    ({ lesson, start: s }: { lesson: LessonWithRelations; start: Date }) => {
      const dur = minutesBetween(lesson.starts_at, lesson.ends_at)
      return updateVersioned('lessons', lesson.id, lesson.version, {
        starts_at: s.toISOString(), ends_at: new Date(s.getTime() + dur * 60000).toISOString(),
      })
    },
    { success: (_r, v) => `Ders ${timeHM(v.start)} saatine taşındı`, invalidate: ['lessons', 'student-lessons'] },
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
      <span className="block font-semibold">{timeHM(lesson.starts_at)} {lesson.student?.full_name}</span>
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
                        {timeHM(l.starts_at)} {l.student?.full_name}
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
