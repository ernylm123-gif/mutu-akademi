import { Download } from 'lucide-react'
import { usePwaUpdate } from '@/hooks/usePwaUpdate'

/**
 * Service Worker'ı uygulama kökünde kaydeder (eşleştirme ekranı dahil her sayfada:
 * Android'de "Uygulamayı yükle" için gereklidir) ve yeni sürüm bandını gösterir.
 */
export function UpdateBanner() {
  const { needRefresh, applyUpdate, dismiss } = usePwaUpdate()
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
