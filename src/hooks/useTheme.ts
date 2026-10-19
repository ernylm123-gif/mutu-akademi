import { useEffect, useState } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'mutu-theme'

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* depolama kapalı olabilir */ }
  return 'system'
}

export function applyTheme(pref: ThemePref = read()) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0b0f14' : '#ffffff'))
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read)
  useEffect(() => {
    applyTheme(pref)
    try { localStorage.setItem(KEY, pref) } catch { /* yoksay */ }
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [pref])
  return { pref, setPref }
}
