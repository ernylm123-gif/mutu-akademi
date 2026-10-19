import { useEffect, useState } from 'react'

/** Yaklaşan derse geri sayım (dakikada bir güncellenir) */
export function Countdown({ to, prefix = '' }: { to: string; prefix?: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const diff = Math.round((new Date(to).getTime() - now) / 60000)
  if (diff <= 0) return <span>{prefix}şimdi</span>
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return <span>{prefix}{h > 0 ? `${h} sa ${m} dk sonra` : `${m} dk sonra`}</span>
}
