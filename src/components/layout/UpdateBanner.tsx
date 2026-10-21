import { useEffect } from 'react'
import { Download, CheckCircle2 } from 'lucide-react'
import { usePwaUpdate } from '@/hooks/usePwaUpdate'

/**
 * Service Worker'ı uygulama kökünde kaydeder (her sayfada; Android kurulumu için gerekli),
 * yeni sürümü sunucudan kontrol eder ve güncelleme bilgisini gösterir.
 */
export function UpdateBanner() {
  const { needRefresh, applyUpdate, dismiss, justUpdated, dismissUpdated } = usePwaUpdate()
  useEffect(() => {
    if (!justUpdated) return
    const t = setTimeout(dismissUpdated, 4000)
    return () => clearTimeout(t)
  }, [justUpdated, dismissUpdated])

  if (justUpdated) {
    return (
      <div className="no-print safe-top fixed inset-x-0 top-0 z-[65] flex justify-center px-4 pt-2" role="status">
        <div className="slide-up flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-lg ring-1 ring-slate-200">
          <CheckCircle2 className="size-4 text-emerald-600" /> Mutu Akademi güncellendi
        </div>
      </div>
    )
  }
  if (!needRefresh) return null
  return (
    <div className="no-print safe-top fixed inset-x-0 top-0 z-[65] flex items-center justify-between gap-3 bg-brand-600 px-4 py-2.5 text-sm text-white shadow-lg">
      <span className="flex items-center gap-2"><Download className="size-4" /> Yeni sürüm hazır.</span>
      <span className="flex gap-2">
        <button onClick={dismiss} className="min-h-[36px] rounded-lg px-2 opacity-80">Sonra</button>
        <button onClick={applyUpdate} className="min-h-[36px] rounded-lg bg-white px-3 font-semibold text-brand-700">Güncelle</button>
      </span>
    </div>
  )
}
