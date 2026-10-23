import { useEffect, useState } from 'react'
import { BellRing, BellOff, Send, Moon, ShieldAlert, CheckCircle2, Smartphone } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { usePush, PUSH_SUPPORT_TEXT, isStandalone } from '@/hooks/usePush'
import { useDbMutation, useMyDeliveries, useSettings, rpc } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { relativeTime } from '@/lib/time'
import type { NotificationPrefs } from '@/types/db'
import { Badge, Button, Card, Field, Input, SectionTitle, Toggle } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'

const GROUPS: { title: string; items: { key: keyof NotificationPrefs; label: string; important?: boolean }[] }[] = [
  { title: 'Ders', items: [
    { key: 'lesson_60', label: 'Dersten 1 saat önce' },
    { key: 'lesson_15', label: 'Dersten 15 dakika önce' },
    { key: 'lesson_start', label: 'Ders saati geldiğinde (yoklama hatırlatması)' },
    { key: 'lesson_end15', label: 'Dersin bitmesine 15 dakika kala' },
    { key: 'lesson_end', label: 'Ders süresi dolduğunda (tamamla hatırlatması)' },
    { key: 'ders_tamamlandi', label: 'Ders tamamlandığında' },
    { key: 'ders_iptal', label: 'Ders iptal edildiğinde', important: true },
    { key: 'ders_degisiklik', label: 'Ders ertelendiğinde / saati değiştiğinde', important: true },
    { key: 'ders_yeni', label: 'Yeni ders oluşturulduğunda / program içe aktarıldığında' },
  ] },
  { title: 'Öğrenci', items: [
    { key: 'yeni_ogrenci', label: 'Yeni öğrenci kaydı' },
    { key: 'dusuk_ders_hakki', label: 'Kalan ders hakkı azaldığında' },
    { key: 'devamsizlik', label: 'Öğrenci derse gelmediğinde' },
  ] },
  { title: 'Ödeme', items: [
    { key: 'yaklasan_odeme', label: 'Ödeme tarihi yaklaştığında' },
    { key: 'gecikmis_odeme', label: 'Ödeme geciktiğinde', important: true },
    { key: 'yeni_tahsilat', label: 'Yeni tahsilat kaydedildiğinde' },
  ] },
]

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' | 'brand' }> = {
  sent: { label: 'Gönderildi', tone: 'green' }, pending: { label: 'Bekliyor', tone: 'brand' }, claimed: { label: 'Gönderiliyor', tone: 'brand' },
  failed: { label: 'Tekrar denenecek', tone: 'amber' }, skipped: { label: 'Atlandı', tone: 'slate' }, expired: { label: 'Abonelik geçersiz', tone: 'red' },
}

