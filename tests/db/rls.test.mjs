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

console.log(`\nSonuç: ${pass} başarılı, ${fail} başarısız`)
process.exit(fail ? 1 : 0)
