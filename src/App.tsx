import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { PublicSchedulePage } from '@/pages/PublicSchedule'
import { useAuth } from '@/hooks/useAuth'
import { supabaseConfigured } from '@/lib/supabase'
import { clearLinkKey, readLinkKey } from '@/lib/pairing'
import { DeviceGate } from '@/pages/DeviceGate'
import { AppErrorBoundary, BootErrorScreen, BootLoader } from '@/components/BootRecovery'
import { AppShell } from '@/components/layout/AppShell'
import { UpdateBanner } from '@/components/layout/UpdateBanner'
import { PageLoader } from '@/components/ui'
import { LoginPage, ForgotPasswordPage, UpdatePasswordPage, PendingApprovalPage, MissingConfigPage } from '@/pages/Auth'
import { DashboardPage } from '@/pages/Dashboard'

const CalendarPage = lazy(() => import('@/pages/Calendar').then((m) => ({ default: m.CalendarPage })))
const StudentsPage = lazy(() => import('@/pages/Students').then((m) => ({ default: m.StudentsPage })))
const StudentDetailPage = lazy(() => import('@/pages/StudentDetail').then((m) => ({ default: m.StudentDetailPage })))
const NotificationsPage = lazy(() => import('@/pages/Notifications').then((m) => ({ default: m.NotificationsPage })))
const MenuPage = lazy(() => import('@/pages/Menu').then((m) => ({ default: m.MenuPage })))
const InstructorsPage = lazy(() => import('@/pages/Instructors').then((m) => ({ default: m.InstructorsPage })))
const InstructorDetailPage = lazy(() => import('@/pages/Instructors').then((m) => ({ default: m.InstructorDetailPage })))
const PaymentsPage = lazy(() => import('@/pages/Payments').then((m) => ({ default: m.PaymentsPage })))
const ReportsPage = lazy(() => import('@/pages/Reports').then((m) => ({ default: m.ReportsPage })))
const UsersPage = lazy(() => import('@/pages/Users').then((m) => ({ default: m.UsersPage })))
const SettingsPage = lazy(() => import('@/pages/Misc').then((m) => ({ default: m.SettingsPage })))
const CoursesPage = lazy(() => import('@/pages/Misc').then((m) => ({ default: m.CoursesPage })))
const AuditPage = lazy(() => import('@/pages/Misc').then((m) => ({ default: m.AuditPage })))
const LessonDetailPage = lazy(() => import('@/pages/LessonDetail').then((m) => ({ default: m.LessonDetailPage })))
const ActivitiesPage = lazy(() => import('@/pages/Activities').then((m) => ({ default: m.ActivitiesPage })))
const ScheduleImportPage = lazy(() => import('@/pages/ScheduleImport').then((m) => ({ default: m.ScheduleImportPage })))
const NotificationSettingsPage = lazy(() => import('@/pages/Misc').then((m) => ({ default: m.NotificationSettingsPage })))
const InstallPage = lazy(() => import('@/pages/Misc').then((m) => ({ default: m.InstallPage })))

function Guard({ allow, children }: { allow: boolean; children: ReactNode }) {
  return allow ? <>{children}</> : <Navigate to="/" replace />
}

function Protected() {
  const { profile, loading, bootError, retry, can } = useAuth()
  const [linkKey] = useState(readLinkKey)
  const authorized = !!profile?.approved && profile.is_active
  // Yetkili cihaz özel bağlantıyı tekrar açarsa (ör. iOS ana ekran başlangıç adresi) anahtarı adres çubuğundan sil
  useEffect(() => {
    if (authorized && linkKey) clearLinkKey()
  }, [authorized, linkKey])

  const location = useLocation()
  const wantsAdmin = location.pathname.startsWith('/yonetim')

  // Açılış ASLA oturum beklemez: yetkili olmayan / henüz doğrulanmamış her cihaz anında ortak programı görür.
  if (authorized) {
    // yetkili cihaz: tam yönetim uygulaması (aşağıda)
  } else if (linkKey) {
    return <DeviceGate linkKey={linkKey} />
  } else if (wantsAdmin) {
    if (loading) return <BootLoader onRetry={() => void retry()} />
    if (bootError) return <BootErrorScreen kind={bootError.kind} message={bootError.message} onRetry={() => void retry()} />
    if (profile?.approved && !profile.is_active) return <PendingApprovalPage />
    return <DeviceGate linkKey={null} />
  } else {
    return <PublicSchedulePage />
  }
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="takvim" element={<CalendarPage />} />
          <Route path="ogrenciler" element={<StudentsPage />} />
          <Route path="ogrenciler/:id" element={<StudentDetailPage />} />
          <Route path="bildirimler" element={<NotificationsPage />} />
          <Route path="bildirim-ayarlari" element={<NotificationSettingsPage />} />
          <Route path="ders/:id" element={<LessonDetailPage />} />
          <Route path="aktiviteler" element={<ActivitiesPage />} />
          <Route path="program-yukle" element={<Guard allow={can.lessons}><ScheduleImportPage /></Guard>} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="egitmenler" element={<Guard allow={can.staff}><InstructorsPage /></Guard>} />
          <Route path="egitmenler/:id" element={<Guard allow={can.staff}><InstructorDetailPage /></Guard>} />
          <Route path="odemeler" element={<Guard allow={can.payments}><PaymentsPage /></Guard>} />
          <Route path="raporlar" element={<Guard allow={can.staff}><ReportsPage /></Guard>} />
          <Route path="kurslar" element={<Guard allow={can.staff}><CoursesPage /></Guard>} />
          <Route path="kullanicilar" element={<Guard allow={can.admin}><UsersPage /></Guard>} />
          <Route path="islem-gecmisi" element={<Guard allow={can.admin}><AuditPage /></Guard>} />
          <Route path="ayarlar" element={<SettingsPage />} />
          <Route path="kurulum" element={<InstallPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="grid min-h-dvh place-items-center"><PageLoader /></div>
  return session ? <Navigate to="/" replace /> : <>{children}</>
}

export default function App() {
  if (!supabaseConfigured) return <MissingConfigPage />
  return (
    <AppErrorBoundary>
    <BrowserRouter>
      <UpdateBanner />
      <Routes>
        <Route path="/giris" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/kayit" element={<Navigate to="/" replace />} />
        <Route path="/sifremi-unuttum" element={<ForgotPasswordPage />} />
        <Route path="/sifre-yenile" element={<UpdatePasswordPage />} />
        <Route path="/*" element={<Protected />} />
      </Routes>
    </BrowserRouter>
    </AppErrorBoundary>
  )
}
