# MUTU AKADEMİ – Öğrenci ve Ders Takip Uygulaması

Birden fazla yönetici, eğitmen ve personelin **aynı anda, farklı telefonlardan** kullanabildiği; gerçek zamanlı senkronize çalışan, mobil öncelikli bir PWA.

- Bir telefonda eklenen öğrenci, işaretlenen yoklama, değiştirilen ders saati veya girilen ödeme **sayfa yenilemeden** diğer tüm cihazlarda görünür.
- Google Play / App Store / APK gerekmez: tarayıcıdan açılıp **ana ekrana eklenir**.
- Uygulama adresi herkese açıktır; **veriler yalnızca yönetici tarafından yetkilendirilmiş cihazlara** açıktır (PostgreSQL Row Level Security). Şifre yoktur: cihazlar bir kez tek kullanımlık davet kodu / QR ile bağlanır.

## Teknolojiler

React 19 · TypeScript · Vite · Tailwind CSS 4 · TanStack Query · React Hook Form · Zod · Lucide · vite-plugin-pwa (Workbox) · Supabase (PostgreSQL, Auth, Realtime, Edge Functions) · Vercel

## Özellikler

| Modül | İçerik |
|---|---|
| Ana panel | Bugünkü dersler, aktif öğrenci, bekleyen/tamamlanan/gelmeyen, yaklaşan dersler, hızlı öğrenci & ders, son işlemler, dikkat gerektirenler |
| Öğrenciler | Ekleme/düzenleme, telefon & veli, kurs, eğitmen, haftalık program, toplam/tamamlanan/kalan hak, geçmiş, notlar, aktif/pasif |
| Takvim | Gün / hafta / ay, saat bazlı planlama, haftalık tekrar, erteleme, iptal, **çakışma kontrolü (veritabanı seviyesinde)**, sürükle-bırak taşıma |
| Yoklama | Katıldı / Katılmadı / İzinli (ayrı `attendance` tablosu) + ders durumu Planlandı / Tamamlandı / Ertelendi / İptal |
| Ödemeler | Kurs ücreti, ödenen, kalan, taksit planı, gecikmiş taksitler, ödeme geçmişi, yönetici düzeltmesi (iptal + yeni kayıt) |
| Eğitmenler | Ekleme, renk, hesap bağlama, haftalık program, verilen ders sayısı, notlar |
| Bildirimler | Yeni öğrenci, ders değişikliği, iptal, devamsızlık, düşük ders hakkı, yaklaşan/gecikmiş ödeme (rol bazlı) |
| Raporlar | Öğrenci sayıları, eğitmen dersleri, devamsızlık, ödeme durumu, günlük/haftalık/aylık; **PDF ve CSV** |
| Cihazlar ve Kullanıcılar | Şifresiz cihaz daveti (QR + kod), rol & izin, cihaz erişimini anında kaldırma, son görülme |
| İşlem geçmişi | Tüm önemli tablolar için değiştirilemez audit log |

### Ders hakkı kuralı (merkezi, sunucuda)

`private.refresh_student_usage()` her değişiklikte öğrencinin kullanılan hakkını **baştan sayar** (idempotent): aynı işlem iki kez uygulanamaz.

- Ders **Tamamlandı** + yoklama **Katıldı** → hak düşer
- **Katılmadı** → ayara göre (varsayılan: düşer) – *Ayarlar › Ders hakkı kuralları*
- **İzinli**, **İptal**, **Ertelendi** → düşmez

### Eşzamanlılık ve veri bütünlüğü

- `students`, `lessons`, `payments`, `instructors` tablolarında `version` sütunu → **optimistic locking**. Başka cihaz kaydı değiştirmişse işlem reddedilir ve kullanıcıya bildirilir.
- Yoklama/erteleme/iptal işlemleri `SELECT … FOR UPDATE` kullanan **transaction'lı RPC** fonksiyonlarıdır.
- Aynı eğitmen veya öğrenci için üst üste binen dersler **PostgreSQL EXCLUDE constraint** ile engellenir.
- Çevrimdışıyken değişiklik **kuyruğa alınmaz ve kaydedilmiş gösterilmez**; açık hata mesajı verilir. Bağlantı gelince tüm veriler sunucudan yeniden doğrulanır.

## Roller

| Rol | Yetki |
|---|---|
| **Yönetici (admin)** | Tüm sistem, kullanıcı yönetimi, ödeme düzeltme, silme, ayarlar, işlem geçmişi |
| **Eğitmen** | Yalnızca kendi dersleri, kendi derslerinin yoklaması, kendisine atanmış öğrenciler |
| **Personel** | Yöneticinin verdiği izinler: öğrenci kaydı, ders planlama, ödemeler |

Yetkiler istemcide değil **veritabanında RLS** ile uygulanır.

## Kurulum (geliştirici)

```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY değerlerini girin
npm run dev
```

### Supabase

1. `supabase/migrations/` altındaki SQL dosyalarını sırayla uygulayın (Supabase CLI: `supabase db push`).
2. Supabase › Authentication › Sign In / Providers › **Allow anonymous sign-ins** açık olmalı (şifresiz cihaz eşleştirme için). `admin-users` Edge Function'ı isteğe bağlıdır (yalnızca e-posta hesapları için).
3. İlk yönetici cihazı: aşağıdaki "İlk yönetici cihazı" bölümüne bakın.

