import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Loader2, X } from 'lucide-react'
import type { Tone } from '@/lib/format'

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  block?: boolean
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 rounded-2xl font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        size === 'sm' && 'h-9 px-3 text-sm',
        size === 'md' && 'h-11 px-4 text-[15px]',
        size === 'lg' && 'h-13 px-5 text-base',
        block && 'w-full',
        variant === 'primary' && 'bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700',
        variant === 'accent' && 'bg-accent-500 text-white shadow-sm shadow-accent-500/20 hover:bg-accent-600',
        variant === 'secondary' && 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

// ---------------------------------------------------------------------------
// Form alanları
// ---------------------------------------------------------------------------
const fieldBase =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[16px] text-slate-900 placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100'

export function Field({ label, error, hint, children, className }: { label?: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>}
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(fieldBase, 'h-11', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(fieldBase, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}
    >
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(fieldBase, 'min-h-[88px] py-2.5', className)} {...rest} />
})

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 rounded-xl py-2 text-left">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
      <span className={clsx('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-white/20')}>
        <span className={clsx('absolute top-0.5 size-6 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Görsel bileşenler
// ---------------------------------------------------------------------------
const toneClass: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  red: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/15',
  accent: 'bg-accent-50 text-accent-700 ring-accent-100 dark:bg-accent-500/15 dark:text-accent-400 dark:ring-accent-500/30',
  cyan: 'bg-cyan-50 text-cyan-800 ring-cyan-200',
}
export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', toneClass[tone], className)}>{children}</span>
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('card', className)} {...rest}>{children}</div>
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-brand-600', className)} />
}

/** Veri yüklenirken içerik iskeleti (boş dönen yükleme simgesi yerine) */
export function PageLoader({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 py-2" aria-busy="true" aria-label="Yükleniyor">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card flex items-center gap-3 p-3.5">
          <span className="skeleton h-11 w-1.5" />
          <span className="flex-1 space-y-2">
            <span className="skeleton block h-3.5 w-1/3" />
            <span className="skeleton block h-3 w-2/3" />
          </span>
          <span className="skeleton h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = (error as { message?: string })?.message ?? 'Veriler yüklenemedi.'
  return (
    <Card className="border-red-200 p-4 text-sm text-red-700 dark:border-red-500/30 dark:text-red-300">
      <p className="font-semibold">Veriler yüklenemedi</p>
      <p className="mt-1 opacity-80">{msg}</p>
      {onRetry && <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>Tekrar dene</Button>}
    </Card>
  )
}

export function Avatar({ name, color, size = 40 }: { name: string; color?: string; size?: number }) {
  const ini = name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toLocaleUpperCase('tr-TR') ?? '').join('')
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: color ?? 'linear-gradient(135deg,#29a8df,#1689bf)' }}
      aria-hidden
    >
      {ini}
    </span>
  )
}

export function Stat({ label, value, icon, tone = 'brand', onClick }: { label: string; value: ReactNode; icon: ReactNode; tone?: 'brand' | 'accent' | 'sun' | 'ink' | 'green' | 'red'; onClick?: () => void }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
    accent: 'bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400',
    sun: 'bg-sun-100 text-sun-700 dark:bg-sun-500/15 dark:text-sun-400',
    ink: 'bg-slate-100 text-slate-800 dark:bg-white/10 dark:text-slate-200',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    red: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  }
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp onClick={onClick} className={clsx('card flex items-center gap-3 p-4 text-left', onClick && 'transition hover:-translate-y-0.5')}>
      <span className={clsx('grid size-11 shrink-0 place-items-center rounded-2xl', tones[tone])}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-tight tabular-nums">{value}</span>
        <span className="block truncate text-xs font-medium text-slate-500">{label}</span>
      </span>
    </Comp>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex items-center justify-between gap-2 first:mt-0">
      <h2 className="text-base font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx('h-8 rounded-lg px-3 text-sm font-semibold transition', value === o.value ? 'bg-white text-slate-900 shadow-sm dark:bg-white/20 dark:text-white' : 'text-slate-500')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sheet / Modal (mobilde alttan açılan panel, masaüstünde ortalanmış pencere)
// ---------------------------------------------------------------------------
const DIRTY_MSG = 'Kaydedilmemiş değişiklikler var. Çıkmak istediğinize emin misiniz?'

const openSheets = new Set<string>()

export function Sheet({ open, onClose, title, children, footer, wide, dirty }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; dirty?: boolean }) {
  const onCloseRef = useRef(onClose)
  const dirtyRef = useRef(dirty)
  onCloseRef.current = onClose
  dirtyRef.current = dirty

  const requestClose = () => {
    if (dirtyRef.current && !window.confirm(DIRTY_MSG)) return
    onCloseRef.current()
  }

  useEffect(() => {
    if (!open) return
    // Android geri tuşu / tarayıcı geri hareketi paneli kapatsın
    const id = Math.random().toString(36).slice(2)
    let closing = false
    // Bir panel kapanıp hemen başkası açılıyorsa (ör. detay → düzenle) aynı geçmiş kaydı devralınır;
    // aksi halde kapanan panelin gecikmeli "geri" adımı yeni paneli de kapatırdı.
    const top = window.history.state?.mutuSheet as string | undefined
    if (top && !openSheets.has(top)) window.history.replaceState({ ...(window.history.state ?? {}), mutuSheet: id }, '')
    else window.history.pushState({ ...(window.history.state ?? {}), mutuSheet: id }, '')
    openSheets.add(id)
    const onPop = () => {
      if (closing) return
      if (dirtyRef.current && !window.confirm(DIRTY_MSG)) {
        window.history.pushState({ ...(window.history.state ?? {}), mutuSheet: id }, '')
        return
      }
      closing = true
      onCloseRef.current()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && requestClose()
    window.addEventListener('popstate', onPop)
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      openSheets.delete(id)
      // Aynı anda açılan yeni panel kaydı devralmadıysa geçmişten çık
      setTimeout(() => { if (!closing && window.history.state?.mutuSheet === id) window.history.back() }, 0)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fade-in absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" onClick={requestClose} />
      <div className={clsx('slide-up relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-2xl dark:bg-[#121821] sm:rounded-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden dark:bg-white/20" />
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 sm:pt-5">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={requestClose} className="grid size-11 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Kapat">
            <X className="size-5" />
          </button>
        </div>
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4"
          onFocus={(e) => {
            // iOS/Android: klavye açılınca odaktaki alanı görünür tut
            const el = e.target as HTMLElement
            if (el.matches('input, textarea, select')) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
          }}
        >
          {children}
        </div>
        {footer && <div className="safe-bottom border-t border-slate-100 px-5 py-3 dark:border-white/10">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmSheet({ open, onClose, onConfirm, title, text, confirmLabel = 'Onayla', danger, loading, children }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; text?: string; confirmLabel?: string; danger?: boolean; loading?: boolean; children?: ReactNode
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>Vazgeç</Button>
          <Button variant={danger ? 'danger' : 'primary'} block loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      }
    >
      {text && <p className="text-sm text-slate-600 dark:text-slate-300">{text}</p>}
      {children}
    </Sheet>
  )
}
