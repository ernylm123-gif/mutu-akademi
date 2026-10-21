import { useState } from 'react'
import { BellRing, Share, PlusSquare } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { usePush, type PushMode } from '@/hooks/usePush'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'

const KEY = 'mutu-notif-prompt-later'

function dismissedRecently() {
  try {
    const t = Number(localStorage.getItem(KEY) ?? 0)
    return Date.now() - t < 3 * 24 * 3600_000 // "Daha sonra" → 3 gün tekrar sorma
  } catch {
    return false
  }
}

/**
 * İlk açılışta gösterilen bildirim bilgilendirme ekranı.
 * Tarayıcı izin penceresi YALNIZCA "Bildirimleri Etkinleştir"e dokunulunca açılır.
 */
export function NotificationPrompt({ mode = 'member' }: { mode?: PushMode }) {
  const { session } = useAuth()
  const push = usePush(session?.user.id, mode)
  const toast = useToast()
  const [hidden, setHidden] = useState(dismissedRecently)

  const iosNotInstalled = !push.support.ok && push.support.reason === 'ios-not-installed'
  if (hidden || !push.checked || push.subscribed || push.permission === 'denied' || !(push.support.ok || iosNotInstalled)) return null

  const later = () => {
    try { localStorage.setItem(KEY, String(Date.now())) } catch { /* yoksay */ }
    setHidden(true)
  }
  const enable = async () => {
    try {
      await push.enable()
      toast.success('Bildirimler etkinleştirildi')
      setHidden(true)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="fixed inset-0 z-[62] flex items-end justify-center bg-slate-950/40 backdrop-blur-[2px] sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Ders Bildirimlerini Etkinleştir">
      <div className="slide-up safe-bottom w-full rounded-t-3xl bg-white p-6 shadow-2xl dark:bg-[#121821] sm:max-w-md sm:rounded-3xl">
        <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-brand-50 text-brand-600 dark:bg-brand-500/15">
          <BellRing className="size-8" />
        </div>
        <h2 className="mt-4 text-center text-xl font-extrabold tracking-tight">Ders Bildirimlerini Etkinleştir</h2>
        <p className="mt-2 text-center text-[15px] text-slate-600 dark:text-slate-300">
          Ders başlangıçlarını, program değişikliklerini ve önemli akademi duyurularını zamanında takip edebilmek için bildirimlere izin verin.
        </p>
        <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-center text-sm text-slate-500 dark:bg-white/5">
          Bildirimler, yaklaşan derslerin hatırlatılması ve günlük ders programının düzenli takibi için önerilir. Ders başlamadan 1 saat önce hatırlatma alırsınız.
        </p>

        {iosNotInstalled ? (
          <>
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-semibold">iPhone'da önce uygulamayı ana ekrana ekleyin:</p>
              <p className="mt-1">Safari'de <Share className="inline size-4" /> <b>Paylaş</b> → <PlusSquare className="inline size-4" /> <b>Ana Ekrana Ekle</b>. Ardından ana ekrandaki Mutu Akademi simgesinden açın; bildirim izni orada istenecek.</p>
            </div>
            <Button block size="lg" variant="secondary" className="mt-4" onClick={later}>Anladım</Button>
          </>
        ) : (
          <div className="mt-5 grid gap-2">
            <Button block size="lg" icon={<BellRing className="size-5" />} loading={push.busy} onClick={enable}>Bildirimleri Etkinleştir</Button>
            <Button block size="lg" variant="ghost" onClick={later}>Daha Sonra</Button>
          </div>
        )}
      </div>
    </div>
  )
}
