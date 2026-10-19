import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'

interface ToastItem { id: number; kind: 'success' | 'error' | 'info'; text: string }
interface ToastApi { success: (t: string) => void; error: (t: string) => void; info: (t: string) => void }

const Ctx = createContext<ToastApi | null>(null)
let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const push = useCallback(
    (kind: ToastItem['kind'], text: string) => {
      const id = ++seq
      setItems((xs) => [...xs.slice(-3), { id, kind, text }])
      setTimeout(() => remove(id), kind === 'error' ? 7000 : 3500)
    },
    [remove],
  )
  const api = useMemo<ToastApi>(
    () => ({ success: (t) => push('success', t), error: (t) => push('error', t), info: (t) => push('info', t) }),
    [push],
  )
  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4"
        style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`slide-up pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ring-1 ${
              t.kind === 'error'
                ? 'bg-red-600 text-white ring-red-700'
                : t.kind === 'success'
                  ? 'bg-ink-900 text-white ring-black/10 dark:bg-white dark:text-ink-900'
                  : 'bg-brand-600 text-white ring-brand-700'
            }`}
          >
            {t.kind === 'error' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => remove(t.id)} aria-label="Kapat" className="opacity-70 hover:opacity-100">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast must be used within ToastProvider')
  return c
}