export function NotificationSettings() {
  const { session, profile, can, refreshProfile } = useAuth()
  const push = usePush(session?.user.id)
  const toast = useToast()
  const { data: settings } = useSettings()
  const { data: deliveries } = useMyDeliveries(session?.user.id)
  const [prefs, setPrefs] = useState<NotificationPrefs>({})
  const [rules, setRules] = useState<NotificationPrefs>({})
  useEffect(() => { if (profile) setPrefs(profile.notification_prefs ?? {}) }, [profile])
  useEffect(() => { if (settings) setRules(settings.notify_rules ?? {}) }, [settings])

  const savePrefs = useDbMutation(async (p: NotificationPrefs) => {
    const { error } = await supabase.from('profiles').update({ notification_prefs: p }).eq('id', profile!.id)
    if (error) throw error
    await refreshProfile()
  }, { success: 'Bu cihazın bildirim tercihleri kaydedildi' })
  const saveRules = useDbMutation(async (r: NotificationPrefs) => {
    const { data, error } = await supabase.from('app_settings').update({ notify_rules: r }).eq('id', 1).select().maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Kurallar kaydedilemedi.')
  }, { success: 'Akademi bildirim kuralları kaydedildi', invalidate: ['settings'] })
  const test = useDbMutation(() => rpc<number>('send_test_push', {}), {
    success: (n) => (n > 0 ? 'Test bildirimi gönderiliyor; birkaç saniye içinde gelmeli' : 'Uygulama içi test bildirimi oluşturuldu (bu cihaz için push aboneliği yok)'),
    invalidate: ['deliveries', 'notifications'],
  })

  const set = (k: keyof NotificationPrefs, v: boolean | string) => {
    const next = { ...prefs, [k]: v }
    setPrefs(next)
    savePrefs.mutate(next)
  }

  const onEnable = async () => {
    try {
      await push.enable()
      toast.success('Bildirimler bu cihazda etkinleştirildi')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div>
      <SectionTitle>Anlık bildirimler (bu cihaz)</SectionTitle>
      <Card className="p-4">
        {!push.support.ok ? (
          <div className="flex gap-3 text-sm">
            <ShieldAlert className="size-5 shrink-0 text-amber-500" />
            <div>
              <p>{PUSH_SUPPORT_TEXT[push.support.reason]}</p>
              {push.support.reason === 'ios-not-installed' && <p className="mt-1 text-slate-500">Safari › Paylaş › Ana Ekrana Ekle, ardından simgeden açıp bu sayfaya dönün.</p>}
            </div>
          </div>
        ) : push.subscribed ? (
          <div className="flex flex-wrap items-center gap-3">
            <CheckCircle2 className="size-6 text-emerald-600" />
            <div className="flex-1 text-sm"><p className="font-semibold">Bildirimler açık</p><p className="text-slate-500">Uygulama kapalıyken ve telefon kilitliyken de bildirim gelir.</p></div>
            <Button size="sm" variant="secondary" icon={<Send className="size-4" />} loading={test.isPending} onClick={() => test.mutate(undefined)}>Test gönder</Button>
            <Button size="sm" variant="ghost" icon={<BellOff className="size-4" />} loading={push.busy} onClick={() => void push.disable()}>Kapat</Button>
          </div>
        ) : push.permission === 'denied' ? (
          <div className="flex gap-3 text-sm"><BellOff className="size-5 shrink-0 text-red-500" />
            <p>Bildirim izni bu cihazda reddedilmiş. {isStandalone() ? 'Telefon Ayarlar › Bildirimler › Mutu Akademi' : 'Tarayıcı site ayarları'} bölümünden izin verip bu sayfayı yeniden açın.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15"><BellRing className="size-5" /></span>
            <div className="flex-1 text-sm"><p className="font-semibold">Ders hatırlatmalarını telefona al</p><p className="text-slate-500">Dersten 1 saat önce, uygulama kapalıyken bile bildirim gelir.</p></div>
            <Button icon={<BellRing className="size-4" />} loading={push.busy} onClick={onEnable}>Bildirimleri etkinleştir</Button>
          </div>
        )}
      </Card>

      <SectionTitle>Bu cihaz hangi bildirimleri alsın?</SectionTitle>
      <Card className="divide-y divide-slate-100 p-1 dark:divide-white/10">
        {GROUPS.map((g) => (
          <div key={g.title} className="px-3 py-2">
            <p className="pb-1 pt-1 text-xs font-bold uppercase tracking-wide text-slate-500">{g.title}</p>
            {g.items.map((it) => (
              <Toggle key={it.key} checked={prefs[it.key] !== false} onChange={(v) => set(it.key, v)} label={it.label}
                description={rules[it.key] === false ? 'Yönetici bu bildirimi akademi genelinde kapattı' : it.important ? 'Önemli – sessiz saatlerde de gönderilir' : undefined} />
            ))}
          </div>
        ))}
      </Card>

      <SectionTitle>Sessiz saatler</SectionTitle>
      <Card className="p-4">
        <div className="mb-3 border-b border-slate-100 pb-3">
          <Toggle checked={!!prefs.grupla} onChange={(v) => set('grupla', v)} label="Bildirimleri grupla"
            description="Aynı türdeki ders bildirimleri kilit ekranında üst üste birikmez; en yenisi öncekinin yerini alır." />
        </div>
        <Toggle checked={!!prefs.quiet_enabled} onChange={(v) => set('quiet_enabled', v)} label="Sessiz saatleri kullan" description="Bu saatlerde rutin hatırlatmalar gönderilmez; ders iptali gibi önemli bildirimler gelmeye devam eder." />
        {prefs.quiet_enabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Başlangıç"><Input type="time" value={prefs.quiet_start ?? '22:00'} onChange={(e) => set('quiet_start', e.target.value)} /></Field>
            <Field label="Bitiş"><Input type="time" value={prefs.quiet_end ?? '08:00'} onChange={(e) => set('quiet_end', e.target.value)} /></Field>
          </div>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><Moon className="size-3.5" /> Saatler Europe/Istanbul saatine göredir.</p>
      </Card>

      {can.admin && (
        <>
          <SectionTitle>Akademi bildirim kuralları (yönetici)</SectionTitle>
          <Card className="divide-y divide-slate-100 p-1 dark:divide-white/10">
            {GROUPS.map((g) => (
              <div key={g.title} className="px-3 py-2">
                <p className="pb-1 pt-1 text-xs font-bold uppercase tracking-wide text-slate-500">{g.title}</p>
                {g.items.map((it) => (
                  <Toggle key={it.key} checked={rules[it.key] !== false} onChange={(v) => { const n = { ...rules, [it.key]: v }; setRules(n); saveRules.mutate(n) }} label={it.label} />
                ))}
              </div>
            ))}
            <p className="px-3 py-3 text-xs text-slate-500">Kapatılan bildirim hiçbir cihaza gönderilmez. Bildirimler role göre gider: ders hatırlatmaları yöneticiye, ders yetkili personele ve dersin eğitmenine; ödeme bildirimleri yöneticiye ve ödeme yetkili personele.</p>
          </Card>
        </>
      )}

      <SectionTitle>Son bildirim gönderimleri</SectionTitle>
      <Card className="divide-y divide-slate-100 dark:divide-white/10">
        {(deliveries ?? []).length === 0 && <p className="flex items-center gap-2 p-4 text-sm text-slate-500"><Smartphone className="size-4" />Bu cihaza henüz anlık bildirim gönderilmedi.</p>}
        {deliveries?.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-3.5 py-3 text-sm">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{d.title.replace('MUTU AKADEMİ – ', '')}</span><span className="block text-xs text-slate-400">{relativeTime(d.created_at)}{d.attempts > 1 ? ` · ${d.attempts}. deneme` : ''}</span></span>
            <Badge tone={STATUS[d.status]?.tone ?? 'slate'}>{STATUS[d.status]?.label ?? d.status}</Badge>
          </div>
        ))}
      </Card>
    </div>
  )
}
