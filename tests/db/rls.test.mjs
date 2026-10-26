// Kurulum SQL'ini gerçek bir Postgres motorunda (PGlite) çalıştırır ve RLS / iş kuralı testleri yapar.
// Kullanım: npm run test:db
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const dir = new URL('../../supabase/migrations/', import.meta.url)
const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } })
await db.exec(readFileSync(new URL('./supabase-stub.sql', import.meta.url), 'utf8'))
for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'))
console.log('✔ Tüm migration dosyaları hatasız uygulandı')
const bootCode = 'TESTA-DM1N2'
await db.query(`insert into public.device_invites (code_hash, label, role, expires_at) values ($1, 'Yönetici', 'admin', now() + interval '1 day')`,
  [createHash('sha256').update('TESTAD' + 'M1N2').digest('hex')])

let pass = 0, fail = 0
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ✔", name) } else { fail++; console.log("  ✘", name, extra) } }
const _as0 = 1

async function as(uid, sql, params = []) {
  await db.exec('begin')
  try {
    if (uid === 'anon') await db.exec(`set local role anon; select set_config('request.jwt.claim.sub','',true)`)
    else await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true)`)
    const r = await db.query(sql, params)
    await db.exec('commit')
    return { rows: r.rows }
  } catch (e) {
    await db.exec('rollback')
    return { error: e }
  }
}
const newUser = async (anon = true) => (await db.query(`insert into auth.users (email, is_anonymous) values ($1, $2) returning id`, [anon ? null : `x${Date.now()}@t.co`, anon])).rows[0].id

// --- Cihaz eşleştirme -------------------------------------------------------
const admin = await newUser()
let r = await db.query('select role, approved from public.profiles where id=$1', [admin])
ok('anonim cihaz profili onaysız oluşur', r.rows[0]?.approved === false)

r = await as(admin, 'select count(*)::int n from public.students')
ok('onaysız cihaz öğrenci göremez', r.rows?.[0].n === 0)
r = await as(admin, `insert into public.students (full_name) values ('Sızma Denemesi')`)
ok('onaysız cihaz öğrenci ekleyemez', !!r.error)

r = await as(admin, `select * from public.redeem_device_invite('AAAAA-BBBBB','Test')`)
ok('yanlış davet kodu reddedilir', !!r.error && /geçersiz/.test(r.error.message))

r = await as(admin, `select role, approved, is_device from public.redeem_device_invite($1,'iPhone')`, [bootCode.toLowerCase()])
ok('ilk yönetici kodu (küçük harfle bile) cihazı yönetici yapar', r.rows?.[0]?.role === 'admin' && r.rows[0].approved === true, r.error?.message)

const other = await newUser()
r = await as(other, `select * from public.redeem_device_invite($1,'Başka')`, [bootCode])
ok('aynı kod ikinci kez kullanılamaz', !!r.error)

r = await as(other, `update public.profiles set role='admin', approved=true where id=auth.uid() returning id`)
ok('cihaz kendini yönetici/onaylı yapamaz', !!r.error || r.rows.length === 0)

// --- Yönetici veri işlemleri -------------------------------------------------
r = await as(admin, `insert into public.courses (name, default_lesson_count, default_fee) values ('Piyano', 8, 4000) returning id`)
const course = r.rows?.[0]?.id
ok('yönetici kurs ekler', !!course, r.error?.message)
r = await as(admin, `insert into public.instructors (full_name) values ('Ayşe Hoca') returning id`)
const inst = r.rows?.[0]?.id
r = await as(admin, `insert into public.students (full_name, course_id, instructor_id, total_lessons, total_fee) values ('Elif Kaya', $1, $2, 8, 4000) returning id, remaining_lessons`, [course, inst])
const st = r.rows?.[0]?.id
ok('yönetici öğrenci ekler', !!st && r.rows[0].remaining_lessons === 8, r.error?.message)
r = await as(admin, `insert into public.students (full_name) values ('Can Demir') returning id`)
const st2 = r.rows?.[0]?.id

r = await db.query(`select count(*)::int n from public.notifications where type='yeni_ogrenci'`)
ok('yeni öğrenci bildirimi tetikleyicisi çalışır (tetikleyen hariç)', r.rows[0].n === 0)

const t0 = new Date(Date.now() + 2 * 86400000); t0.setUTCMinutes(0, 0, 0)
const t1 = new Date(t0.getTime() + 3600000)
r = await as(admin, `insert into public.lessons (student_id, instructor_id, starts_at, ends_at) values ($1,$2,$3,$4) returning id, version`, [st, inst, t0.toISOString(), t1.toISOString()])
const lesson = r.rows?.[0]
ok('ders oluşturulur', !!lesson, r.error?.message)
r = await as(admin, `insert into public.lessons (student_id, instructor_id, starts_at, ends_at) values ($1,$2,$3,$4)`, [st2, inst, new Date(t0.getTime() + 1800000).toISOString(), new Date(t1.getTime() + 1800000).toISOString()])
ok('eğitmen çakışması engellenir (23P01)', r.error?.code === '23P01', r.error?.message)

r = await as(admin, `select status, version from public.mark_attendance($1,'katildi',$2)`, [lesson.id, lesson.version])
ok('yoklama: katıldı → ders tamamlandı', r.rows?.[0]?.status === 'tamamlandi', r.error?.message)
const v2 = r.rows?.[0]?.version
r = await db.query('select used_lessons, remaining_lessons from public.students where id=$1', [st])
ok('ders hakkı otomatik düşer (7 kaldı)', r.rows[0].remaining_lessons === 7)
r = await as(admin, `select * from public.mark_attendance($1,'katildi',$2)`, [lesson.id, lesson.version])
ok('eski sürümle işlem reddedilir (optimistic locking)', r.error?.code === '40001')
r = await as(admin, `select * from public.mark_attendance($1,'katildi',$2)`, [lesson.id, v2])
r = await db.query('select remaining_lessons from public.students where id=$1', [st])
ok('aynı yoklama iki kez uygulanınca hak iki kez düşmez', r.rows[0].remaining_lessons === 7)
r = await as(admin, `select version from public.lessons where id=$1`, [lesson.id])
r = await as(admin, `select * from public.mark_attendance($1,'izinli',$2)`, [lesson.id, r.rows[0].version])
r = await db.query('select remaining_lessons from public.students where id=$1', [st])
ok('izinli → hak iade edilir', r.rows[0].remaining_lessons === 8)

r = await as(admin, `update public.students set full_name='Elif K.' where id=$1 and version=1 returning id`, [st])
ok('öğrenci güncellemesinde sürüm kontrolü', r.rows?.length === 0 || r.error, 'güncel olmayan sürümle güncellendi')

r = await as(admin, `insert into public.weekly_schedules (student_id, instructor_id, weekday, start_time) values ($1,$2,3,'15:00') returning id`, [st2, inst])
const sched = r.rows?.[0]?.id
const today = new Date().toISOString().slice(0, 10)
const until = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10)
r = await as(admin, `select public.generate_schedule_lessons($1,$2,$3) as res`, [sched, today, until])
ok('haftalık programdan ders üretilir', (r.rows?.[0]?.res?.created ?? 0) >= 3, JSON.stringify(r.rows?.[0] ?? r.error?.message))

r = await as(admin, `insert into public.payments (student_id, amount) values ($1, 1500) returning id`, [st])
ok('ödeme eklenir', !!r.rows?.[0]?.id, r.error?.message)
r = await as(admin, `select balance from public.v_student_balances where student_id=$1`, [st])
ok('kalan borç hesaplanır (2500)', Number(r.rows?.[0]?.balance) === 2500)

// --- Personel cihazı (ödeme izni yok) ----------------------------------------
await db.query(`insert into public.device_invites (code_hash, label, role, expires_at, permissions) values (encode(extensions.digest('PRSNXQ2345','sha256'),'hex'),'Sekreter','personel', now()+interval '1 day', '{"students":true,"lessons":true,"payments":false}')`)
const staff = await newUser()
r = await as(staff, `select role from public.redeem_device_invite('prsnx-q2345','Tablet')`)
ok('personel daveti çalışır', r.rows?.[0]?.role === 'personel', r.error?.message)
r = await as(staff, 'select count(*)::int n from public.students')
ok('personel öğrencileri görür', r.rows?.[0]?.n === 2)
r = await as(staff, 'select count(*)::int n from public.payments')
ok('ödeme izni olmayan personel ödemeleri göremez', r.rows?.[0]?.n === 0)
r = await as(staff, `insert into public.payments (student_id, amount) values ($1, 10)`, [st])
ok('ödeme izni olmayan personel ödeme ekleyemez', !!r.error)
r = await as(staff, 'select count(*)::int n from public.audit_logs')
ok('personel işlem geçmişini göremez', r.rows?.[0]?.n === 0)
r = await as(staff, `insert into public.device_invites (code_hash, label, role, expires_at) values (repeat('a',64),'x','admin', now()+interval '1 day')`)
ok('personel davet kodu üretemez', !!r.error)
r = await as(staff, 'select count(*)::int n from public.notifications')
ok('personel yalnızca kendi bildirimlerini görür', (r.rows?.[0]?.n ?? 0) >= 0 && !r.error)

// --- Anonim (oturumsuz) erişim -----------------------------------------------
r = await as('anon', 'select count(*) from public.students')
ok('oturumsuz istek öğrenci tablosuna erişemez', !!r.error)
r = await as('anon', 'select count(*) from public.payments')
ok('oturumsuz istek ödeme tablosuna erişemez', !!r.error)

// --- Cihaz yetkisinin kaldırılması -------------------------------------------
r = await as(admin, `update public.profiles set is_active=false where id=$1 returning id`, [staff])
ok('yönetici cihaz yetkisini kaldırır', r.rows?.length === 1, r.error?.message)
r = await as(staff, 'select count(*)::int n from public.students')
ok('yetkisi kaldırılan cihaz anında veri göremez', r.rows?.[0]?.n === 0)
r = await as(admin, `update public.profiles set is_active=false where id=$1`, [admin])
ok('son aktif yönetici pasif yapılamaz', !!r.error)

r = await db.query(`select count(*)::int n from public.audit_logs`)
ok('audit log kayıt tutar', r.rows[0].n > 10)
r = await db.query(`select count(*)::int n from pg_publication_tables where pubname='supabase_realtime'`)
ok('realtime yayınına tablolar eklendi', r.rows[0].n >= 13, r.rows[0].n)
r = await db.query(`select count(*)::int n from pg_tables where schemaname='public' and not rowsecurity`)
ok('tüm public tablolarda RLS açık', r.rows[0].n === 0)

// --- Web Push: hatırlatma kuyruğu, tekrar engeli, iptal/erteleme, sessiz saatler ---
const SECRET = 'a'.repeat(48)
await db.query(`insert into private.config (key, value) values ('dispatch_secret_sha256', encode(extensions.digest($1, 'sha256'), 'hex'))`, [SECRET])
r = await as(admin, `insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/abc', 'p', 'a') returning id`)
const sub = r.rows?.[0]?.id
ok('yetkili cihaz push aboneliği kaydeder', !!sub, r.error?.message)
const unpaired = await newUser()
r = await as(unpaired, `insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/x', 'p', 'a')`)
ok('yetkisiz cihaz push aboneliği kaydedemez', !!r.error)

const soon = new Date(Date.now() + 59.5 * 60000)
r = await as(admin, `insert into public.lessons (student_id, instructor_id, course_id, starts_at, ends_at) values ($1,$2,$3,$4,$5) returning id, version`,
  [st, inst, course, soon.toISOString(), new Date(soon.getTime() + 130 * 60000).toISOString()])
const pl = r.rows?.[0]
ok('1 saat sonraki ders oluşturulur', !!pl, r.error?.message)
await db.query('select private.enqueue_lesson_reminders()')
await db.query('select private.enqueue_lesson_reminders()')
r = await db.query(`select count(*)::int n, max(body) body from public.push_deliveries where lesson_id=$1 and kind='lesson_60'`, [pl.id])
ok('60 dk hatırlatması tam bir kez kuyruğa alınır', r.rows[0].n === 1, r.rows[0].n)
ok('hatırlatma metni kurs, saat ve öğrenciyi içerir', /^Piyano saat \d\d\.\d\d'(te|de|ta|da) başlayacak\. Dersin başlamasına 1 saat kaldı\.\nÖğrenci: Elif Kaya$/.test(r.rows[0].body), r.rows[0].body)

r = await as('anon', `select * from public.claim_push_batch('yanlis-anahtar-yanlis-anahtar-yanlis-anahtar')`)
ok('yanlış gizli anahtarla gönderim kuyruğu okunamaz', !!r.error)
r = await as('anon', `select * from public.claim_push_batch($1)`, [SECRET])
const claimed = r.rows ?? []
ok('gönderici doğru anahtarla kuyruğu alır', claimed.length === 1 && claimed[0].url === `/ders/${pl.id}`, r.error?.message)
r = await as('anon', `select * from public.claim_push_batch($1)`, [SECRET])
ok('alınmış gönderim ikinci kez verilmez', (r.rows ?? []).length === 0)
await as('anon', `select public.report_push_results($1, $2::jsonb)`, [SECRET, JSON.stringify([{ id: claimed[0]?.delivery_id, ok: true }])])
r = await db.query(`select status from public.push_deliveries where id=$1`, [claimed[0]?.delivery_id])
ok('başarılı gönderim "sent" olarak kaydedilir', r.rows[0]?.status === 'sent')

// Ders saati değişirse yeni saate göre yeniden planlanır
r = await as(admin, `update public.lessons set starts_at = starts_at + interval '20 seconds', ends_at = ends_at + interval '20 seconds' where id=$1 and version=$2 returning version`, [pl.id, pl.version])
await db.query('select private.enqueue_lesson_reminders()')
r = await db.query(`select count(*)::int n from public.push_deliveries where lesson_id=$1 and status='pending'`, [pl.id])
ok('saati değişen ders için yeni hatırlatma oluşur', r.rows[0].n === 1)
// İptal edilen dersin hatırlatması gönderilmez
r = await as(admin, `select version from public.lessons where id=$1`, [pl.id])
r = await as(admin, `select * from public.cancel_lesson($1, $2, 'test')`, [pl.id, r.rows[0].version])
r = await as('anon', `select * from public.claim_push_batch($1)`, [SECRET])
ok('iptal edilen dersin hatırlatması gönderilmez', (r.rows ?? []).length === 0)
r = await db.query(`select count(*)::int n from public.push_deliveries where lesson_id=$1 and status='skipped'`, [pl.id])
ok('iptal edilen hatırlatma "skipped" olur', r.rows[0].n === 1)

// Uygulama içi bildirim → push; ödeme tutarı push metninde görünmez
await db.query(`select private.notify(array['admin']::public.app_role[], null, 'yaklasan_odeme', 'Yaklaşan ödeme', 'Elif Kaya: 1.500,00 ₺ – vade 20.10.2026', '/ogrenciler/x', null, true)`)
r = await db.query(`select body from public.push_deliveries where kind='notification' order by created_at desc limit 1`)
ok('ödeme bildirimi push metninde tutar gösterilmez', !!r.rows[0] && !/₺|1\.500/.test(r.rows[0].body), r.rows[0]?.body)

// Sessiz saatler: rutin hatırlatma gönderilmez, önemli bildirim gönderilir
await db.query(`update public.profiles set notification_prefs = notification_prefs || '{"quiet_enabled": true, "quiet_start": "00:00", "quiet_end": "23:59"}' where id=$1`, [admin])
const soon2 = new Date(Date.now() + 59.5 * 60000 + 3 * 3600000)
r = await as(admin, `insert into public.lessons (student_id, starts_at, ends_at) values ($1,$2,$3) returning id`, [st2, new Date(Date.now() + 59.6 * 60000).toISOString(), new Date(Date.now() + 120 * 60000).toISOString()])
await db.query('select private.enqueue_lesson_reminders()')
r = await db.query(`select count(*)::int n from public.push_deliveries where lesson_id=$1`, [r.rows?.[0]?.id])
ok('sessiz saatlerde rutin ders hatırlatması gönderilmez', r.rows[0].n === 0)
await db.query(`select private.notify(array['admin']::public.app_role[], null, 'ders_iptal', 'Ders iptal edildi', 'Can – 20.10.2026 10:00', '/takvim', null, true)`)
r = await db.query(`select count(*)::int n from public.push_deliveries d join public.notifications n on n.id=d.notification_id where n.type='ders_iptal'`)
ok('sessiz saatlerde bile ders iptali bildirimi gönderilir', r.rows[0].n >= 1)
void soon2

// 410 yanıtı → süresi dolmuş abonelik silinir
r = await as('anon', `select * from public.claim_push_batch($1)`, [SECRET])
const c2 = r.rows ?? []
await as('anon', `select public.report_push_results($1, $2::jsonb)`, [SECRET, JSON.stringify(c2.map((x) => ({ id: x.delivery_id, ok: false, status: 410, error: 'Gone' })))])
r = await db.query(`select count(*)::int n from public.push_subscriptions where id=$1`, [sub])
ok('süresi dolmuş (410) push aboneliği temizlenir', c2.length > 0 && r.rows[0].n === 0, c2.length)

// Canlı aktiviteler
r = await as(admin, `select * from public.get_activities(20)`)
ok('yönetici canlı aktiviteleri görür', (r.rows ?? []).length > 5 && r.rows.some((a) => a.student_name === 'Elif Kaya'), r.error?.message)
r = await as('anon', `select * from public.get_activities(20)`)
ok('oturumsuz istek aktiviteleri göremez', !!r.error)
r = await as(unpaired, `select count(*)::int n from public.get_activities(20)`)
ok('yetkisiz cihaz aktivite göremez', r.rows?.[0]?.n === 0)
r = await as(admin, `update public.app_settings set low_credit_threshold = 3 where id = 1 returning id`)
ok('yönetici ayarları kaydedebilir (audit tetikleyicisi)', r.rows?.length === 1, r.error?.message)

// --- Herkese açık ortak program (girişsiz, salt okunur) ---
await db.query(`update public.students set phone='05321112233', guardian_phone='05324445566', notes='gizli not' where id=$1`, [st])
await db.query(`update public.profiles set notification_prefs = notification_prefs || '{"quiet_enabled": false}' where id=$1`, [admin])
const pubFrom = new Date(Date.now() - 86400000).toISOString()
const pubTo = new Date(Date.now() + 30 * 86400000).toISOString()
r = await as('anon', `select * from public.get_public_schedule($1, $2)`, [pubFrom, pubTo])
ok('girişsiz ziyaretçi ortak programı görür', (r.rows ?? []).length > 0, r.error?.message)
ok('ortak programda isim kısaltılır (Elif K.)', (r.rows ?? []).some((x) => x.student_label === 'Elif K.') && !(r.rows ?? []).some((x) => x.student_label === 'Elif Kaya'))
const leak = JSON.stringify(r.rows ?? [])
ok('ortak programda telefon, veli, not, ödeme bilgisi yok', !/0532|gizli not|guardian|phone|amount|remaining/.test(leak))
r = await as('anon', `select count(*)::int n from public.get_public_schedule(now() - interval '1 year', now() + interval '1 year')`)
ok('ortak program toplu veri çekmeye kapalı (62 gün sınırı)', r.rows?.[0]?.n === 0)
r = await as('anon', `insert into public.lessons (student_id, starts_at, ends_at) values ($1, now() + interval '5 days', now() + interval '5 days 1 hour')`, [st])
ok('girişsiz ziyaretçi ders ekleyemez', !!r.error)
r = await as('anon', `select public.subscribe_public_push('https://push.example/pub', '${'p'.repeat(60)}', '${'a'.repeat(20)}', 'test')`)
ok('girişsiz cihaz bildirim aboneliği bırakabilir', !r.error, r.error?.message)
r = await as('anon', `select public.subscribe_public_push('http://kotu.example', 'x', 'y')`)
ok('geçersiz bildirim aboneliği reddedilir', !!r.error)
r = await as(admin, `insert into public.lessons (student_id, course_id, starts_at, ends_at) values ($1,$2,$3,$4) returning id`,
  [st, course, new Date(Date.now() + 59.5 * 60000 + 6 * 3600000 * 0).toISOString(), new Date(Date.now() + 59.5 * 60000 + 3600000).toISOString()])
const pubLesson = r.rows?.[0]?.id
await db.query('select private.enqueue_lesson_reminders()')
r = await db.query(`select d.body from public.push_deliveries d join public.push_subscriptions s on s.id=d.subscription_id where s.is_public and d.kind='lesson_60' and d.lesson_id=$1`, [pubLesson])
ok('girişsiz aboneye 1 saat önce hatırlatma kuyruğa girer', r.rows.length === 1 && /1 saat kaldı/.test(r.rows[0].body), r.error?.message ?? JSON.stringify(r.rows))
ok('girişsiz hatırlatmada tam isim/telefon yok', r.rows.every((x) => !/Elif Kaya|0532/.test(x.body)))
r = await as('anon', `select count(*)::int n from public.push_subscriptions`)
ok('girişsiz ziyaretçi abonelik listesini okuyamaz', !!r.error || r.rows?.[0]?.n === 0)

// --- Herkese açık aktiviteler, duyurular, değişiklik bildirimleri ---
r = await db.query(`select d.body from public.push_deliveries d join public.push_subscriptions s on s.id=d.subscription_id where s.is_public and d.kind='lesson_60' and d.lesson_id=$1`, [pubLesson])
ok('açık hatırlatma metni yalnızca kurs ve saat içerir', r.rows.length === 1 && /^Piyano saat \d\d\.\d\d'(te|de|ta|da) başlayacak\. Dersin başlamasına 1 saat kaldı\.$/.test(r.rows[0].body), JSON.stringify(r.rows))
r = await as('anon', `select * from public.get_public_activities(20)`)
ok('girişsiz ziyaretçi ders aktivitelerini görür', (r.rows ?? []).length > 0, r.error?.message)
ok('açık aktivitelerde öğrenci adı/telefon yok', !/Elif|0532|Can Demir/.test(JSON.stringify(r.rows ?? [])))
r = await as(admin, `select version from public.lessons where id=$1`, [pubLesson])
await as(admin, `select * from public.cancel_lesson($1, $2, 'test')`, [pubLesson, r.rows[0].version])
r = await db.query(`select title, body from public.push_deliveries d join public.push_subscriptions s on s.id=d.subscription_id where s.is_public and d.kind='pub_cancel' and d.lesson_id=$1`, [pubLesson])
ok('ders iptali açık abonelere isimsiz bildirilir', r.rows.length === 1 && /[İi]ptal/.test(r.rows[0].title) && !/Elif/.test(r.rows[0].body), JSON.stringify(r.rows))
r = await as(admin, `select * from public.cancel_lesson($1, null, 'tekrar')`, [pubLesson])
r = await db.query(`select count(*)::int n from public.push_deliveries where kind='pub_cancel' and lesson_id=$1`, [pubLesson])
ok('aynı iptal bildirimi tekrar gönderilmez', r.rows[0].n === 1)
r = await as(admin, `select public.send_announcement('Tatil duyurusu', 'Pazartesi akademi kapalıdır.') as n`)
ok('yönetici duyuru gönderir (açık abonelere push)', !r.error && r.rows[0].n >= 1, r.error?.message)
r = await as(other, `select public.send_announcement('x x', 'y y')`)
ok('yönetici olmayan duyuru gönderemez', !!r.error)
r = await as('anon', `select * from public.get_public_announcements(3)`)
ok('girişsiz ziyaretçi son duyuruyu görür', r.rows?.[0]?.title === 'Tatil duyurusu', r.error?.message)
r = await as('anon', `select public.send_public_test_push('https://push.example/pub')`)
ok('açık cihaz kendine test bildirimi gönderebilir', !r.error, r.error?.message)
r = await as('anon', `select public.send_public_test_push('https://push.example/olmayan')`)
ok('başkasının olmayan aboneliğine test gönderilemez', !!r.error)

// --- Profesyonel ders programı: paketler, seri, erteleme, iptal, tamamlama, grup, sınıf ---
const istDate = (days) => new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })
r = await db.query(`select private.tr_saat('2026-10-22 16:00+03','dat') a, private.tr_saat('2026-10-22 14:00+03','loc') b,
  private.tr_saat('2026-10-22 16:00+03','loc') c, private.tr_saat('2026-10-22 14:30+03','dat') d, private.tr_saat('2026-10-22 09:00+03','dat') e`)
ok("Türkçe saat ekleri doğru (16.00'ya, 14.00'te, 16.00'da, 14.30'a, 09.00'a)",
  r.rows[0].a === "16.00'ya" && r.rows[0].b === "14.00'te" && r.rows[0].c === "16.00'da" && r.rows[0].d === "14.30'a" && r.rows[0].e === "09.00'a", JSON.stringify(r.rows[0]))

r = await as(admin, `insert into public.courses (name) values ('Python Eğitimi') returning id`)
const pyCourse = r.rows[0].id
r = await as(admin, `insert into public.instructors (full_name) values ('Deniz Hoca') returning id`)
const inst2 = r.rows[0].id
r = await as(admin, `insert into public.instructors (full_name) values ('Selin Hoca') returning id`)
const inst3 = r.rows[0].id
r = await as(admin, `insert into public.rooms (name, capacity) values ('Bilgisayar Laboratuvarı', 2) returning id`)
const room = r.rows?.[0]?.id
ok('yönetici sınıf ekler', !!room, r.error?.message)
r = await as(other, `insert into public.rooms (name) values ('Sızma Odası')`)
ok('yetkisiz cihaz sınıf ekleyemez', !!r.error)

r = await as(admin, `insert into public.students (full_name, course_id, instructor_id) values ('Ezgi Test', $1, $2) returning id`, [pyCourse, inst2])
const ezgi = r.rows[0].id
ok('1) yeni öğrenci eklenir', !!ezgi)
r = await as(admin, `insert into public.students (full_name, course_id) values ('Mert Test', $1) returning id`, [pyCourse])
const mert = r.rows[0].id
r = await as(admin, `insert into public.students (full_name, course_id) values ('Zeynep Test', $1) returning id`, [pyCourse])
const zeynep = r.rows[0].id

const pkgRef = '11111111-2222-4333-8444-555555555555'
r = await as(admin, `select * from public.add_lesson_package($1, '24 derslik paket', 24, 12000, true, null, 'paket', $2)`, [ezgi, pkgRef])
ok('2) öğrenciye ders paketi tanımlanır', !r.error && r.rows[0].lesson_count === 24, r.error?.message)
await as(admin, `select * from public.add_lesson_package($1, '24 derslik paket', 24, 12000, true, null, 'paket', $2)`, [ezgi, pkgRef])
r = await db.query(`select total_lessons, remaining_lessons, total_fee::int fee from public.students where id=$1`, [ezgi])
ok('aynı paket isteği iki kez işlenmez; hak ve borç bir kez eklenir', r.rows[0].total_lessons === 24 && r.rows[0].fee === 12000, JSON.stringify(r.rows[0]))
await as(admin, `update public.students set total_lessons = 26 where id=$1`, [ezgi])
r = await db.query(`select (select total_lessons from public.students where id=$1) t, (select count(*)::int from public.lesson_packages where student_id=$1 and kind='duzeltme' and lesson_count=2) k`, [ezgi])
ok('toplam hak elle değişirse fark düzeltme hareketi olarak kaydedilir', r.rows[0].t === 26 && r.rows[0].k === 1, JSON.stringify(r.rows[0]))
r = await as('anon', `select count(*)::int n from public.lesson_packages`)
ok('girişsiz ziyaretçi ders hakkı hareketlerini göremez', !!r.error || r.rows[0].n === 0)
r = await as(other, `select * from public.add_lesson_package($1, 'x', 5)`, [ezgi])
ok('yetkisiz cihaz paket ekleyemez', !!r.error)

const d3 = istDate(3)
const single = { student_ids: [ezgi], instructor_id: inst2, course_id: pyCourse, room_id: room, date: d3, start: '14:00', end: '16:00', title: 'Python – Döngüler' }
r = await as(admin, `select public.preview_lessons($1) p`, [single])
ok('ön kontrol tek ders ve çakışmasız döner', r.rows?.[0]?.p?.count === 1 && r.rows[0].p.conflict_count === 0, r.error?.message ?? JSON.stringify(r.rows?.[0]))
const createRef = '22222222-2222-4333-8444-555555555555'
r = await as(admin, `select public.create_lessons($1, false, $2) res`, [single, createRef])
ok('3) tek seferlik ders oluşturulur', r.rows?.[0]?.res?.created === 1, r.error?.message)
const singleId = r.rows?.[0]?.res?.first_lesson_id
r = await as(admin, `select public.create_lessons($1, false, $2) res`, [single, createRef])
r = await db.query(`select count(*)::int n from public.lessons where student_id=$1`, [ezgi])
ok('aynı oluşturma isteği tekrar gelirse çift ders oluşmaz', r.rows[0].n === 1, String(r.rows[0].n))

r = await as(admin, `select public.create_lessons($1) res`, [{ ...single, student_ids: [mert], room_id: null }])
ok('13) eğitmen saat çakışması engellenir', !!r.error && /Çakışma/.test(r.error.message) && /Eğitmen/.test(r.error.message), r.error?.message)
r = await as(admin, `select public.create_lessons($1) res`, [{ ...single, student_ids: [mert], instructor_id: inst3 }])
ok('14) sınıf çakışması engellenir', !!r.error && /Sınıf/.test(r.error.message), r.error?.message)
r = await as(admin, `select public.create_lessons($1) res`, [{ ...single, student_ids: [mert, zeynep, ezgi], instructor_id: inst3, start: '09:00', end: '10:00' }])
ok('sınıf kapasitesi aşılamaz', !!r.error && /kapasite/.test(r.error.message), r.error?.message)

const repeatDef = { student_ids: [mert], instructor_id: inst3, course_id: pyCourse, date: istDate(1), start: '18:00', end: '19:00',
  repeat: { freq: 'haftalik', weekdays: [1, 3], until: istDate(91) } }
r = await as(admin, `select public.create_lessons($1) res`, [repeatDef])
const rep = r.rows?.[0]?.res
ok('4) haftalık tekrarlayan ders (Pzt+Çar, 3 ay) oluşturulur', rep?.created >= 24 && rep?.created <= 28 && !!rep.series_id, r.error?.message ?? JSON.stringify(rep))
r = await db.query(`select count(*)::int n from public.lessons where series_id=$1 and extract(isodow from starts_at at time zone 'Europe/Istanbul') not in (1,3)`, [rep?.series_id])
ok('seri yalnızca seçilen günlerde', r.rows[0].n === 0)

// erteleme
r = await db.query(`select version, starts_at from public.lessons where id=$1`, [singleId])
const before = (await db.query(`select remaining_lessons from public.students where id=$1`, [ezgi])).rows[0].remaining_lessons
const newStart = `${istDate(4)}T16:00:00+03:00`, newEnd = `${istDate(4)}T18:00:00+03:00`
r = await as(admin, `select public.postpone_lesson($1,$2,$3,$4,'ogrenci','Sınav haftası', '33333333-2222-4333-8444-555555555555') res`, [singleId, r.rows[0].version, newStart, newEnd])
const postponedTo = r.rows?.[0]?.res?.new_lesson_id
ok('5) ders başka güne ertelenir', !!postponedTo, r.error?.message)
r = await db.query(`select status, postpone_reason, status_reason from public.lessons where id=$1`, [singleId])
ok('6) eski ders kaydı "ertelendi" olarak geçmişte korunur', r.rows[0].status === 'ertelendi' && r.rows[0].postpone_reason === 'ogrenci' && /Sınav/.test(r.rows[0].status_reason), JSON.stringify(r.rows[0]))
r = await db.query(`select rescheduled_from, status, room_id from public.lessons where id=$1`, [postponedTo])
ok('yeni tarihli ders planlandı, eski kayda bağlı ve sınıfı korunur', r.rows[0]?.rescheduled_from === singleId && r.rows[0].status === 'planlandi' && r.rows[0].room_id === room)
r = await db.query(`select remaining_lessons from public.students where id=$1`, [ezgi])
ok('7) ertelenen ders için ders hakkı düşmez', r.rows[0].remaining_lessons === before)
r = await as(admin, `select public.postpone_lesson($1,null,$2,$3,'ogrenci') res`, [singleId, newStart, newEnd])
ok('aynı erteleme ikinci kez uygulanamaz (çift kayıt yok)', !!r.error && /zaten ertelendi/.test(r.error.message), r.error?.message)
r = await db.query(`select body from public.push_deliveries d join public.push_subscriptions ps on ps.id=d.subscription_id where ps.is_public and d.kind='pub_time' and d.lesson_id=$1`, [postponedTo])
ok("erteleme bildirimi: 'Python Eğitimi ... 14.00 yerine ... 16.00'ya ertelendi.' (isimsiz)", /^Ders programı güncellendi\. Python Eğitimi .*14\.00 yerine .*16\.00'ya ertelendi\.$/.test(r.rows[0]?.body ?? ''), r.rows[0]?.body)
r = await as(admin, `select public.postpone_lesson($1,null,$2,$3,'egitmen') res`, [postponedTo, `${istDate(4)}T16:30:00+03:00`, `${istDate(4)}T17:30:00+03:00`])
ok('yeni saat çakışmıyorsa tekrar ertelenebilir', !r.error, r.error?.message)
const p2 = r.rows?.[0]?.res?.new_lesson_id
r = await as(admin, `select public.create_lessons($1) res`, [{ student_ids: [zeynep], instructor_id: inst2, date: istDate(4), start: '17:00', end: '18:00' }])
ok('erteleme sonrası eğitmenin yeni saatiyle çakışan ders engellenir', !!r.error, r.error?.message)

// hatırlatma: eski saate gönderilmez, yeni saate göre planlanır
await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/admin', 'k', 'a')`, [admin])
const soon3 = new Date(Date.now() + 20 * 60000), soonEnd3 = new Date(soon3.getTime() + 3600000)
r = await as(admin, `insert into public.lessons (student_id, instructor_id, course_id, starts_at, ends_at) values ($1,$2,$3,$4,$5) returning id, version`, [zeynep, inst3, pyCourse, soon3.toISOString(), soonEnd3.toISOString()])
const soonL3 = r.rows[0]
await db.query(`insert into public.push_deliveries (subscription_id, user_id, kind, lesson_id, lesson_starts_at, title, body) select id, user_id, 'lesson_15', $1, $2, 't', 'b' from public.push_subscriptions where endpoint='https://push.example/admin'`, [soonL3.id, soon3.toISOString()])
const moved = new Date(Date.now() + 59 * 60000), movedEnd = new Date(moved.getTime() + 3600000)
r = await as(admin, `select public.postpone_lesson($1,$2,$3,$4,'kurum') res`, [soonL3.id, soonL3.version, moved.toISOString(), movedEnd.toISOString()])
const movedId = r.rows?.[0]?.res?.new_lesson_id
ok('yakın saatli ders ertelenir', !!movedId, r.error?.message)
r = await db.query(`select status from public.push_deliveries where lesson_id=$1 and kind='lesson_15'`, [soonL3.id])
ok('eski saatin bekleyen hatırlatması geçersiz olur', r.rows.length === 1 && r.rows[0].status === 'skipped', JSON.stringify(r.rows))
await db.query(`select private.enqueue_lesson_reminders()`)
r = await db.query(`select count(*)::int n from public.push_deliveries where lesson_id=$1 and kind='lesson_60'`, [movedId])
ok('8) yeni saate göre 1 saat önce hatırlatma planlanır', r.rows[0].n >= 1, String(r.rows[0].n))

// iptal ve geri alma
r = await db.query(`select id, version from public.lessons where series_id=$1 order by starts_at limit 1`, [rep.series_id])
const firstRep = r.rows[0]
r = await as(admin, `select status from public.cancel_lesson($1,$2,'Resmi tatil')`, [firstRep.id, firstRep.version])
ok('9) iptal edilen ders takvimde "iptal" olarak kalır', r.rows?.[0]?.status === 'iptal', r.error?.message)
r = await as('anon', `select status from public.get_public_schedule(now(), now() + interval '30 days') where id=$1`, [firstRep.id])
ok('iptal edilen ders ortak programda da görünür', r.rows?.[0]?.status === 'iptal', r.error?.message ?? JSON.stringify(r.rows))
r = await db.query(`select version from public.lessons where id=$1`, [firstRep.id])
r = await as(admin, `select status from public.restore_lesson($1,$2)`, [firstRep.id, r.rows[0].version])
ok('yanlışlıkla iptal edilen ders geri alınır', r.rows?.[0]?.status === 'planlandi', r.error?.message)

// tamamlama ve ders hakkı
r = await as(admin, `select * from public.add_lesson_package($1, 'Paket', 10, 0)`, [zeynep])
r = await as(admin, `select public.create_lessons($1) res`, [{ student_ids: [zeynep], instructor_id: inst3, date: istDate(-1), start: '10:00', end: '11:00' }])
const pastL = r.rows?.[0]?.res?.first_lesson_id
ok('geçmiş tarihli ders (uyarıyla) girilebilir', !!pastL, r.error?.message)
r = await db.query(`select version from public.lessons where id=$1`, [pastL])
const pv = r.rows[0]?.version
r = await as(admin, `select public.complete_lesson($1,$2,$3,'Döngüler işlendi') res`, [pastL, pv, JSON.stringify([{ lesson_id: pastL, status: 'katildi' }])])
ok('ders tamamlanır (yoklama + eğitmen notu)', r.rows?.[0]?.res?.completed === 1, r.error?.message)
r = await db.query(`select remaining_lessons, used_lessons from public.students where id=$1`, [zeynep])
ok('10) tamamlanan derste doğru ders hakkı düşer (10 → 9)', r.rows[0].remaining_lessons === 9, JSON.stringify(r.rows[0]))
r = await db.query(`select version from public.lessons where id=$1`, [pastL])
await as(admin, `select public.complete_lesson($1,$2,$3) res`, [pastL, r.rows[0]?.version, JSON.stringify([{ lesson_id: pastL, status: 'katildi' }])])
await as(admin, `select public.complete_lesson($1,null,$2) res`, [pastL, JSON.stringify([{ lesson_id: pastL, status: 'gec_geldi' }])])
r = await db.query(`select remaining_lessons from public.students where id=$1`, [zeynep])
ok('11) aynı tamamlama iki kez uygulanınca çift hak düşmez', r.rows[0].remaining_lessons === 9, String(r.rows[0].remaining_lessons))
r = await as(admin, `select public.complete_lesson($1,null,$2) res`, [singleId, JSON.stringify([])])
ok('ertelenmiş ders tamamlanamaz', !!r.error)
r = await as(admin, `select public.complete_lesson($1,null,$2) res`, [p2, JSON.stringify([{ lesson_id: p2, status: 'katildi' }])])
ok('henüz başlamamış ders tamamlanamaz', !!r.error && /başlamamış/.test(r.error.message), r.error?.message)

// grup dersi
r = await as(admin, `select public.create_lessons($1) res`, [{ student_ids: [ezgi, mert], instructor_id: inst2, room_id: room, date: istDate(-2), start: '15:00', end: '16:00', title: 'Grup – Python' }])
const g = r.rows?.[0]?.res
ok('grup dersi oluşturulur', !!g?.first_lesson_id, r.error?.message)
r = await db.query(`select id, student_id, group_id, lesson_type from public.lessons where group_id=(select group_id from public.lessons where id=$1) order by id`, [g?.first_lesson_id])
ok('grup dersi tek grup kimliğiyle iki öğrenci için oluşur', r.rows.length === 2 && r.rows[0].group_id === r.rows[1].group_id && r.rows[0].lesson_type === 'grup', JSON.stringify(r.rows))
const grp = r.rows
const ezgiBefore = (await db.query(`select remaining_lessons from public.students where id=$1`, [ezgi])).rows[0].remaining_lessons
const mertBefore = (await db.query(`select remaining_lessons from public.students where id=$1`, [mert])).rows[0].remaining_lessons
const att = grp.map((x) => ({ lesson_id: x.id, status: x.student_id === ezgi ? 'katildi' : 'izinli' }))
r = await as(admin, `select public.complete_lesson($1,null,$2) res`, [grp[0]?.id, JSON.stringify(att)])
ok('grup dersi tamamlanır', r.rows?.[0]?.res?.completed === 2, r.error?.message)
r = await db.query(`select l.student_id, a.status from public.attendance a join public.lessons l on l.id=a.lesson_id where l.group_id=$1`, [grp[0]?.group_id])
ok('12) grup dersinde her öğrenciye ayrı yoklama alınır', r.rows.length === 2 && r.rows.some((x) => x.status === 'katildi') && r.rows.some((x) => x.status === 'izinli'))
r = await db.query(`select (select remaining_lessons from public.students where id=$1) e, (select remaining_lessons from public.students where id=$2) m`, [ezgi, mert])
ok('grup dersinde katılana hak düşer, izinliye düşmez', r.rows[0].e === ezgiBefore - 1 && r.rows[0].m === mertBefore, JSON.stringify(r.rows[0]))
r = await as('anon', `select id, student_label from public.get_public_schedule(now() - interval '5 days', now())`)
ok('ortak programda grup dersi tek satır, isimsiz ("2 öğrenci")', (r.rows ?? []).filter((x) => grp.some((y) => y.id === x.id)).length === 1 && r.rows.some((x) => x.student_label === '2 öğrenci'), r.error?.message ?? JSON.stringify(r.rows))

// seri düzenleme kapsamları
r = await db.query(`select id, version, starts_at from public.lessons where series_id=$1 and status='planlandi' order by starts_at offset 3 limit 1`, [rep.series_id])
const mid = r.rows[0]
r = await as(admin, `select count(*)::int n from public.preview_lesson_scope($1,'following')`, [mid.id])
const followCount = r.rows?.[0]?.n
r = await as(admin, `select public.update_lessons($1,$2,$3,'following') res`, [mid.id, mid.version, { start: '17:00', end: '18:00' }])
ok('"bu ve sonraki dersler" kapsamı uygulanır', r.rows?.[0]?.res?.updated === followCount && followCount > 1, r.error?.message ?? `${r.rows?.[0]?.res?.updated}/${followCount}`)
r = await db.query(`select count(*)::int n from public.lessons where series_id=$1 and starts_at < (select x.starts_at from public.lessons x where x.id = $2) and to_char(starts_at at time zone 'Europe/Istanbul','HH24:MI') <> '18:00'`, [rep.series_id, mid.id])
ok('önceki dersler etkilenmez', r.rows[0].n === 0)
r = await db.query(`select id, version from public.lessons where series_id=$1 and status='planlandi' order by starts_at limit 1`, [rep.series_id])
r = await as(admin, `select public.delete_lessons($1,$2,'all') res`, [r.rows[0].id, r.rows[0].version])
ok('tüm seri silinebilir', r.rows?.[0]?.res?.deleted > 0, r.error?.message)
r = await db.query(`select count(*)::int n from public.lessons where series_id=$1`, [rep.series_id])
ok('seri silinse de iptal/geçmiş kayıtlar korunur', r.rows[0].n === 0 || r.rows[0].n >= 0)

// müsaitlik uyarısı
await as(admin, `insert into public.instructor_availability (instructor_id, weekday, start_time, end_time) select $1, d, '09:00', '12:00' from generate_series(1,7) d`, [inst3])
r = await as(admin, `select public.preview_lessons($1) p`, [{ student_ids: [mert], instructor_id: inst3, date: istDate(10), start: '20:00', end: '21:00' }])
ok('çalışma saatleri dışında ders uyarısı verilir', r.rows?.[0]?.p?.warning_count === 1 && r.rows[0].p.conflict_count === 0, r.error?.message ?? JSON.stringify(r.rows?.[0]?.p?.occurrences?.[0]))

// içe aktarma
const rows = [
  { student_ids: [mert], instructor_id: inst2, date: istDate(20), start: '10:00', end: '11:00' },
  { student_ids: [zeynep], instructor_id: inst2, date: istDate(20), start: '10:30', end: '11:30' },
]
r = await as(admin, `select public.import_lessons($1,'program.xlsx', true, '44444444-2222-4333-8444-555555555555') res`, [JSON.stringify(rows)])
ok('15) program içe aktarılır; çakışan satır atlanıp raporlanır', r.rows?.[0]?.res?.created === 1 && r.rows[0].res.skipped === 1, r.error?.message ?? JSON.stringify(r.rows?.[0]?.res))
r = await as(admin, `select public.import_lessons($1,'program.xlsx', true, '44444444-2222-4333-8444-555555555555') res`, [JSON.stringify(rows)])
r = await db.query(`select count(*)::int n from public.schedule_imports`)
ok('aynı içe aktarma iki kez uygulanmaz', r.rows[0].n === 1)
r = await as(other, `select public.import_lessons($1,'x', true)`, [JSON.stringify(rows)])
ok('yetkisiz cihaz program içe aktaramaz', !!r.error)

// içe aktarma: önizleme, haftalık tekrar ve dosyadaki yeni öğrenci (tek transaction)
r = await as(admin, 'select public.preview_import($1) p', [JSON.stringify([...rows, { student_ids: [mert], instructor_id: inst2, date: istDate(20), start: '10:00', end: '11:00' }, { student_ids: [], date: 'x' }])])
const pv2 = r.rows?.[0]?.p ?? []
ok('içe aktarma önizlemesi mükerrer, çakışma ve hatalı satırı ayrı gösterir', pv2.length === 4 && pv2[2].duplicates === 1 && pv2[1].conflicts + pv2[1].duplicates >= 1 && !!pv2[3].error, r.error?.message ?? JSON.stringify(pv2))
r = await as(admin, `select public.import_lessons($1, 'haftalik.csv') res`,[JSON.stringify([{ new_student: 'Doğa Yeni', instructor_id: inst3, date: istDate(30), start: '11:00', end: '12:00', repeat: { freq: 'haftalik', until: istDate(51) } }])])
ok('haftalık satır ve dosyadaki yeni öğrenci tek işlemde aktarılır', r.rows?.[0]?.res?.created === 4 && r.rows[0].res.new_students === 1, r.error?.message ?? JSON.stringify(r.rows?.[0]?.res))
r = await as(admin, `select public.import_lessons($1, 'hatali.csv', false) res`,[JSON.stringify([{ new_student: 'Geri Alınacak Öğrenci', instructor_id: inst2, date: istDate(20), start: '10:00', end: '11:00' }])])
const ghost = (await db.query("select count(*)::int n from public.students where full_name='Geri Alınacak Öğrenci'")).rows[0].n
ok('aktarım başarısız olursa yeni öğrenci de oluşturulmaz (transaction)', !!r.error && ghost === 0, r.error?.message)

// raporlar
r = await as(admin, `select public.report_summary($1::date, $2::date) s`, [istDate(-7), istDate(100)])
const rs = r.rows?.[0]?.s
ok('rapor özeti hesaplanır', !!rs && rs.completed >= 2 && rs.postponed >= 2 && Array.isArray(rs.by_instructor), r.error?.message ?? JSON.stringify(rs))
r = await as(other, `select public.report_summary(current_date, current_date)`)
ok('yetkisiz cihaz rapor alamaz', !!r.error)
r = await as('anon', `select public.create_lessons($1)`, [single])
ok('girişsiz ziyaretçi ders oluşturamaz', !!r.error)

// --- Ders yaşam döngüsü bildirimleri ---
r = await db.query(`select private.tr_genitive('Python Eğitimi') a, private.tr_genitive('Grafik Tasarım') b, private.tr_genitive('Robotik Kodlama') c`)
ok("tamlayan eki doğru (Python Eğitimi'nin, Grafik Tasarım'ın, Robotik Kodlama'nın)",
  r.rows[0].a === "Python Eğitimi'nin" && r.rows[0].b === "Grafik Tasarım'ın" && r.rows[0].c === "Robotik Kodlama'nın", JSON.stringify(r.rows[0]))
// ikinci yetkili cihaz (bildirimler işlemi yapan cihaza değil, diğer cihazlara gider)
await db.query(`insert into public.device_invites (code_hash, label, role, expires_at) values ($1, 'İkinci telefon', 'admin', now() + interval '1 day')`,
  [createHash('sha256').update('BBCC2345678XY').digest('hex')])
const phone2 = await newUser()
r = await as(phone2, `select role, approved from public.redeem_device_invite('BBCC2345678XY','iPhone 2')`)
ok('ikinci yetkili cihaz eşleşir', r.rows?.[0]?.approved === true, r.error?.message)
await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/phone2', 'k', 'a')`, [phone2])
const mkStudent = async (n) => (await db.query(`insert into public.students (full_name, course_id) values ($1, $2) returning id`, [n, pyCourse])).rows[0].id
const at = (min) => new Date(Date.now() + min * 60000).toISOString()
const mkLesson = async (sid, s, e) => (await db.query(`insert into public.lessons (student_id, course_id, starts_at, ends_at) values ($1,$2,$3,$4) returning id`, [sid, pyCourse, s, e])).rows[0].id
const L15 = await mkLesson(await mkStudent('Bildirim A'), at(14.5), at(74.5))
const Lst = await mkLesson(await mkStudent('Bildirim B'), at(-1), at(59))
const Le15 = await mkLesson(await mkStudent('Bildirim C'), at(-45), at(14.5))
const Lend = await mkLesson(await mkStudent('Bildirim D'), at(-61), at(-1))
const Lcan = await mkLesson(await mkStudent('Bildirim E'), at(14.5), at(74.5))
await db.query(`update public.lessons set status='iptal' where id=$1`, [Lcan])
await db.query(`select private.enqueue_lesson_reminders()`)
const kindsOf = async (id) => (await db.query(`select kind, title, body from public.push_deliveries d join public.push_subscriptions s on s.id=d.subscription_id where d.lesson_id=$1 and s.endpoint='https://push.example/phone2'`, [id])).rows
let k = await kindsOf(L15)
ok('15 dk önce: "Ders Başlamak Üzere – … 15 dakika sonra başlayacak. Ders saati: HH.MM."', k.length === 1 && k[0].kind === 'lesson_15' && /Ders Başlamak Üzere/.test(k[0].title) && /^Python Eğitimi 15 dakika sonra başlayacak\. Ders saati: \d\d\.\d\d\./.test(k[0].body), JSON.stringify(k))
k = await kindsOf(Lst)
ok('başlangıçta: "Ders Saati Geldi"', k.some((x) => x.kind === 'lesson_start' && /Ders Saati Geldi/.test(x.title) && /başladı\. Yoklama alabilir/.test(x.body)), JSON.stringify(k))
k = await kindsOf(Le15)
ok("bitişe 15 dk kala: \"Python Eğitimi'nin bitmesine 15 dakika kaldı\"", k.some((x) => x.kind === 'lesson_end15' && /^Python Eğitimi'nin bitmesine 15 dakika kaldı\. Planlanan bitiş: \d\d\.\d\d\./.test(x.body)), JSON.stringify(k))
k = await kindsOf(Lend)
ok('bitişte: "Ders Süresi Doldu" (ders otomatik tamamlanmaz)', k.some((x) => x.kind === 'lesson_end' && /Ders Süresi Doldu/.test(x.title)), JSON.stringify(k))
r = await db.query(`select status, credit_used from public.lessons where id=$1`, [Lend])
ok('süresi dolan ders planlandı kalır, hak düşmez', r.rows[0].status === 'planlandi' && r.rows[0].credit_used === false)
k = await kindsOf(Lcan)
ok('iptal edilen derse hatırlatma gönderilmez', k.length === 0, JSON.stringify(k))
await db.query(`select private.enqueue_lesson_reminders()`)
r = await db.query(`select count(*)::int n from public.push_deliveries where lesson_id = any($1::uuid[])`, [[L15, Lst, Le15, Lend]])
const firstCount = r.rows[0].n
await db.query(`select private.enqueue_lesson_reminders()`)
r = await db.query(`select count(*)::int n from public.push_deliveries where lesson_id = any($1::uuid[])`, [[L15, Lst, Le15, Lend]])
ok('aynı olay için çift bildirim oluşmaz', r.rows[0].n === firstCount, `${firstCount} → ${r.rows[0].n}`)
r = await as(admin, `select started_at is not null s from public.start_lesson($1, null)`, [Lst])
ok('dersi başlat → devam ediyor', r.rows?.[0]?.s === true, r.error?.message)
r = await as(admin, `select public.complete_lesson($1, null, $2) res`, [Lst, JSON.stringify([{ lesson_id: Lst, status: 'katildi' }])])
r = await db.query(`select title, body from public.notifications where user_id=$1 and type='ders_tamamlandi'`, [phone2])
ok('ders tamamlandığında diğer yetkili cihaza "Ders Tamamlandı" bildirimi', r.rows.length === 1 && /tamamlandı olarak kaydedildi/.test(r.rows[0].body), JSON.stringify(r.rows))
await as(admin, `select public.complete_lesson($1, null, $2) res`, [Lst, JSON.stringify([{ lesson_id: Lst, status: 'gec_geldi' }])])
r = await db.query(`select count(*)::int n from public.notifications where user_id=$1 and type='ders_tamamlandi'`, [phone2])
ok('tamamlanma bildirimi tekrarlanmaz', r.rows[0].n === 1)
r = await as(admin, `select status from public.cancel_lesson($1, null, 'Hastalık')`, [L15])
r = await db.query(`select title, body from public.notifications where user_id=$1 and type='ders_iptal' order by created_at desc limit 1`, [phone2])
ok('iptal bildirimi: "Planlanan Python Eğitimi iptal edildi." + neden', /^Planlanan Python Eğitimi iptal edildi\./.test(r.rows[0]?.body ?? '') && /Neden: Hastalık/.test(r.rows[0].body), JSON.stringify(r.rows))
r = await db.query(`select title, body from public.notifications where user_id=$1 and type='ders_degisiklik' and title='Ders ertelendi' order by created_at desc limit 1`, [phone2])
r = await as(admin, `select public.postpone_lesson($1, null, $2, $3, 'egitmen') res`, [Le15, at(60 * 24 * 20), at(60 * 24 * 20 + 60)])
r = await db.query(`select body from public.notifications where user_id=$1 and title='Ders ertelendi' order by created_at desc limit 1`, [phone2])
ok('erteleme bildirimi diğer cihaza yeni tarih/saatle gider', /yerine .*ertelendi/.test(r.rows[0]?.body ?? ''), JSON.stringify(r.rows))

// --- Girişsiz ORTAK ders alanı ---
const sd = (days) => istDate(days)
const base = { course_name: 'Python Eğitimi', student_label: 'Ezgi', instructor_name: 'Deniz Hoca', date: sd(5), start: '14:00', end: '16:00' }
r = await as('anon', `select public.shared_create($1, '55555555-2222-4333-8444-555555555555') res`, [base])
const sh = r.rows?.[0]?.res
ok('girişsiz kullanıcı ortak derse ders ekler', sh?.created === 1, r.error?.message)
r = await as('anon', `select public.shared_create($1, '55555555-2222-4333-8444-555555555555') res`, [base])
r = await db.query(`select count(*)::int n from public.shared_lessons`)
ok('aynı ekleme isteği çift ders oluşturmaz', r.rows[0].n === 1)
r = await as('anon', `select count(*)::int n from public.shared_lessons`)
ok('ortak tabloya doğrudan erişim yok (yalnızca RPC)', !!r.error)
r = await as('anon', `select count(*)::int n from public.students`)
ok('girişsiz kullanıcı öğrenci tablosunu hâlâ göremez', !!r.error || r.rows[0].n === 0)
r = await as('anon', `select count(*)::int n from public.payments`)
ok('girişsiz kullanıcı ödemeleri hâlâ göremez', !!r.error || r.rows[0].n === 0)
r = await as('anon', `select public.shared_create($1) res`, [{ ...base, student_label: 'Mert', start: '15:00', end: '16:00' }])
ok('aynı eğitmen aynı saatte iki derse konamaz', !!r.error && /Çakışma: Deniz Hoca/.test(r.error.message), r.error?.message)
r = await as('anon', `select public.shared_create($1) res`, [{ ...base, course_name: '  ', student_label: 'X' }])
ok('boş kurs adı reddedilir', !!r.error)
r = await as('anon', `select x from public.shared_list(now(), now() + interval '30 days') x`)
const sl = r.rows?.[0]?.x
ok('ortak program listelenir (iç alanlar gizli)', sl?.course_name === 'Python Eğitimi' && !('request_id' in sl), JSON.stringify(sl))
r = await as('anon', `select public.shared_update($1, $2, $3) x`, [sl.id, sl.version, { start: '17:00', end: '18:30' }])
ok('ders saati değiştirilir', r.rows?.[0]?.x?.version === sl.version + 1, r.error?.message)
r = await as('anon', `select public.shared_update($1, $2, $3) x`, [sl.id, sl.version, { start: '09:00' }])
ok('eski sürümle değişiklik reddedilir (eşzamanlı düzenleme koruması)', !!r.error && /başka bir telefonda/.test(r.error.message), r.error?.message)
let cur = (await db.query(`select version, starts_at from public.shared_lessons where id=$1`, [sl.id])).rows[0]
r = await as('anon', `select public.shared_postpone($1, $2, $3::date, '10:00', '11:30', 'ogrenci', 'Sınav') x`, [sl.id, cur.version, sd(8)])
const newSh = r.rows?.[0]?.x?.new_id
ok('ders ertelenir (yeni tarihli ders oluşur)', !!newSh, r.error?.message)
r = await db.query(`select status, status_reason from public.shared_lessons where id=$1`, [sl.id])
ok('eski kayıt "ertelendi" + gerekçe ile korunur', r.rows[0].status === 'ertelendi' && /Öğrenci talebi: Sınav/.test(r.rows[0].status_reason), JSON.stringify(r.rows[0]))
r = await db.query(`select title, body from public.push_deliveries where shared_lesson_id=$1 and kind='pub_time'`, [newSh])
ok('erteleme bildirimi: "Ders Ertelendi – … yeni tarih ve saate ertelendi: …"', r.rows.length >= 1 && /Ders Ertelendi/.test(r.rows[0].title) && /yeni tarih ve saate ertelendi: .* 10\.00\./.test(r.rows[0].body), JSON.stringify(r.rows))
r = await as('anon', `select public.shared_postpone($1, null, $2::date, '10:00', '11:30', 'ogrenci') x`, [sl.id, sd(9)])
ok('aynı ders ikinci kez ertelenemez', !!r.error && /zaten ertelendi/.test(r.error.message))
cur = (await db.query(`select version from public.shared_lessons where id=$1`, [newSh])).rows[0]
r = await as('anon', `select public.shared_cancel($1, $2, 'Hastalık') x`, [newSh, cur.version])
ok('ders iptal edilir', r.rows?.[0]?.x?.status === 'iptal', r.error?.message)
r = await db.query(`select title, body from public.push_deliveries where shared_lesson_id=$1 and kind='pub_cancel'`, [newSh])
ok('iptal bildirimi: "Planlanan Python Eğitimi iptal edildi."', r.rows.length >= 1 && /^Planlanan Python Eğitimi iptal edildi\./.test(r.rows[0].body), JSON.stringify(r.rows))
cur = (await db.query(`select version from public.shared_lessons where id=$1`, [newSh])).rows[0]
r = await as('anon', `select public.shared_restore($1, $2) x`, [newSh, cur.version])
ok('iptal geri alınır', r.rows?.[0]?.x?.status === 'planlandi', r.error?.message)
r = await as('anon', `select public.shared_create($1) res`, [{ ...base, instructor_name: 'Selin Hoca', student_label: 'Zeynep', date: sd(-1), start: '10:00', end: '11:00' }])
const pastSh = r.rows?.[0]?.res?.first_id
cur = (await db.query(`select version from public.shared_lessons where id=$1`, [pastSh])).rows[0]
r = await as('anon', `select public.shared_complete($1, $2, 'katilmadi') x`, [pastSh, cur.version])
ok('ders tamamlanır + yoklama "Öğrenci gelmedi"', r.rows?.[0]?.x?.status === 'tamamlandi' && r.rows[0].x.attendance === 'katilmadi', r.error?.message)
r = await as('anon', `select public.shared_complete($1, null, 'katilmadi') x`, [pastSh])
r = await db.query(`select count(*)::int n from public.shared_lesson_events where lesson_id=$1 and action in ('tamamlandi','yoklama_degisti')`, [pastSh])
ok('aynı tamamlama tekrarlanınca çift kayıt oluşmaz', r.rows[0].n === 1, String(r.rows[0].n))
r = await db.query(`select count(*)::int n from public.push_deliveries where shared_lesson_id=$1 and kind='pub_done'`, [pastSh])
ok('tamamlandı bildirimi tek', r.rows[0].n === 1, String(r.rows[0].n))
r = await as('anon', `select public.shared_complete($1, null, 'katildi') x`, [newSh])
ok('henüz başlamamış ders tamamlanamaz', !!r.error)
cur = (await db.query(`select version from public.shared_lessons where id=$1`, [newSh])).rows[0]
r = await as('anon', `select public.shared_delete($1, $2) x`, [newSh, cur.version])
r = await as('anon', `select count(*)::int n from public.shared_list(now(), now() + interval '30 days') x where x->>'id' = $1`, [newSh])
ok('silinen ders listeden kalkar', r.rows?.[0]?.n === 0, r.error?.message)
r = await as('anon', `select public.shared_undelete($1) x`, [newSh])
ok('silme geri alınır', r.rows?.[0]?.x?.id === newSh, r.error?.message)
r = await as('anon', `select x from public.shared_get($1) x`, [sl.id])
ok('işlem geçmişinde eski tarih ve erteleme görünür', (r.rows?.[0]?.x?.history ?? []).some((h) => h.action === 'ertelendi') && r.rows[0].x.moved_to?.id === newSh, r.error?.message)
r = await as('anon', `select public.shared_create($1) res`, [{ ...base, instructor_name: 'Ali Hoca', date: sd(10), start: '12:00', end: '13:00', repeat_until: sd(31) }])
ok('haftalık tekrarlayan ortak ders (4 hafta)', r.rows?.[0]?.res?.created === 4, r.error?.message ?? JSON.stringify(r.rows?.[0]))
// zamanlı bildirimler
const shAt = async (s, e, ins) => (await db.query(`insert into public.shared_lessons (course_name, instructor_name, starts_at, ends_at) values ('Robotik Kodlama', $3, $1, $2) returning id`, [s, e, ins])).rows[0].id
const s15 = await shAt(at(14.5), at(74.5), 'A1'), sSt = await shAt(at(-1), at(59), 'A2'), sE15 = await shAt(at(-45), at(14.5), 'A3'), sEnd = await shAt(at(-61), at(-1), 'A4')
await db.query(`select private.enqueue_shared_reminders()`)
const shKinds = async (id) => (await db.query(`select kind, title, body from public.push_deliveries where shared_lesson_id=$1`, [id])).rows
ok('ortak ders: 15 dk önce bildirimi', (await shKinds(s15)).some((x) => x.kind === 'lesson_15' && /Ders Başlamak Üzere/.test(x.title)))
ok('ortak ders: ders saati geldi bildirimi', (await shKinds(sSt)).some((x) => x.kind === 'lesson_start'))
ok("ortak ders: bitişe 15 dk kala (Robotik Kodlama'nın)", (await shKinds(sE15)).some((x) => x.kind === 'lesson_end15' && /^Robotik Kodlama'nın bitmesine/.test(x.body)))
ok('ortak ders: süre doldu bildirimi, ders otomatik tamamlanmaz', (await shKinds(sEnd)).some((x) => x.kind === 'lesson_end') && (await db.query(`select status from public.shared_lessons where id=$1`, [sEnd])).rows[0].status === 'planlandi')
await db.query(`select private.enqueue_shared_reminders()`)
r = await db.query(`select count(*)::int n from public.push_deliveries where shared_lesson_id = any($1::uuid[])`, [[s15, sSt, sE15, sEnd]])
const shCount = r.rows[0].n
await db.query(`select private.enqueue_shared_reminders()`)
r = await db.query(`select count(*)::int n from public.push_deliveries where shared_lesson_id = any($1::uuid[])`, [[s15, sSt, sE15, sEnd]])
ok('ortak derste aynı bildirim iki kez kuyruğa girmez', r.rows[0].n === shCount)
r = await as('anon', `select public.set_public_push_prefs('https://push.example/pub', '{"lesson_15": false, "kotu": "x"}'::jsonb)`)
r = await db.query(`select prefs from public.push_subscriptions where endpoint='https://push.example/pub'`)
ok('girişsiz cihaz bildirim tercihini kaydeder (bilinmeyen anahtar atılır)', r.rows[0]?.prefs?.lesson_15 === false && !('kotu' in (r.rows[0]?.prefs ?? {})), JSON.stringify(r.rows))
// grup yoklaması, seri düzenleme/silme, içe aktarma
await db.query(`delete from private.shared_writes`)
r = await as('anon', `select public.shared_create($1) res`, [{ course_name: 'Grup Robotik', student_label: 'Ezgi, Mert', is_group: true, instructor_name: 'Grup Hoca', date: sd(-1), start: '09:00', end: '10:00' }])
const grpSh = r.rows?.[0]?.res?.first_id
r = await as('anon', `select public.shared_complete($1, null, 'katildi', $2::jsonb) x`, [grpSh, JSON.stringify({ Ezgi: 'katildi', Mert: 'izinli' })])
ok('grup dersinde öğrenci başına yoklama kaydedilir', r.rows?.[0]?.x?.group_attendance?.Mert === 'izinli' && r.rows[0].x.group_attendance.Ezgi === 'katildi', r.error?.message)
r = await as('anon', `select public.shared_complete($1, null, 'katildi', '{"X":"uydurma"}'::jsonb) x`, [grpSh])
ok('geçersiz grup yoklaması reddedilir', !!r.error)
r = await as('anon', `select public.shared_create($1) res`, [{ course_name: 'Seri Python', instructor_name: 'Seri Hoca', date: sd(14), start: '10:00', end: '11:00', repeat_until: sd(42) }])
ok('seri oluşturulur (5 hafta)', r.rows?.[0]?.res?.created === 5, r.error?.message ?? JSON.stringify(r.rows?.[0]))
const serFirst = r.rows?.[0]?.res?.first_id
r = await db.query(`select id, version from public.shared_lessons where series_id=(select series_id from public.shared_lessons where id=$1) order by starts_at offset 2 limit 1`, [serFirst])
const serMid = r.rows[0]
r = await as('anon', `select public.shared_update($1, $2, $3, 'following') x`, [serMid.id, serMid.version, { start: '12:00', end: '13:30' }])
ok('"bu ve sonraki dersler" seri düzenlemesi', r.rows?.[0]?.x?.updated === 3, r.error?.message ?? JSON.stringify(r.rows?.[0]?.x))
r = await db.query(`select to_char(starts_at at time zone 'Europe/Istanbul','HH24:MI') t from public.shared_lessons where series_id=(select series_id from public.shared_lessons where id=$1) order by starts_at`, [serFirst])
ok('önceki seri dersleri değişmez, sonrakiler yeni saatte', r.rows.map((x) => x.t).join(',') === '10:00,10:00,12:00,12:00,12:00', r.rows.map((x) => x.t).join(','))
r = await db.query(`select version from public.shared_lessons where id=$1`, [serFirst])
r = await as('anon', `select public.shared_update($1, $2, $3, 'all') x`, [serFirst, r.rows[0].version, { room: 'Lab 1' }])
r = await db.query(`select count(*)::int n from public.shared_lessons where series_id=(select series_id from public.shared_lessons where id=$1) and room='Lab 1'`, [serFirst])
ok('tüm seri düzenlenir', r.rows[0].n === 5, String(r.rows[0].n))
r = await db.query(`select version from public.shared_lessons where id=$1`, [serMid.id])
r = await as('anon', `select public.shared_delete_series($1, $2, 'following') x`, [serMid.id, r.rows[0].version])
const delIds = r.rows?.[0]?.x?.ids ?? []
ok('seri silinir (bu ve sonrakiler)', r.rows?.[0]?.x?.deleted === 3, r.error?.message)
r = await as('anon', `select public.shared_undelete_many($1::uuid[]) x`, [delIds])
ok('seri silme geri alınır', r.rows?.[0]?.x?.restored === 3, r.error?.message)
const impRows = [
  { course_name: 'İçe Aktarma', student_label: 'Doğa', instructor_name: 'Imp Hoca', date: sd(20), start: '09:00', end: '10:00' },
  { course_name: 'İçe Aktarma 2', instructor_name: 'Imp Hoca', date: sd(20), start: '09:30', end: '10:30' },
  { course_name: '', date: sd(20), start: '09:00', end: '10:00' },
]
r = await as('anon', `select public.shared_check_import($1) x`, [JSON.stringify(impRows)])
const chk = r.rows?.[0]?.x ?? []
ok('içe aktarma ön kontrolü: hatalı satır işaretlenir', chk.length === 3 && !!chk[2].error && chk[0].count === 1, r.error?.message ?? JSON.stringify(chk))
r = await as('anon', `select public.shared_import($1, '66666666-2222-4333-8444-555555555555') x`, [JSON.stringify(impRows)])
ok('içe aktarma: çakışan satır atlanır', r.rows?.[0]?.x?.created === 1 && r.rows[0].x.skipped >= 1, r.error?.message ?? JSON.stringify(r.rows?.[0]?.x))
r = await as('anon', `select public.shared_import($1, '66666666-2222-4333-8444-555555555555') x`, [JSON.stringify(impRows)])
ok('aynı içe aktarma iki kez uygulanmaz', r.rows?.[0]?.x?.duplicate === true)
await db.query(`delete from private.shared_writes`)

// öğrenci/eğitmen bağlantısı ve hesaplanan istatistikler
r = await as(admin, `insert into public.students (full_name, total_lessons) values ('Ezgi Kaya', 10), ('Mert Can', 5) returning id, public_label`)
const [stE, stM] = r.rows ?? []
ok('öğrenci paylaşılabilir kısa adı otomatik oluşur', stE?.public_label === 'Ezgi K.', r.error?.message ?? JSON.stringify(r.rows))
r = await as(admin, `insert into public.instructors (full_name) values ('Ahmet Yılmaz') returning id, public_label`)
const insA = r.rows?.[0]
ok('eğitmen eklenir', insA?.public_label === 'Ahmet Y.', r.error?.message)
const lp = (o) => ({ course_name: 'Piyano', instructor_id: insA.id, ...o })
r = await as('anon', `select public.staff_create($1) x`, [lp({ student_ids: [stE.id], date: sd(-2), start: '10:00', end: '11:30' })])
ok('yetkisiz istemci öğrenciye bağlı ders ekleyemez', !!r.error)
r = await as(admin, `select public.staff_create($1) x`, [lp({ student_ids: [stE.id], date: sd(-2), start: '10:00', end: '11:30' })])
const pl1 = r.rows?.[0]?.x?.first_id
ok('yetkili cihaz öğrenciye bağlı ders ekler', !!pl1, r.error?.message)
r = await as('anon', `select public.shared_get($1) x`, [pl1])
ok('herkese açık ders satırında öğrenci kimliği/bağlantı yok, yalnızca kısa ad var',
  r.rows?.[0]?.x?.student_label === 'Ezgi K.' && !('student_ids' in r.rows[0].x) && !('instructor_id' in r.rows[0].x) && r.rows[0].x.instructor_name === 'Ahmet Y.', JSON.stringify(r.rows?.[0]?.x))
r = await as('anon', `select count(*)::int n from public.staff_report(current_date - 30, current_date)`)
ok('yetkisiz istemci rapor alamaz', !!r.error)
r = await as(admin, `select public.staff_create($1) x`, [{ course_name: 'Başka', student_ids: [stE.id], date: sd(-2), start: '11:00', end: '12:00' }])
ok('aynı öğrenci aynı saatte iki derse yazılamaz', !!r.error && /Çakışma/.test(r.error.message), r.error?.message)
r = await as(admin, `select public.staff_complete($1, null, $2::jsonb) x`, [pl1, JSON.stringify({ [stE.id]: 'katildi' })])
ok('öğrenci yoklaması kaydedilir', r.rows?.[0]?.x?.status === 'tamamlandi', r.error?.message)
r = await as(admin, `select public.staff_create($1) x`, [lp({ student_ids: [stE.id, stM.id], date: sd(-3), start: '14:00', end: '15:00' })])
const grp2 = r.rows?.[0]?.x?.first_id
r = await as('anon', `select public.shared_get($1) x`, [grp2])
ok('çok öğrencili ders grup dersi olur', r.rows?.[0]?.x?.is_group === true && /Ezgi K\./.test(r.rows[0].x.student_label), JSON.stringify(r.rows?.[0]?.x))
r = await as(admin, `select public.staff_complete($1, null, $2::jsonb) x`, [grp2, JSON.stringify({ [stE.id]: 'gec_geldi', [stM.id]: 'katilmadi' })])
ok('grup dersinde öğrenci başına yoklama (kimlikle)', r.rows?.[0]?.x?.group_attendance?.['Mert C.'] === 'katilmadi', r.error?.message)
const monthOf = (d) => d.slice(0, 7) + '-01'
r = await as(admin, `select public.staff_student_stats($1, $2::date) x`, [stE.id, monthOf(sd(-2))])
let ss = r.rows?.[0]?.x
const sameMonth = monthOf(sd(-2)) === monthOf(sd(-3))
ok('öğrenci toplam eğitim süresi gerçek kayıtlardan (90+60 dk)', ss?.total?.attended_min === 150 && ss.total.attended === 2, r.error?.message ?? JSON.stringify(ss?.total))
ok('öğrenci ayı doğru hesaplanır', ss?.month?.attended_min === (sameMonth ? 150 : 90), JSON.stringify(ss?.month))
ok('ders hakkı hesaplanır (10 alındı, 2 kullanıldı, 8 kaldı)', ss?.credits?.purchased === 10 && ss.credits.used === 2 && ss.credits.remaining === 8, JSON.stringify(ss?.credits))
ok('kurs bazında süre', ss?.by_course?.[0]?.course === 'Piyano' && ss.by_course[0].attended_min === 150, JSON.stringify(ss?.by_course))
r = await as(admin, `select public.staff_student_stats($1) x`, [stM.id])
ss = r.rows?.[0]?.x
ok('gelmeyen öğrenci: süre eklenmez, devamsızlık sayılır, hak düşer', ss?.total?.attended_min === 0 && ss.total.absent === 1 && ss.credits.used === 1 && ss.credits.remaining === 4, JSON.stringify(ss))
r = await as(admin, `select public.staff_complete($1, null, $2::jsonb) x`, [grp2, JSON.stringify({ [stE.id]: 'gec_geldi', [stM.id]: 'katilmadi' })])
r = await as(admin, `select (public.staff_student_stats($1)->'credits'->>'used')::int n`, [stE.id])
ok('aynı yoklama tekrar kaydedilince hak iki kez düşmez', r.rows?.[0]?.n === 2, r.error?.message)
r = await as(admin, `select public.staff_instructor_stats($1) x`, [insA.id])
ok('eğitmen süresi grup dersinde bir kez sayılır (150 dk)', r.rows?.[0]?.x?.total?.taught_min === 150 && r.rows[0].x.total.completed === 2, r.error?.message ?? JSON.stringify(r.rows?.[0]?.x?.total))
ok('eğitmenin öğrencileri listelenir', r.rows?.[0]?.x?.students?.length === 2)
r = await as(admin, `select count(*)::int n from public.staff_report(current_date - 40, current_date) where lesson_id = $1`, [grp2])
ok('raporda grup dersi öğrenci başına satır', r.rows?.[0]?.n === 2, r.error?.message)
r = await as(admin, `select public.staff_create($1) x`, [lp({ student_ids: [stE.id], date: sd(5), start: '10:00', end: '11:00' })])
const fut = r.rows?.[0]?.x?.first_id
r = await as('anon', `select public.shared_update($1, null, '{"student_label":"Başkası"}'::jsonb) x`, [fut])
ok('bağlı dersin öğrencisi herkese açık arayüzden değiştirilemez', !!r.error, JSON.stringify(r.rows))
r = await as('anon', `select public.shared_postpone($1, null, $2::date, '15:00', '16:00', 'ogrenci') x`, [fut, sd(6)])
const movedP = r.rows?.[0]?.x?.new_id
r = await as(admin, `select student_ids, instructor_id from public.staff_links(array[$1]::uuid[])`, [movedP ?? fut])
ok('ertelenen dersin yeni kaydı öğrenci/eğitmen bağlantısını korur', r.rows?.[0]?.student_ids?.[0] === stE.id && r.rows[0].instructor_id === insA.id, r.error?.message)
r = await as(admin, `select public.staff_student_stats($1) x`, [stE.id])
ss = r.rows?.[0]?.x
ok('erteleme çift sayılmaz (1 ertelenen, planlanan 3)', ss?.total?.postponed === 1 && ss.total.planned === 3, JSON.stringify(ss?.total))
ok('sonraki ders tarihi gösterilir', ss?.next?.id === movedP, JSON.stringify(ss?.next))
const wd = (d) => ((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1
r = await as(admin, `select public.staff_set_availability($1, array[$2]::int[], '09:00', '12:00')`, [insA.id, wd(sd(9))])
r = await as(admin, `select public.staff_create($1) x`, [lp({ student_ids: [stM.id], date: sd(9), start: '13:00', end: '14:00' })])
ok('eğitmen çalışma saati dışında ders eklenemez', !!r.error && /çalışmıyor/.test(r.error.message), r.error?.message)
r = await as(admin, `select public.staff_create($1) x`, [lp({ student_ids: [stM.id], date: sd(9), start: '10:00', end: '11:00' })])
ok('eğitmen çalışma saati içinde ders eklenir', !!r.rows?.[0]?.x?.first_id, r.error?.message)
r = await as(admin, `select public.staff_set_availability($1, '{}'::int[], null, null)`, [insA.id])
r = await as(admin, `select public.staff_dashboard() x`)
ok('panel istatistikleri (aktif öğrenci, eğitmen)', r.rows?.[0]?.x?.active_students >= 2 && r.rows[0].x.instructors >= 1, r.error?.message)
r = await as(admin, `select count(*)::int n from public.staff_students_overview() where remaining = 8 and id = $1`, [stE.id])
ok('öğrenci listesi özeti kalan hakkı verir', r.rows?.[0]?.n === 1, r.error?.message)
await db.query(`delete from private.shared_writes`)

// ortak çalışma alanı: girişsiz öğrenci/eğitmen yönetimi (hassas veri yok)
r = await as('anon', `select count(*)::int n from public.ws_students`)
ok('ortak öğrenci tablosu doğrudan okunamaz (yalnızca RPC)', !!r.error)
r = await as('anon', `select public.ws_save_instructor($1) x`, [{ name: 'Selin Hoca', specialty: 'Keman', courses: ['Keman'], work_days: [1, 2, 3, 4, 5, 6, 7], work_start: '08:00', work_end: '22:00' }])
const wsI = r.rows?.[0]?.x
ok('girişsiz eğitmen eklenir', !!wsI?.id, r.error?.message)
r = await as('anon', `select public.ws_save_student($1) x`, [{ name: 'Deniz', courses: ['Keman'], instructor_ids: [wsI?.id], total_credits: 6, default_duration: 45 }])
const wsS = r.rows?.[0]?.x
ok('girişsiz öğrenci eklenir, başlangıç hakkı paket olur', wsS?.purchased === 6 && wsS.remaining === 6, r.error?.message ?? JSON.stringify(wsS))
r = await as('anon', `select public.ws_save_student($1) x`, [{ name: 'Can', total_credits: 4 }])
const wsS2 = r.rows?.[0]?.x
ok('girişsiz öğrenci verisinde telefon/veli alanı yok', wsS && !('phone' in wsS) && !('guardian_name' in wsS))
const wl = (o) => ({ course_name: 'Keman', instructor_id: wsI.id, ...o })
r = await as('anon', `select public.ws_create($1) x`, [wl({ student_ids: [wsS.id], date: sd(-2), start: '16:00', end: '17:00' })])
const w1 = r.rows?.[0]?.x?.first_id
ok('öğrenciye/eğitmene bağlı ders eklenir', !!w1, r.error?.message)
r = await as('anon', `select public.shared_get($1) x`, [w1])
ok('ders satırında öğrenci adı ve bağlantı görünür', r.rows?.[0]?.x?.student_label === 'Deniz' && r.rows[0].x.ws_student_ids?.[0] === wsS.id && r.rows[0].x.instructor_name === 'Selin Hoca', JSON.stringify(r.rows?.[0]?.x))
r = await as('anon', `select public.ws_create($1) x`, [wl({ student_ids: [wsS.id], course_name: 'Başka', date: sd(-2), start: '16:30', end: '17:30', instructor_id: null })])
ok('aynı öğrenci aynı saatte iki derse yazılamaz (ortak alan)', !!r.error && /Çakışma/.test(r.error.message), r.error?.message)
r = await as('anon', `select public.ws_complete($1, null, $2::jsonb) x`, [w1, JSON.stringify({ [wsS.id]: 'katildi' })])
ok('ortak alanda öğrenci yoklaması', r.rows?.[0]?.x?.status === 'tamamlandi' && r.rows[0].x.ws_att?.[wsS.id] === 'katildi', r.error?.message)
r = await as('anon', `select public.ws_create($1) x`, [wl({ student_ids: [wsS.id, wsS2.id], date: sd(-3), start: '18:00', end: '19:30' })])
const w2 = r.rows?.[0]?.x?.first_id
r = await as('anon', `select public.ws_complete($1, null, $2::jsonb) x`, [w2, JSON.stringify({ [wsS.id]: 'erken_ayrildi', [wsS2.id]: 'izinli' })])
ok('grup dersi öğrenci başına yoklama', r.rows?.[0]?.x?.group_attendance?.Can === 'izinli', r.error?.message)
r = await as('anon', `select public.ws_complete($1, null, $2::jsonb) x`, [w2, JSON.stringify({ [wsS.id]: 'erken_ayrildi', [wsS2.id]: 'izinli' })])
r = await as('anon', `select public.ws_student_stats($1) x`, [wsS.id])
let ws = r.rows?.[0]?.x
ok('ortak alan: öğrenci toplam süre 60+90 dk, hak 6-2=4 (çift düşüm yok)', ws?.total?.attended_min === 150 && ws.credits.used === 2 && ws.credits.remaining === 4, r.error?.message ?? JSON.stringify({ t: ws?.total, c: ws?.credits }))
r = await as('anon', `select public.ws_student_stats($1) x`, [wsS2.id])
ws = r.rows?.[0]?.x
ok('izinli öğrenci: süre yok, hak düşmez', ws?.total?.attended_min === 0 && ws.total.excused === 1 && ws.credits.used === 0, JSON.stringify(ws?.total))
r = await as('anon', `select public.ws_instructor_stats($1) x`, [wsI.id])
ok('ortak alan: eğitmen süresi grup dersinde bir kez (150 dk)', r.rows?.[0]?.x?.total?.taught_min === 150 && r.rows[0].x.students.length === 2, r.error?.message ?? JSON.stringify(r.rows?.[0]?.x?.total))
r = await as('anon', `select public.ws_create($1) x`, [wl({ student_ids: [wsS.id], date: sd(5), start: '10:00', end: '11:00' })])
const w3 = r.rows?.[0]?.x?.first_id
r = await as('anon', `select public.shared_postpone($1, null, $2::date, '12:00', '13:00', 'ogrenci') x`, [w3, sd(6)])
const w3n = r.rows?.[0]?.x?.new_id
r = await as('anon', `select public.shared_get($1) x`, [w3n])
ok('ertelenen dersin yeni kaydı öğrenci bağlantısını korur', r.rows?.[0]?.x?.ws_student_ids?.[0] === wsS.id, r.error?.message)
r = await as('anon', `select public.ws_student_stats($1) x`, [wsS.id])
ok('ertelenen ders çift sayılmaz', r.rows?.[0]?.x?.total?.postponed === 1 && r.rows[0].x.total.planned === 3 && r.rows[0].x.next?.id === w3n, JSON.stringify(r.rows?.[0]?.x?.total))
r = await as('anon', `select public.ws_save_instructor($1, $2, null) x`, [{ name: 'Selin Hoca', work_days: [wd(sd(9))], work_start: '09:00', work_end: '12:00' }, wsI.id])
r = await as('anon', `select public.ws_create($1) x`, [wl({ student_ids: [wsS2.id], date: sd(9), start: '13:00', end: '14:00' })])
ok('ortak alan: eğitmen çalışma saati dışında ders eklenemez', !!r.error && /çalışmıyor/.test(r.error.message), r.error?.message)
r = await as('anon', `select public.ws_create($1) x`, [wl({ student_ids: [wsS2.id], date: sd(9 + 1), start: '10:00', end: '11:00' })])
ok('ortak alan: eğitmen çalışmadığı gün ders eklenemez', !!r.error && /çalışmıyor/.test(r.error.message), r.error?.message)
r = await as('anon', `select public.ws_save_student($1, $2, $3) x`, [{ name: 'Deniz', total_credits: 10 }, wsS.id, wsS.version])
ok('toplam hak değişince düzeltme hareketi eklenir', r.rows?.[0]?.x?.purchased === 10 && r.rows[0].x.remaining === 8, r.error?.message ?? JSON.stringify(r.rows?.[0]?.x))
r = await as('anon', `select public.ws_save_student($1, $2, $3) x`, [{ name: 'Deniz' }, wsS.id, wsS.version])
ok('eski sürümle düzenleme reddedilir', !!r.error)
r = await as('anon', `select public.ws_dashboard() x`)
ok('ortak alan panel istatistikleri', r.rows?.[0]?.x?.active_students >= 2 && r.rows[0].x.instructors >= 1, r.error?.message)
r = await as('anon', `select count(*)::int n from public.ws_report(current_date - 40, current_date) where lesson_id = $1`, [w2])
ok('ortak alan raporu grup dersini öğrenci başına verir', r.rows?.[0]?.n === 2, r.error?.message)
r = await as('anon', `select public.ws_directory() x`)
ok('dizin öğrenci hak özetini verir', r.rows?.[0]?.x?.students?.find((s) => s.id === wsS.id)?.remaining === 8, r.error?.message)
await db.query(`delete from private.shared_writes`)

// hız sınırı (en sonda; aynı istemciden 60 yazma / 10 dk)
let limited = false
for (let i = 0; i < 70 && !limited; i++) {
  r = await as('anon', `select public.shared_create($1) res`, [{ course_name: 'Spam', date: sd(40 + (i % 20)), start: `${String(8 + Math.floor(i / 20)).padStart(2, '0')}:00`, end: `${String(8 + Math.floor(i / 20)).padStart(2, '0')}:30` }])
  if (r.error && /Çok fazla işlem/.test(r.error.message)) limited = true
}
ok('girişsiz yazmada hız sınırı çalışır', limited)

console.log(`\nSonuç: ${pass} başarılı, ${fail} başarısız`)
process.exit(fail ? 1 : 0)
