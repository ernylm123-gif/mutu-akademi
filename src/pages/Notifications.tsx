import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Bell, CheckCheck, UserPlus, CalendarClock, Ban, UserX, AlertTriangle, Wallet } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications, useDbMutation, rpc } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { relativeTime } from '@/lib/time'
import type { AppNotification } from '@/types/db'
import { Button, Card, EmptyState, PageLoader } from '@/components/ui'
import { PageHeader } from '@/components/layout/AppShell'

const ICONS: Record<string, { icon: typeof Bell; cls: string }> = {
  yeni_ogrenci: { icon: UserPlus, cls: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15' },
  ders_degisiklik: { icon: CalendarClock, cls: 'bg-sun-100 text-sun-700 dark:bg-sun-500/15 dark:text-sun-400' },
  ders_iptal: { icon: Ban, cls: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
  devamsizlik: { icon: UserX, cls: 'bg-accent-50 text-accent-600 dark:bg-accent-500/15' },
  dusuk_ders_hakki: { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15' },
  yaklasan_odeme: { icon: Wallet, cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15' },
  gecikmis_odeme: { icon: Wallet, cls: 'bg-red-50 text-red-600 dark:bg-red-500/15' },
}

export function NotificationsPage() {
  const { session, can } = useAuth()
  const navigate = useNavigate()
  const { data, isLoading } = useNotifications(session?.user.id)

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
        actions={unread > 0 && <Button variant="secondary" size="sm" icon={<CheckCheck className="size-4" />} loading={markAll.isPending} onClick={() => markAll.mutate(undefined)}>Tümünü okundu yap</Button>} />
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
