import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { matchesSearch } from '@/lib/format'

export interface SearchOption { value: string; label: string; hint?: string }

/** Hızlı aramalı seçim kutusu (öğrenci, eğitmen, kurs). Tek veya çoklu seçim. */
export function SearchSelect({ options, value, onChange, placeholder = 'Seçin', multiple, emptyLabel, ariaLabel }: {
  options: SearchOption[]
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  multiple?: boolean
  emptyLabel?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    setTimeout(() => input.current?.focus(), 0)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])
  const list = useMemo(() => options.filter((o) => matchesSearch([o.label, o.hint], q)).slice(0, 60), [options, q])
  const selected = value.map((v) => options.find((o) => o.value === v)).filter((o): o is SearchOption => !!o)
  const pick = (v: string) => {
    if (multiple) onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
    else { onChange(v ? [v] : []); setOpen(false) }
    setQ('')
  }

  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 w-full flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-[15px] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15">
        {selected.length === 0 && <span className="text-slate-400">{placeholder}</span>}
        {multiple
          ? selected.map((o) => (
              <span key={o.value} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1 text-sm font-semibold text-brand-700">
                {o.label}
                <span role="button" tabIndex={-1} aria-label={`${o.label} kaldır`} onClick={(e) => { e.stopPropagation(); pick(o.value) }} className="grid size-5 place-items-center rounded-full hover:bg-brand-100"><X className="size-3" /></span>
              </span>
            ))
          : selected[0] && <span className="font-medium">{selected[0].label}</span>}
        <ChevronDown className="ml-auto size-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3">
            <Search className="size-4 text-slate-400" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara…" className="h-11 flex-1 bg-transparent text-[15px] outline-none"
              onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); pick(list[0].value) } if (e.key === 'Escape') setOpen(false) }} />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {!multiple && emptyLabel && (
              <button type="button" onClick={() => pick('')} className="flex min-h-11 w-full items-center px-3 text-left text-sm text-slate-500 hover:bg-slate-50">{emptyLabel}</button>
            )}
            {list.length === 0 && <p className="px-3 py-3 text-sm text-slate-400">Sonuç yok</p>}
            {list.map((o) => {
              const on = value.includes(o.value)
              return (
                <button key={o.value} type="button" onClick={() => pick(o.value)}
                  className={clsx('flex min-h-11 w-full items-center gap-2 px-3 text-left text-[15px] hover:bg-slate-50', on && 'bg-brand-50/60')}>
                  <span className="flex-1">{o.label}{o.hint && <span className="ml-1.5 text-xs text-slate-400">{o.hint}</span>}</span>
                  {on && <Check className="size-4 text-brand-600" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
