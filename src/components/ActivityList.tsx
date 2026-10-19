import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { CheckCircle2, Clock4, Ban, CalendarClock, UserPlus, ClipboardCheck, Wallet, StickyNote, Activity as ActivityIcon, CalendarPlus, ChevronDown } from 'lucide-react'
import type { Activity } from '@/types/db'
import { describeActivity, activityDiff, FIELD_LABEL, type ActivityKind } from '@/lib/activity'
import { formatDate, timeHM, dateKey, relativeTime } from '@/lib/time'

const KIND: Record<ActivityKind, { icon: typeof ActivityIcon; cls: string }> = {
  student: { icon: UserPlus, cls: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
  'lesson-done': { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  'lesson-time': { icon: Clock4, cls: 'bg-sun-100 text-sun-700 dark:bg-sun-500/15 dark:text-sun-400' },
  'lesson-cancel': { icon: Ban, cls: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
  'lesson-postpone': { icon: CalendarClock, cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  lesson: { icon: CalendarPlus, cls: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
  attendance: { icon: ClipboardCheck, cls: 'bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400' },
  payment: { icon: Wallet, cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  note: { icon: StickyNote, cls: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
  other: { icon: ActivityIcon, cls: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
}

export function ActivityRow({ a, compact }: { a: Activity; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const d = describeActivity(a)
  const k = KIND[d.kind]
  const diff = compact ? [] : activityDiff(a)
  const today = dateKey() === dateKey(a.created_at)
  const lessonId = a.summary?.lesson_id
  const body = (
    <>
      <span className={clsx('grid size-10 shrink-0 place-items-center rounded-2xl', k.cls)}><k.icon className="size-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug">{d.text}</span>
        {d.detail && <span className="block text-xs text-slate-500">{d.detail}</span>}
        <span className="mt-0.5 block text-xs text-slate-400">
          {today ? timeHM(a.created_at) : `${formatDate(a.created_at)} ${timeHM(a.created_at)}`} · {a.actor_name}{compact ? '' : ` · ${relativeTime(a.created_at)}`}
        </span>
      </span>
    </>
  )
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-start gap-3">
        {lessonId && a.action !== 'delete' ? <Link to={`/ders/${lessonId}`} className="flex min-w-0 flex-1 items-start gap-3">{body}</Link>
          : a.student_id && a.action !== 'delete' ? <Link to={`/ogrenciler/${a.student_id}`} className="flex min-w-0 flex-1 items-start gap-3">{body}</Link>
          : <div className="flex min-w-0 flex-1 items-start gap-3">{body}</div>}
        {diff.length > 0 && (
          <button onClick={() => setOpen(!open)} className="grid size-11 shrink-0 place-items-center rounded-full text-slate-400" aria-label="Değişiklikleri göster" aria-expanded={open}>
            <ChevronDown className={clsx('size-4 transition', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && (
        <div className="ml-13 mt-2 space-y-1 rounded-xl bg-slate-50 p-2.5 text-xs dark:bg-white/5">
          {diff.map((x) => (
            <div key={x.field} className="flex flex-wrap gap-x-2">
              <span className="font-semibold">{FIELD_LABEL[x.field] ?? x.field}:</span>
              <span className="text-slate-500 line-through">{x.from}</span>
              <span>→ {x.to}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ActivityList({ items, compact, empty = 'Henüz aktivite yok.' }: { items: Activity[]; compact?: boolean; empty?: string }) {
  if (!items.length) return <p className="p-4 text-sm text-slate-500">{empty}</p>
  return <div className="divide-y divide-slate-100 dark:divide-white/10">{items.map((a) => <ActivityRow key={a.id} a={a} compact={compact} />)}</div>
}
