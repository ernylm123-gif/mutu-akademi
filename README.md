# MUTU AKADEMİ – Öğrenci ve Ders Takip Uygulaması

Birden fazla yönetici, eğitmen ve personelin **aynı anda, farklı telefonlardan** kullanabildiği; gerçek zamanlı senkronize çalışan, mobil öncelikli bir PWA.

- Bir telefonda eklenen öğrenci, işaretlenen yoklama, değiştirilen ders saati veya girilen ödeme **sayfa yenilemeden** diğer tüm cihazlarda görünür.
- Google Play / App Store / APK gerekmez: tarayıcıdan açılıp **ana ekrana eklenir**.
- Uygulama adresi herkese açıktır; **veriler yalnızca giriş yapmış ve onaylanmış kullanıcılara** açıktır (PostgreSQL Row Level Security).

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
| Kullanıcılar | Hesap oluşturma, rol & izin, onay bekleyen talepler, pasifleştirme, şifre belirleme |
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
2. `supabase/functions/admin-users` Edge Function'ını yayınlayın: `supabase functions deploy admin-users`.
3. İlk yönetici: aşağıdaki "İlk yönetici hesabı" bölümüne bakın.

> **Service role anahtarı hiçbir zaman frontend'e veya `.env` dosyasına konmaz.** Yalnızca Edge Function içinde Supabase tarafından otomatik sağlanır.

### Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | TypeScript kontrolü + production build |
| `npm test` | Birim ve entegrasyon testleri (Vitest) |
| `npm run test:e2e` | Uçtan uca testler (Playwright). Giriş gerektiren testler için `E2E_EMAIL`, `E2E_PASSWORD` |

## İlk yönetici hesabı

İlk yönetici e-posta adresi veritabanındaki `private.bootstrap_admins` tablosunda tanımlıdır (API üzerinden erişilemez).

1. Uygulama adresinde **Hesap talebi oluştur**'a tıklayın.
2. Bu e-posta adresi ve **kendi belirlediğiniz güçlü bir şifre** ile kayıt olun.
3. E-postanıza gelen doğrulama bağlantısına tıklayın.
4. Giriş yapın: hesabınız otomatik olarak **Yönetici** olur.

Farklı bir e-posta kullanmak için Supabase SQL Editor'da:

```sql
insert into private.bootstrap_admins (email) values ('yeni@adres.com');
```

## Personele hesap verme

- **Yöntem 1 (önerilen):** *Menü › Kullanıcılar › Kullanıcı oluştur* → ad, e-posta, geçici şifre ve rol. Hesap anında aktiftir.
- **Yöntem 2:** Kişi *Hesap talebi oluştur* ile kayıt olur → *Kullanıcılar › Onay bekleyen talepler* → **Onayla**.
- Eğitmen hesabını *Eğitmenler › (eğitmen) › Düzenle › Kullanıcı hesabı* alanından eğitmen kaydına bağlayın.

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