> **Service role anahtarı hiçbir zaman frontend'e veya `.env` dosyasına konmaz.** Yalnızca Edge Function içinde Supabase tarafından otomatik sağlanır.

### Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | TypeScript kontrolü + production build |
| `npm test` | Birim ve entegrasyon testleri (Vitest) |
| `npm run test:db` | Tüm migration'ları gerçek Postgres motorunda (PGlite) uygular, 36 RLS / iş kuralı testi |
| `npm run test:e2e` | Uçtan uca testler (Playwright). Giriş gerektiren testler için `E2E_EMAIL`, `E2E_PASSWORD` |

## Şifresiz kullanım: cihaz eşleştirme

Uygulama **şifre veya giriş ekranı istemez**. Her telefon/tablet/bilgisayar **bir kez** tek kullanımlık davet kodu (veya QR) ile yetkilendirilir; sonrasında her açılışta doğrudan ana panele girer.

Nasıl çalışır:

1. Yönetici *Menü › Cihazlar ve Kullanıcılar › Cihaz davet et* ile rol (Yönetici / Eğitmen / Personel) ve süre seçer.
2. Ekranda **QR kod** ve `XXXXX-XXXXX` biçiminde **10 karakterlik kod** çıkar (50 bit rastgelelik). Veritabanında yalnızca kodun **SHA-256 özeti** saklanır.
3. Yeni cihaz QR'ı okutur veya kodu girer → cihaz Supabase **anonim oturumu** açar (tek başına hiçbir veriye erişemez) ve `redeem_device_invite` veritabanı fonksiyonu kodu **atomik olarak tek seferlik** tüketip cihazı rolüyle yetkilendirir. 10 hatalı denemeden sonra o oturum kilitlenir.
4. Oturum cihazda kalıcıdır ve otomatik yenilenir. Ana ekrana eklenen PWA, Safari/Chrome'un 7 günlük depolama silme kuralından muaftır.
5. Yönetici bir cihazın erişimini *Cihaz yetkili* anahtarını kapatarak **anında** kaldırabilir (RLS hemen reddeder) veya cihazı tamamen silebilir.

> **iPhone/iPad notu:** Ana ekrana eklenen uygulama Safari'den ayrı bir depolama kullanır. Bu yüzden eşleştirme, ana ekrana eklenen uygulamanın **içinde** yapılmalıdır. QR Safari'de açılırsa uygulama bunu algılar ve önce "Ana Ekrana Ekle" talimatını, ardından girilecek kodu gösterir.

### İlk yönetici cihazı

İlk kurulumda veritabanına tek kullanımlık bir **yönetici daveti** eklenir. Yöneticinin ilk telefonu bu kodla bağlanır; diğer tüm cihazlar uygulama içinden davet edilir. Yeni bir ilk-yönetici daveti gerekirse (ör. tüm yönetici cihazları kaybolduysa) Supabase SQL Editor'da:

```sql
-- KOD: kendi oluşturduğunuz 10 karakterlik kod (0-9 ve I, L, O, U hariç büyük harfler)
insert into public.device_invites (code_hash, label, role, expires_at)
values (encode(extensions.digest('KODUNUZ', 'sha256'), 'hex'), 'Yönetici', 'admin', now() + interval '1 day');
```

### E-posta ile giriş (isteğe bağlı)

Klasik e-posta/şifre girişi yedek olarak durur (*Cihazı bağla* ekranının altındaki küçük bağlantı). Yönetici *E-posta hesabı* ile hesap açabilir. Günlük kullanımda gerekmez.

## Telefona yükleme

- **iPhone / iPad:** Safari ile açın → Paylaş → **Ana Ekrana Ekle**
- **Android:** Chrome ile açın → ⋮ → **Uygulamayı yükle** / **Ana ekrana ekle**

Yeni sürüm yayınlandığında uygulama kendini günceller ("Yeni sürüm hazır – Güncelle" bandı; arka plandaysa otomatik).

## Güvenlik notları

- RLS tüm tablolarda açık; `anon` rolünün tablo erişimi kaldırıldı.
- Yardımcı yetki fonksiyonları `SECURITY DEFINER` + boş `search_path`.
- Yönetici olmayanlar kendi rol/onay/izin alanlarını değiştiremez (tetikleyici).
- Sistemde her zaman en az bir aktif yönetici kalır.
- CSP, HSTS, X-Frame-Options, nosniff başlıkları (`vercel.json`).
- React çıktıları otomatik kaçışlanır (XSS); `dangerouslySetInnerHTML` kullanılmaz.
- Supabase oturumu Bearer token ile çalışır (çerez yok → CSRF riski yok). PKCE akışı.
- Tüm sorgular parametrelidir (PostgREST / RPC) → SQL injection yok.
- CSV dışa aktarmada formül enjeksiyonu engellenir.
- Ödeme kayıtları silinmez; düzeltme iptal + yeni kayıt şeklinde yapılır ve audit log'a düşer.
