import { useNavigate } from 'react-router-dom'
import { GraduationCap, Wallet, BarChart3, UserCog, Settings, BookOpen, ShieldCheck, LogOut, ChevronRight, Smartphone, Radio, BellRing, Upload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROLE_LABEL } from '@/lib/format'
import { Avatar, Card } from '@/components/ui'

export function MenuPage() {
  const { profile, can, signOut } = useAuth()
  const navigate = useNavigate()
  const items = [
    { to: '/aktiviteler', label: 'Canlı Aktiviteler', desc: 'Tüm cihazlardaki işlemler, anında', icon: Radio, show: true, tone: 'bg-emerald-50 text-emerald-600' },
    { to: '/bildirim-ayarlari', label: 'Bildirim ayarları', desc: 'Ders hatırlatmaları ve sessiz saatler', icon: BellRing, show: true, tone: 'bg-accent-50 text-accent-600' },
    { to: '/program-yukle', label: 'Program yükle', desc: "Excel, CSV veya PDF'ten ders programı", icon: Upload, show: can.lessons, tone: 'bg-brand-50 text-brand-600' },
    { to: '/egitmenler', label: 'Eğitmenler', desc: 'Eğitmen listesi ve programları', icon: GraduationCap, show: can.staff, tone: 'bg-brand-50 text-brand-600' },
    { to: '/odemeler', label: 'Ödemeler', desc: 'Tahsilat, taksit ve borçlar', icon: Wallet, show: can.payments, tone: 'bg-emerald-50 text-emerald-600' },
    { to: '/raporlar', label: 'Raporlar', desc: 'İstatistikler, PDF ve CSV', icon: BarChart3, show: can.staff, tone: 'bg-sun-100 text-sun-700' },
    { to: '/kurslar', label: 'Kurslar', desc: 'Kurs türleri ve varsayılanlar', icon: BookOpen, show: can.staff, tone: 'bg-accent-50 text-accent-600' },
    { to: '/kullanicilar', label: 'Cihazlar ve Kullanıcılar', desc: 'Davet kodu / QR, roller, erişim', icon: UserCog, show: can.admin, tone: 'bg-slate-100 text-slate-700' },
    { to: '/islem-gecmisi', label: 'İşlem Geçmişi', desc: 'Önemli değişikliklerin kaydı', icon: ShieldCheck, show: can.admin, tone: 'bg-slate-100 text-slate-700' },
    { to: '/ayarlar', label: 'Ayarlar', desc: 'Tema, profil ve kurallar', icon: Settings, show: true, tone: 'bg-slate-100 text-slate-700' },
    { to: '/kurulum', label: 'Telefona yükle', desc: 'Ana ekrana ekleme talimatı', icon: Smartphone, show: true, tone: 'bg-brand-50 text-brand-600' },
  ].filter((i) => i.show)
  return (
    <div>
      {profile && (
        <Card className="mb-4 flex items-center gap-3 p-4">
          <Avatar name={profile.full_name || profile.email} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{profile.full_name}</p>
            <p className="truncate text-sm text-slate-500">{profile.is_device ? 'Şifresiz bağlı cihaz' : profile.email} · {ROLE_LABEL[profile.role]}</p>
          </div>
        </Card>
      )}
      <Card className="divide-y divide-slate-100 dark:divide-white/10">
        {items.map((i) => (
          <button key={i.to} onClick={() => navigate(i.to)} className="flex min-h-[64px] w-full items-center gap-3 p-4 text-left">
            <span className={`grid size-11 place-items-center rounded-2xl dark:bg-white/10 dark:text-slate-200 ${i.tone}`}><i.icon className="size-5" /></span>
            <span className="flex-1"><span className="block font-semibold">{i.label}</span><span className="block text-xs text-slate-500">{i.desc}</span></span>
            <ChevronRight className="size-4 text-slate-300" />
          </button>
        ))}
        <button onClick={() => { if (!profile?.is_device || window.confirm('Bu cihazın bağlantısı kesilecek. Tekrar kullanmak için yeni bir davet kodu gerekir. Devam edilsin mi?')) void signOut() }} className="flex w-full items-center gap-3 p-4 text-left text-red-600">
          <span className="grid size-11 place-items-center rounded-2xl bg-red-50 dark:bg-red-500/15"><LogOut className="size-5" /></span>
          <span className="flex-1 font-semibold">{profile?.is_device ? 'Bu cihazın bağlantısını kes' : 'Çıkış yap'}</span>
        </button>
      </Card>
      <p className="mt-6 text-center text-xs text-slate-400">MUTU AKADEMİ · sürüm {__APP_VERSION__}</p>
    </div>
  )
}
