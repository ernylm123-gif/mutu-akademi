import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePush } from '@/hooks/usePush'
import clsx from 'clsx'
import { Bell, BellRing, Settings2, CheckCheck, UserPlus, CalendarClock, Ban, UserX, AlertTriangle, Wallet, Megaphone, CalendarPlus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications, useDbMutation, rpc } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { relativeTime } from '@/lib/time'
import type { AppNotification } from '@/types/db'
import { Button, Card, EmptyState, Input, PageLoader, Textarea } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'

const ICONS: Record<string, { icon: typeof Bell; cls: string }> = {
  yeni_ogrenci: { icon: UserPlus, cls: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15' },
  ders_degisiklik: { icon: CalendarClock, cls: 'bg-sun-100 text-sun-700 dark:bg-sun-500/15 dark:text-sun-400' },
  ders_iptal: { icon: Ban, cls: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
  devamsizlik: { icon: UserX, cls: 'bg-accent-50 text-accent-600 dark:bg-accent-500/15' },
  dusuk_ders_hakki: { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15' },
  yaklasan_odeme: { icon: Wallet, cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15' },
  duyuru: { icon: Megaphone, cls: 'bg-brand-50 text-brand-600' },
  ders_yeni: { icon: CalendarPlus, cls: 'bg-emerald-50 text-emerald-600' },
  ders_tamamlandi: { icon: CheckCheck, cls: 'bg-emerald-50 text-emerald-600' },
  gecikmis_odeme: { icon: Wallet, cls: 'bg-red-50 text-red-600 dark:bg-red-500/15' },
}

export function NotificationsPage() {
  const { session, can } = useAuth()
  const navigate = useNavigate()
  const { data, isLoading } = useNotifications(session?.user.id)
  const push = usePush(session?.user.id)

  // Ödeme hatırlatmalarını kontrol et (sunucuda tekrar engellenir)
  useEffect(() => {
    if (can.payments) void rpc('check_payment_reminders', {}).catch(() => undefined)
  }, [can.payments])

  const markAll = useDbMutation(async () => {
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', session!.user.id).eq('is_read', false)
    if (error) throw error
  }, { success: 'Tümü okundu olarak işaretlendi', invalidate: ['notifications'] })

  const open = useDbMutation(async (n: AppNotification) => {
    if (!n.is_read) {
      const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
      if (error) throw error
    }
    return n
  }, { invalidate: ['notifications'], onSuccess: (n) => n.link && navigate(n.link) })

  if (isLoading) return <PageLoader />
  const unread = data?.filter((n) => !n.is_read).length ?? 0

  return (
    <div>
      <PageHeader title="Bildirimler" subtitle={unread ? `${unread} okunmamış` : 'Hepsi okundu'}
        actions={<>
          {unread > 0 && <Button variant="secondary" size="sm" icon={<CheckCheck className="size-4" />} loading={markAll.isPending} onClick={() => markAll.mutate(undefined)}>Tümünü okundu yap</Button>}
          <Link to="/bildirim-ayarlari" className="grid size-11 place-items-center rounded-2xl border border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300" aria-label="Bildirim ayarları"><Settings2 className="size-5" /></Link>
        </>} />
      {can.admin && <AnnouncementCard />}
      {!push.subscribed && (
        <Link to="/bildirim-ayarlari" className="card mb-4 flex items-center gap-3 p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15"><BellRing className="size-5" /></span>
          <span className="flex-1 text-sm"><b className="block">Ders hatırlatmalarını telefona alın</b><span className="text-slate-500">Dersten 1 saat önce, uygulama kapalıyken bile bildirim.</span></span>
          <span className="text-sm font-semibold text-brand-600">Aç</span>
        </Link>
      )}
      {(data ?? []).length === 0 ? (
        <Card><EmptyState icon={<Bell className="size-6" />} title="Bildirim yok" text="Yeni öğrenci, ders değişikliği, devamsızlık ve ödeme bildirimleri burada görünür." /></Card>
      ) : (
        <Card className="divide-y divide-slate-100 dark:divide-white/10">
          {data!.map((n) => {
            const ic = ICONS[n.type] ?? { icon: Bell, cls: 'bg-slate-100 text-slate-600' }
            return (
              <button key={n.id} onClick={() => open.mutate(n)} className={clsx('flex w-full items-start gap-3 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-white/5', !n.is_read && 'bg-brand-50/40 dark:bg-brand-500/5')}>
                <span className={clsx('grid size-10 shrink-0 place-items-center rounded-2xl', ic.cls)}><ic.icon className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={clsx('text-sm', n.is_read ? 'font-medium' : 'font-bold')}>{n.title}</span>
                    {!n.is_read && <span className="size-2 rounded-full bg-accent-500" />}
                  </span>
                  {n.body && <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-300">{n.body}</span>}
                  <span className="mt-1 block text-xs text-slate-400">{relativeTime(n.created_at)}</span>
                </span>
              </button>
            )
          })}
        </Card>
      )}
    </div>
  )
}

/** Yönetici duyurusu: tüm yetkili cihazlara ve herkese açık bildirim abonelerine gider */
export function AnnouncementCard() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const send = useDbMutation(async () => {
    await rpc('send_announcement', { p_title: title, p_body: body })
    setTitle(''); setBody('')
  }, { success: 'Duyuru gönderildi', invalidate: ['notifications'] })
  const ok = title.trim().length >= 3 && body.trim().length >= 3
  return (
    <Card className="mb-4 space-y-2.5 p-4">
      <p className="flex items-center gap-2 text-sm font-bold"><Megaphone className="size-4 text-brand-600" /> Duyuru gönder</p>
      <Input placeholder="Başlık" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea placeholder="Duyuru metni" maxLength={500} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      <Button className="w-full" disabled={!ok} loading={send.isPending} onClick={() => send.mutate(undefined)}>Gönder</Button>
    </Card>
  )
}
