import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import {
  Bell, CalendarDays, Home, Menu as MenuIcon, Users, GraduationCap, Wallet, BarChart3, UserCog, Settings,
  BookOpen, ShieldCheck, LogOut, WifiOff, RefreshCw, Smartphone, Radio,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications, rpc } from '@/lib/api'
import { useRealtimeSync, useSyncStatus } from '@/hooks/useRealtimeSync'
import { ROLE_LABEL } from '@/lib/format'
import { Avatar, Button } from '@/components/ui'
import { NotificationPrompt } from '@/components/NotificationPrompt'
import { Logo } from './Logo'

export { Logo }

function useUnreadCount() {
  const { session } = useAuth()
  const { data } = useNotifications(session?.user.id)
  return data?.filter((n) => !n.is_read).length ?? 0
}

export function AppShell() {
  const { session, profile, can, signOut } = useAuth()
  useRealtimeSync(session?.user.id)
  const navigate = useNavigate()
  useEffect(() => {
    if (session?.user.id) void rpc('touch_last_seen', {}).catch(() => undefined)
  }, [session?.user.id])
  // Bildirime dokunulunca açık uygulamada ilgili ekrana git
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'NAVIGATE' && typeof e.data.url === 'string') {
        const u = new URL(e.data.url, window.location.origin)
        if (u.origin === window.location.origin) navigate(u.pathname + u.search)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [navigate])
  const unread = useUnreadCount()
  const loc = useLocation()

  const main = [
    { to: '/', label: 'Ana Sayfa', icon: Home, end: true },
    { to: '/takvim', label: 'Takvim', icon: CalendarDays },
    { to: '/ogrenciler', label: 'Öğrenciler', icon: Users },
    { to: '/bildirimler', label: 'Bildirimler', icon: Bell, badge: unread },
  ]
  const more = [
    { to: '/aktiviteler', label: 'Canlı Aktiviteler', icon: Radio, show: true },
    { to: '/egitmenler', label: 'Eğitmenler', icon: GraduationCap, show: can.staff },
    { to: '/odemeler', label: 'Ödemeler', icon: Wallet, show: can.payments },
    { to: '/raporlar', label: 'Raporlar', icon: BarChart3, show: can.staff },
    { to: '/kurslar', label: 'Kurslar', icon: BookOpen, show: can.staff },
    { to: '/kullanicilar', label: 'Cihazlar ve Kullanıcılar', icon: UserCog, show: can.admin },
    { to: '/islem-gecmisi', label: 'İşlem Geçmişi', icon: ShieldCheck, show: can.admin },
    { to: '/ayarlar', label: 'Ayarlar', icon: Settings, show: true },
    { to: '/kurulum', label: 'Telefona Yükle', icon: Smartphone, show: true },
  ].filter((x) => x.show)

  return (
    <div className="min-h-dvh lg:pl-72">
      {/* Masaüstü kenar menü */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-slate-200/70 bg-white px-4 py-5 lg:flex dark:border-white/10 dark:bg-[#0e131a]">
        <div className="px-2"><Logo size={42} /></div>
        <div className="cmyk-bar mx-2 mt-4 h-1 rounded-full opacity-80" />
        <nav className="mt-5 flex-1 space-y-1 overflow-y-auto">
          {[...main, ...more].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                clsx(
                  'flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition',
                  isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5',
                )
              }
            >
              <item.icon className="size-5" />
              <span className="flex-1">{item.label}</span>
              {'badge' in item && item.badge ? (
                <span className="rounded-full bg-accent-500 px-2 py-0.5 text-xs font-bold text-white">{item.badge}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        {profile && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-white/5">
            <Avatar name={profile.full_name || profile.email} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{profile.full_name || profile.email}</p>
              <p className="text-xs text-slate-500">{ROLE_LABEL[profile.role]}</p>
            </div>
            <button onClick={() => { if (!profile.is_device || window.confirm('Bu cihazın bağlantısı kesilecek. Tekrar kullanmak için yeni bir davet kodu gerekir. Devam edilsin mi?')) void signOut() }} className="grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10" aria-label="Çıkış yap" title="Çıkış yap">
              <LogOut className="size-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Mobil üst çubuk */}
      <header className="safe-top sticky top-0 z-20 border-b border-slate-200/60 bg-white/85 backdrop-blur-xl lg:hidden dark:border-white/10 dark:bg-[#0b0f14]/85">
        <div className="flex h-14 items-center justify-between px-4">
          <button onClick={() => navigate('/')} aria-label="Ana sayfa"><Logo size={32} /></button>
          <SyncDot />
        </div>
      </header>

      <ConnectionBanner />
      <NotificationPrompt />

      <main key={loc.pathname} className="fade-in pb-nav mx-auto w-full max-w-6xl px-4 pt-4 lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mb-4 hidden justify-end lg:flex"><SyncDot /></div>
        <Outlet />
      </main>

      {/* Mobil alt menü */}
      <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/92 backdrop-blur-xl lg:hidden dark:border-white/10 dark:bg-[#0e131a]/92">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {[...main, { to: '/menu', label: 'Menü', icon: MenuIcon }].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                clsx('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500')
              }
            >
              {({ isActive }) => (
                <>
                  <span className={clsx('grid h-8 w-14 place-items-center rounded-full transition', isActive && 'bg-brand-50 dark:bg-brand-500/15')}>
                    <item.icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  {item.label}
                  {'badge' in item && item.badge ? (
                    <span className="absolute right-[18%] top-2 min-w-5 rounded-full bg-accent-500 px-1.5 text-center text-[10px] font-bold leading-5 text-white">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

function SyncDot() {
  const { status } = useSyncStatus()
  const map = {
    live: { c: 'bg-emerald-500', t: 'Canlı' },
    connecting: { c: 'bg-amber-400', t: 'Bağlanıyor' },
    reconnecting: { c: 'bg-amber-400', t: 'Yeniden bağlanıyor' },
    offline: { c: 'bg-red-500', t: 'Çevrimdışı' },
  }[status]
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300" title="Gerçek zamanlı senkronizasyon durumu">
      <span className={clsx('size-2 rounded-full', map.c, status === 'live' && 'animate-pulse')} />
      {map.t}
    </span>
  )
}

function ConnectionBanner() {
  const { status } = useSyncStatus()
  if (status === 'live' || status === 'connecting') return null
  return (
    <div className={clsx('no-print sticky top-0 z-40 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white', status === 'offline' ? 'bg-red-600' : 'bg-amber-500')} role="status">
      {status === 'offline' ? <WifiOff className="size-4" /> : <RefreshCw className="size-4 animate-spin" />}
      {status === 'offline'
        ? 'İnternet bağlantısı yok. Yapılan değişiklikler kaydedilmez.'
        : 'Bağlantı yeniden kuruluyor… Veriler bağlantı gelince doğrulanacak.'}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: string; actions?: React.ReactNode; back?: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <button onClick={() => navigate(-1)} className="mb-1 text-sm font-medium text-brand-600">‹ Geri</button>
        )}
        <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function MenuButtonLink({ to, children }: { to: string; children: React.ReactNode }) {
  const navigate = useNavigate()
  return <Button variant="secondary" onClick={() => navigate(to)}>{children}</Button>
}
