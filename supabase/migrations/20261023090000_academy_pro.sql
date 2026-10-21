-- =============================================================================
-- MUTU AKADEMİ – Profesyonel ders programı, sınıflar, grup dersleri, ders hakkı
-- hareketleri, erteleme/iptal/geri alma/tamamlama işlemleri ve raporlar.
-- Geriye uyumludur: mevcut tablolar korunur, yalnızca sütun/tablo/fonksiyon eklenir.
-- =============================================================================

-- Yoklama durumları (yeni değerler bu dosyada yalnızca çalışma anında kullanılır)
alter type public.attendance_status add value if not exists 'gec_geldi';
alter type public.attendance_status add value if not exists 'erken_ayrildi';

-- -----------------------------------------------------------------------------
-- 1) Sınıflar / odalar
-- -----------------------------------------------------------------------------
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 2 and 80),
  capacity int check (capacity is null or capacity between 1 and 500),
  description text check (description is null or length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_touch before update on public.rooms for each row execute function private.touch_row();
create trigger trg_audit after insert or update or delete on public.rooms for each row execute function private.audit();
alter table public.rooms enable row level security;
create policy "rooms_select" on public.rooms for select to authenticated using ((select public.is_member()));
create policy "rooms_insert" on public.rooms for insert to authenticated with check ((select public.has_perm('lessons')));
create policy "rooms_update" on public.rooms for update to authenticated
  using ((select public.has_perm('lessons'))) with check ((select public.has_perm('lessons')));
create policy "rooms_delete" on public.rooms for delete to authenticated using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- 2) Eğitmen müsaitlik saatleri
-- -----------------------------------------------------------------------------
create table if not exists public.instructor_availability (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists instructor_availability_instructor_idx on public.instructor_availability (instructor_id, weekday);
create trigger trg_audit after insert or update or delete on public.instructor_availability for each row execute function private.audit();
alter table public.instructor_availability enable row level security;
create policy "availability_select" on public.instructor_availability for select to authenticated using ((select public.is_member()));
create policy "availability_write" on public.instructor_availability for all to authenticated
  using ((select public.is_admin()) or instructor_id = (select public.my_instructor_id()))
  with check ((select public.is_admin()) or instructor_id = (select public.my_instructor_id()));

-- -----------------------------------------------------------------------------
-- 3) Tekrarlayan ders serileri ve program içe aktarma geçmişi
-- -----------------------------------------------------------------------------
create table if not exists public.lesson_series (
  id uuid primary key default gen_random_uuid(),
  freq text not null check (freq in ('gunluk', 'haftalik', 'iki_haftalik', 'ozel')),
  weekdays smallint[] not null default '{}',
  interval_days int check (interval_days is null or interval_days between 1 and 90),
  start_date date not null,
  until_date date not null,
  start_time time not null,
  end_time time not null,
  title text,
  lesson_type text,
  instructor_id uuid references public.instructors (id) on delete set null,
  course_id uuid references public.courses (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  student_ids uuid[] not null default '{}',
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lesson_series_created_by_idx on public.lesson_series (created_by);
create index if not exists lesson_series_instructor_idx on public.lesson_series (instructor_id);
create index if not exists lesson_series_course_idx on public.lesson_series (course_id);
create index if not exists lesson_series_room_idx on public.lesson_series (room_id);
alter table public.lesson_series enable row level security;
create policy "series_select" on public.lesson_series for select to authenticated using ((select public.is_staff()));

create table if not exists public.schedule_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  total_rows int not null default 0,
  created_count int not null default 0,
  skipped_count int not null default 0,
  summary jsonb,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists schedule_imports_created_by_idx on public.schedule_imports (created_by);
create trigger trg_audit after insert on public.schedule_imports for each row execute function private.audit();
alter table public.schedule_imports enable row level security;
create policy "imports_select" on public.schedule_imports for select to authenticated using ((select public.has_perm('lessons')));

-- İdempotency: aynı istek kimliğiyle tekrar gelen işlem ikinci kez uygulanmaz
create table if not exists private.request_log (
  ref uuid primary key,
  fn text not null,
  result jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4) Ders tablosu: konu, sınıf, tür, seri, grup, notlar, erteleme nedeni
-- -----------------------------------------------------------------------------
alter table public.lessons
  add column if not exists title text check (title is null or length(title) <= 120),
  add column if not exists room_id uuid references public.rooms (id) on delete set null,
  add column if not exists lesson_type text not null default 'bireysel' check (lesson_type in ('bireysel', 'grup', 'online')),
  add column if not exists series_id uuid references public.lesson_series (id) on delete set null,
  add column if not exists group_id uuid,
  add column if not exists instructor_note text check (instructor_note is null or length(instructor_note) <= 2000),
  add column if not exists admin_note text check (admin_note is null or length(admin_note) <= 2000),
  add column if not exists postpone_reason text check (postpone_reason is null or postpone_reason in ('ogrenci', 'egitmen', 'tatil', 'saglik', 'kurum', 'diger')),
  add column if not exists import_id uuid references public.schedule_imports (id) on delete set null;
create index if not exists lessons_room_idx on public.lessons (room_id, starts_at);
create index if not exists lessons_series_idx on public.lessons (series_id, starts_at);
create index if not exists lessons_group_idx on public.lessons (group_id);
create index if not exists lessons_import_idx on public.lessons (import_id);

-- Grup dersi: aynı eğitmen/sınıf aynı grubun öğrencileriyle aynı saatte olabilir; başka derslerle çakışamaz
alter table public.lessons drop constraint if exists lessons_no_instructor_overlap;
alter table public.lessons add constraint lessons_no_instructor_overlap exclude using gist (
  instructor_id with =, tstzrange(starts_at, ends_at) with &&, (coalesce(group_id, id)) with <>
) where (status in ('planlandi', 'tamamlandi') and instructor_id is not null);
alter table public.lessons drop constraint if exists lessons_no_room_overlap;
alter table public.lessons add constraint lessons_no_room_overlap exclude using gist (
  room_id with =, tstzrange(starts_at, ends_at) with &&, (coalesce(group_id, id)) with <>
) where (status in ('planlandi', 'tamamlandi') and room_id is not null);

-- -----------------------------------------------------------------------------
-- 5) Ders hakkı hareketleri (paketler ve düzeltmeler)
--    Toplam hak = iptal edilmemiş paket/düzeltme toplamı; kullanılan hak = gerçekleşen dersler.
-- -----------------------------------------------------------------------------
create table if not exists public.lesson_packages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  kind text not null default 'paket' check (kind in ('paket', 'duzeltme')),
  name text not null default 'Ders paketi' check (length(btrim(name)) between 1 and 80),
  lesson_count int not null check (lesson_count between -500 and 500 and lesson_count <> 0),
  price numeric(12, 2) not null default 0 check (price >= 0),
  fee_added boolean not null default false,
  purchased_at date not null default (now() at time zone 'Europe/Istanbul')::date,
  note text check (note is null or length(note) <= 500),
  is_void boolean not null default false,
  void_reason text,
  voided_at timestamptz,
  client_ref uuid unique,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (kind = 'duzeltme' or lesson_count > 0)
);
create index if not exists lesson_packages_student_idx on public.lesson_packages (student_id, created_at);
create index if not exists lesson_packages_created_by_idx on public.lesson_packages (created_by);
create trigger trg_audit after insert or update or delete on public.lesson_packages for each row execute function private.audit();
alter table public.lesson_packages enable row level security;
create policy "packages_select" on public.lesson_packages for select to authenticated
  using ((select public.is_staff()) or public.can_view_student(student_id));

create or replace function private.refresh_total_lessons(p_student uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare total int;
begin
  select greatest(0, coalesce(sum(lesson_count), 0))::int into total
  from public.lesson_packages where student_id = p_student and not is_void;
  perform set_config('mutu.pkg', 'on', true);
  update public.students set total_lessons = total where id = p_student and total_lessons <> total;
  perform set_config('mutu.pkg', 'off', true);
end $$;

create or replace function private.on_package_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('mutu.pkg_skip', true), '') = 'on' then return null; end if;
  perform private.refresh_total_lessons(coalesce(new.student_id, old.student_id));
  return null;
end $$;
create trigger trg_package_total after insert or update or delete on public.lesson_packages
  for each row execute function private.on_package_change();

-- Öğrenci formundan toplam hak değiştirilirse fark "Elle düzeltme" hareketi olarak kaydedilir
create or replace function private.guard_student_total()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.total_lessons is distinct from old.total_lessons and coalesce(current_setting('mutu.pkg', true), '') <> 'on' then
    perform set_config('mutu.pkg_skip', 'on', true);
    insert into public.lesson_packages (student_id, kind, name, lesson_count)
    values (new.id, 'duzeltme', 'Elle düzeltme', new.total_lessons - old.total_lessons);
    perform set_config('mutu.pkg_skip', 'off', true);
  end if;
  return new;
end $$;
create trigger trg_guard_student_total before update on public.students
  for each row execute function private.guard_student_total();

create or replace function private.on_student_initial_package()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.total_lessons > 0 then
    perform set_config('mutu.pkg_skip', 'on', true);
    insert into public.lesson_packages (student_id, kind, name, lesson_count)
    values (new.id, 'paket', 'Başlangıç paketi', new.total_lessons);
    perform set_config('mutu.pkg_skip', 'off', true);
  end if;
  return null;
end $$;
create trigger trg_student_initial_package after insert on public.students
  for each row execute function private.on_student_initial_package();

-- Mevcut öğrencilerin hakları hareket olarak aktarılır (veri kaybı yok)
insert into public.lesson_packages (student_id, kind, name, lesson_count)
select s.id, 'paket', 'Başlangıç paketi', s.total_lessons
from public.students s
where s.total_lessons > 0 and not exists (select 1 from public.lesson_packages p where p.student_id = s.id);

create or replace function public.add_lesson_package(
  p_student_id uuid, p_name text, p_lesson_count int, p_price numeric default 0,
  p_add_fee boolean default true, p_note text default null, p_kind text default 'paket', p_request_id uuid default null)
returns public.lesson_packages
language plpgsql security definer set search_path = '' as $$
declare r public.lesson_packages;
begin
  if not public.has_perm('students') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  if p_request_id is not null then
    select * into r from public.lesson_packages where client_ref = p_request_id;
    if found then return r; end if;
  end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception 'Öğrenci bulunamadı.' using errcode = 'P0002';
  end if;
  insert into public.lesson_packages (student_id, kind, name, lesson_count, price, fee_added, note, client_ref)
  values (p_student_id, coalesce(p_kind, 'paket'), coalesce(nullif(btrim(p_name), ''), 'Ders paketi'), p_lesson_count,
          coalesce(p_price, 0), coalesce(p_add_fee, false) and coalesce(p_price, 0) > 0, nullif(btrim(p_note), ''), p_request_id)
  returning * into r;
  if r.fee_added then
    update public.students set total_fee = total_fee + r.price where id = p_student_id;
  end if;
  return r;
end $$;

create or replace function public.void_lesson_package(p_package_id uuid, p_reason text)
returns public.lesson_packages
language plpgsql security definer set search_path = '' as $$
declare r public.lesson_packages;
begin
  if not public.has_perm('students') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'İptal nedeni yazın.' using errcode = 'P0001'; end if;
  select * into r from public.lesson_packages where id = p_package_id for update;
  if not found then raise exception 'Kayıt bulunamadı.' using errcode = 'P0002'; end if;
  if r.is_void then return r; end if;
  update public.lesson_packages set is_void = true, void_reason = btrim(p_reason), voided_at = now()
  where id = p_package_id returning * into r;
  if r.fee_added then
    update public.students set total_fee = greatest(0, total_fee - r.price) where id = r.student_id;
  end if;
  return r;
end $$;

-- Ödemelerde çift kayıt önleme (istemci tarafından üretilen tekil istek kimliği)
alter table public.payments add column if not exists client_ref uuid unique;

-- -----------------------------------------------------------------------------
-- 6) Yardımcılar: Türkçe saat ekleri, kurs adı, ders etiketi
-- -----------------------------------------------------------------------------
-- "14.00'te", "16.00'da", "16.00'ya", "14.30'a" gibi doğru Türkçe ekler
create or replace function private.tr_saat(t timestamptz, ek text default null)
returns text language plpgsql stable set search_path = '' as $$
declare
  hh int := extract(hour from t at time zone 'Europe/Istanbul');
  mm int := extract(minute from t at time zone 'Europe/Istanbul');
  s text := to_char(t at time zone 'Europe/Istanbul', 'HH24.MI');
  w text;
  ones text[] := array['bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
  tens text[] := array['on', 'yirmi', 'otuz', 'kırk', 'elli'];
begin
  if ek is null then return s; end if;
  if mm = 0 then
    w := case when hh = 0 then 'sıfır' when hh % 10 <> 0 then ones[hh % 10] else tens[hh / 10] end;
  else
    w := case when mm % 10 <> 0 then ones[mm % 10] else tens[mm / 10] end;
  end if;
  if ek = 'loc' then
    return s || '''' || case w when 'üç' then 'te' when 'dört' then 'te' when 'beş' then 'te' when 'kırk' then 'ta'
      when 'altı' then 'da' when 'dokuz' then 'da' when 'on' then 'da' when 'otuz' then 'da' when 'sıfır' then 'da' else 'de' end;
  end if;
  return s || '''' || case w when 'iki' then 'ye' when 'yedi' then 'ye' when 'yirmi' then 'ye' when 'elli' then 'ye'
    when 'altı' then 'ya' when 'dokuz' then 'a' when 'on' then 'a' when 'otuz' then 'a' when 'kırk' then 'a' when 'sıfır' then 'a' else 'e' end;
end $$;

create or replace function private.tr_tarih(t timestamptz)
returns text language sql stable set search_path = '' as $$
  select extract(day from t at time zone 'Europe/Istanbul')::int || ' '
    || (array['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'])
       [extract(month from t at time zone 'Europe/Istanbul')::int]
$$;

create or replace function private.course_label(l public.lessons)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(l.title), ''), (select c.name from public.courses c where c.id = l.course_id), 'Ders')
$$;

create or replace function private.public_lesson_text(l public.lessons)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select c.name from public.courses c where c.id = l.course_id), 'Ders')
         || ' saat ' || private.tr_saat(l.starts_at, 'loc') || ' başlayacak.'
$$;

-- Grup dersinde tek temsilci satır (bildirimler bir kez gönderilir)
create or replace function private.is_group_lead(l public.lessons)
returns boolean language sql stable security definer set search_path = '' as $$
  select l.group_id is null or l.id = (
    select l2.id from public.lessons l2 where l2.group_id = l.group_id order by l2.id limit 1)
$$;

create or replace function private.group_label(l public.lessons)
returns text language sql stable security definer set search_path = '' as $$
  select case when l.group_id is null then (select s.full_name from public.students s where s.id = l.student_id)
    else (select count(*) || ' öğrenci' from public.lessons l2 where l2.group_id = l.group_id) end
$$;

-- -----------------------------------------------------------------------------
-- 7) Hatırlatma metinleri ve kuyruk (ertelenen/iptal dersler için gönderilmez, grup dersi tek bildirim)
-- -----------------------------------------------------------------------------
create or replace function private.lesson_reminder_text(l public.lessons, minutes int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', 'MUTU AKADEMİ – Ders Hatırlatması',
    'body', private.course_label(l) || ' saat ' || private.tr_saat(l.starts_at, 'loc') || ' başlayacak. '
            || 'Dersin başlamasına ' || case when minutes = 60 then '1 saat' else minutes || ' dakika' end || ' kaldı.'
            || coalesce(E'\n' || case when l.group_id is null then 'Öğrenci: ' else 'Grup: ' end || private.group_label(l), ''),
    'url', '/ders/' || l.id)
$$;

create or replace function private.enqueue_lesson_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; k record; l public.lessons; txt jsonb; c int;
begin
  for k in select * from (values ('lesson_60', 60), ('lesson_15', 15)) v(kind, minutes) loop
    for l in
      select * from public.lessons x
      where x.status = 'planlandi' and x.started_at is null
        and x.starts_at > now() + make_interval(mins => k.minutes - 2)
        and x.starts_at <= now() + make_interval(mins => k.minutes)
        and private.is_group_lead(x)
    loop
      txt := private.lesson_reminder_text(l, k.minutes);
      insert into public.push_deliveries (subscription_id, user_id, kind, lesson_id, lesson_starts_at, title, body, url)
      select ps.id, p.id, k.kind, l.id, l.starts_at, txt ->> 'title', txt ->> 'body', txt ->> 'url'
      from public.push_subscriptions ps
      join public.profiles p on p.id = ps.user_id
      where not ps.is_public and p.is_active and p.approved
        and (p.role = 'admin'
             or (p.role = 'personel' and coalesce((p.permissions ->> 'lessons')::boolean, false))
             or p.id = (select i.profile_id from public.instructors i where i.id = l.instructor_id))
        and private.rule_on(k.kind, p.notification_prefs)
        and not private.in_quiet_hours(p.notification_prefs)
      on conflict do nothing;
      get diagnostics c = row_count;
      n := n + c;

      if k.kind = 'lesson_60' and private.rule_on('lesson_60', '{}'::jsonb) then
        insert into public.push_deliveries (subscription_id, user_id, kind, lesson_id, lesson_starts_at, title, body, url)
        select ps.id, null, k.kind, l.id, l.starts_at, 'MUTU AKADEMİ – Ders Hatırlatması',
               private.public_lesson_text(l) || ' Dersin başlamasına 1 saat kaldı.', '/'
        from public.push_subscriptions ps
        where ps.is_public
        on conflict do nothing;
        get diagnostics c = row_count;
        n := n + c;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- Herkese açık abonelere tek bir bildirim (kişisel veri yok)
create or replace function private.public_push(p_kind text, p_title text, p_body text, p_lesson uuid, p_starts timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into public.push_deliveries (subscription_id, user_id, kind, lesson_id, lesson_starts_at, title, body, url)
  select ps.id, null, p_kind, p_lesson, p_starts, 'MUTU AKADEMİ – ' || p_title, p_body, '/'
  from public.push_subscriptions ps where ps.is_public
  on conflict do nothing
$$;

-- Toplu işlemlerde (seri, grup, erteleme) satır başına bildirim yerine işlemin kendisi tek özet gönderir
create or replace function private.bulk_on()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('mutu.bulk', true), '') = 'on'
$$;

create or replace function private.on_lesson_public_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare kind text; title text; body text; ref timestamptz;
begin
  if private.bulk_on() then return null; end if;
  ref := coalesce(new.starts_at, old.starts_at);
  if ref < now() or ref > now() + interval '7 days' then return null; end if;
  if new.group_id is not null then
    if tg_op = 'INSERT' and exists (select 1 from public.lessons x where x.group_id = new.group_id and x.id <> new.id) then return null; end if;
    if tg_op = 'UPDATE' and not private.is_group_lead(new) then return null; end if;
  end if;
  if tg_op = 'INSERT' and new.status = 'planlandi' and new.rescheduled_from is null then
    kind := 'pub_new'; title := 'Yeni ders oluşturuldu';
    body := private.public_lesson_text(new) || ' (' || private.tr_tarih(new.starts_at) || ')';
  elsif tg_op = 'UPDATE' and new.status = 'iptal' and old.status <> 'iptal' then
    kind := 'pub_cancel'; title := 'Ders iptal edildi';
    body := coalesce((select c.name from public.courses c where c.id = new.course_id), 'Ders') || ' – '
            || private.tr_tarih(new.starts_at) || ' ' || private.tr_saat(new.starts_at) || ' dersi iptal edildi.';
  elsif tg_op = 'UPDATE' and new.status = 'planlandi' and new.starts_at <> old.starts_at then
    kind := 'pub_time'; title := 'Ders saati değiştirildi';
    body := 'Ders programı güncellendi. ' || coalesce((select c.name from public.courses c where c.id = new.course_id), 'Ders')
            || ' ' || private.tr_saat(old.starts_at) || ' yerine ' || private.tr_saat(new.starts_at, 'dat') || ' alındı.';
  else
    return null;
  end if;
  perform private.public_push(kind, title, body, new.id, new.starts_at);
  return null;
end $$;

create or replace function private.on_lesson_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text; link text;
begin
  if tg_op <> 'UPDATE' or private.bulk_on() or not private.is_group_lead(new) then return new; end if;
  who := private.group_label(new);
  link := '/takvim?tarih=' || to_char(new.starts_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD');
  if new.status = 'iptal' and old.status <> 'iptal' then
    perform private.notify(array['admin', 'personel']::public.app_role[], new.instructor_id,
      'ders_iptal', 'Ders iptal edildi',
      private.course_label(new) || ' – ' || coalesce(who, 'Öğrenci') || ', ' || private.tr_tarih(new.starts_at) || ' '
        || private.tr_saat(new.starts_at) || coalesce(' (' || new.status_reason || ')', ''), link);
  elsif new.status = 'planlandi' and (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at
        or new.instructor_id is distinct from old.instructor_id) then
    perform private.notify(array['admin', 'personel']::public.app_role[], new.instructor_id,
      'ders_degisiklik', 'Ders saati değiştirildi',
      'Ders programı güncellendi. ' || private.course_label(new) || ' (' || coalesce(who, 'Öğrenci') || ') '
        || private.tr_tarih(old.starts_at) || ' ' || private.tr_saat(old.starts_at) || ' yerine '
        || private.tr_tarih(new.starts_at) || ' ' || private.tr_saat(new.starts_at, 'dat') || ' alındı.', link);
    if old.instructor_id is distinct from new.instructor_id and old.instructor_id is not null then
      perform private.notify(array[]::public.app_role[], old.instructor_id,
        'ders_degisiklik', 'Ders başka eğitmene aktarıldı',
        private.course_label(new) || ' – ' || coalesce(who, 'Öğrenci') || ', ' || private.tr_tarih(new.starts_at) || ' ' || private.tr_saat(new.starts_at), '/takvim');
    end if;
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 8) Ders hakkı: katıldı / geç geldi / erken ayrıldı hak düşürür; katılmadı ayara göre; izinli düşürmez
-- -----------------------------------------------------------------------------
create or replace function private.consumes(p_status text, p_att text, p_absence boolean)
returns boolean language sql immutable set search_path = '' as $$
  select p_status = 'tamamlandi' and p_att is not null
     and (p_att in ('katildi', 'gec_geldi', 'erken_ayrildi') or (p_att = 'katilmadi' and p_absence))
$$;

create or replace function private.refresh_student_usage(p_student uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  absence_counts boolean; threshold int; before_remaining int; after_remaining int; s record;
begin
  if p_student is null then return; end if;
  select absence_consumes_credit, low_credit_threshold into absence_counts, threshold from public.app_settings where id = 1;
  select remaining_lessons into before_remaining from public.students where id = p_student for update;

  update public.lessons l
  set credit_used = private.consumes(l2.status::text, a.status::text, absence_counts)
  from public.lessons l2
  left join public.attendance a on a.lesson_id = l2.id
  where l.id = l2.id and l.student_id = p_student
    and l.credit_used is distinct from private.consumes(l2.status::text, a.status::text, absence_counts);

  update public.students st
  set used_lessons = (select count(*) from public.lessons l where l.student_id = p_student and l.credit_used)
  where st.id = p_student
    and st.used_lessons <> (select count(*) from public.lessons l where l.student_id = p_student and l.credit_used);

  select * into s from public.students where id = p_student;
  after_remaining := s.remaining_lessons;
  if s.total_lessons > 0 and after_remaining <= threshold
     and (before_remaining is null or before_remaining > threshold or after_remaining < before_remaining) then
    perform private.notify(array['admin', 'personel']::public.app_role[], s.instructor_id,
      'dusuk_ders_hakki', 'Ders hakkı azaldı',
      s.full_name || ' için kalan ders hakkı: ' || after_remaining,
      '/ogrenciler/' || s.id, 'low:' || s.id || ':' || after_remaining, true);
  end if;
end $$;

-- Yoklama dersin planlama durumundan ayrıdır: yoklama alınan ders "tamamlandı" olur, izinli öğrenciye hak düşmez
create or replace function public.mark_attendance(
  p_lesson_id uuid, p_status public.attendance_status, p_expected_version int, p_note text default null)
returns public.lessons
language plpgsql security definer set search_path = '' as $$
declare l public.lessons;
begin
  select * into l from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if not (public.has_perm('lessons') or (l.instructor_id is not null and l.instructor_id = public.my_instructor_id())) then
    raise exception 'Bu ders için yoklama yetkiniz yok.' using errcode = '42501';
  end if;
  if p_expected_version is not null and l.version <> p_expected_version then
    raise exception 'Bu ders başka bir cihazda güncellendi. Lütfen yenileyip tekrar deneyin.' using errcode = '40001';
  end if;
  if l.status in ('iptal', 'ertelendi') then
    raise exception 'İptal edilmiş veya ertelenmiş derse yoklama girilemez.' using errcode = 'P0001';
  end if;
  insert into public.attendance (lesson_id, student_id, status, note, marked_by, marked_at)
  values (l.id, l.student_id, p_status, nullif(btrim(p_note), ''), auth.uid(), now())
  on conflict (lesson_id) do update
    set status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = now();
  update public.lessons set status = 'tamamlandi' where id = l.id and status <> 'tamamlandi';
  perform private.refresh_student_usage(l.student_id);
  select * into l from public.lessons where id = p_lesson_id;
  return l;
end $$;

-- -----------------------------------------------------------------------------
-- 9) Ders planlama: tekrar kuralı, çakışma/müsaitlik ön kontrolü, oluşturma
-- -----------------------------------------------------------------------------
create or replace function private.expand_dates(p_date date, p_repeat jsonb)
returns setof date language plpgsql stable set search_path = '' as $$
declare
  freq text := coalesce(p_repeat ->> 'freq', 'yok');
  until date; d date; ok boolean; cnt int := 0; wds int[]; iv int;
  week0 date := p_date - (extract(isodow from p_date)::int - 1);
begin
  if freq = 'yok' or freq = '' then return next p_date; return; end if;
  until := (p_repeat ->> 'until')::date;
  if until is null or until < p_date then raise exception 'Tekrar bitiş tarihi geçersiz.' using errcode = '22023'; end if;
  if until - p_date > 370 then raise exception 'Tekrar en fazla 1 yıl olabilir.' using errcode = '22023'; end if;
  wds := array(select jsonb_array_elements_text(coalesce(p_repeat -> 'weekdays', '[]'::jsonb))::int);
  if coalesce(array_length(wds, 1), 0) = 0 then wds := array[extract(isodow from p_date)::int]; end if;
  iv := coalesce((p_repeat ->> 'interval_days')::int, 7);
  if freq = 'ozel' and (iv < 1 or iv > 90) then raise exception 'Tekrar aralığı 1–90 gün olmalı.' using errcode = '22023'; end if;
  d := p_date;
  while d <= until loop
    ok := case freq
      when 'gunluk' then true
      when 'haftalik' then extract(isodow from d)::int = any (wds)
      when 'iki_haftalik' then extract(isodow from d)::int = any (wds) and ((d - week0) / 7) % 2 = 0
      when 'ozel' then (d - p_date) % iv = 0
      else false end;
    if ok then
      cnt := cnt + 1;
      if cnt > 400 then raise exception 'En fazla 400 ders oluşturulabilir.' using errcode = '22023'; end if;
      return next d;
    end if;
    d := d + 1;
  end loop;
end $$;

-- Bir zaman aralığı için engel (çakışma) ve uyarıları döndürür
create or replace function private.slot_issues(
  p_students uuid[], p_instructor uuid, p_room uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare conflicts text[] := '{}'; warnings text[] := '{}'; r record; wd int; st time; et time;
begin
  for r in
    select distinct on (l.id) l.*, s.full_name sname
    from public.lessons l left join public.students s on s.id = l.student_id
    where l.status in ('planlandi', 'tamamlandi') and tstzrange(l.starts_at, l.ends_at) && tstzrange(p_start, p_end)
      and not (l.id = any (p_exclude))
      and ((p_instructor is not null and l.instructor_id = p_instructor)
           or (p_room is not null and l.room_id = p_room)
           or l.student_id = any (p_students))
    limit 10
  loop
    if p_instructor is not null and r.instructor_id = p_instructor then
      conflicts := conflicts || ('Eğitmenin ' || private.tr_saat(r.starts_at) || '–' || private.tr_saat(r.ends_at) || ' arasında başka dersi var');
    end if;
    if p_room is not null and r.room_id = p_room then
      conflicts := conflicts || ('Sınıf ' || private.tr_saat(r.starts_at) || '–' || private.tr_saat(r.ends_at) || ' arasında dolu');
    end if;
    if r.student_id = any (p_students) then
      conflicts := conflicts || (coalesce(r.sname, 'Öğrenci') || ' bu saatte başka derste');
    end if;
  end loop;
  if p_instructor is not null and exists (select 1 from public.instructor_availability a where a.instructor_id = p_instructor) then
    wd := extract(isodow from p_start at time zone 'Europe/Istanbul')::int;
    st := (p_start at time zone 'Europe/Istanbul')::time;
    et := (p_end at time zone 'Europe/Istanbul')::time;
    if not exists (select 1 from public.instructor_availability a
                   where a.instructor_id = p_instructor and a.weekday = wd and a.start_time <= st and a.end_time >= et) then
      warnings := warnings || 'Eğitmenin çalışma saatleri dışında'::text;
    end if;
  end if;
  if p_start < now() then warnings := warnings || 'Geçmiş tarihli ders'::text; end if;
  return jsonb_build_object('conflicts', to_jsonb(array(select distinct unnest(conflicts))), 'warnings', to_jsonb(warnings));
end $$;

-- p: {student_ids[], instructor_id, course_id, room_id, title, lesson_type, date, start, end, repeat{freq,weekdays,interval_days,until}, notes, instructor_note, admin_note}
create or replace function private.lesson_plan_input(p jsonb, p_allow_empty boolean default false, out students uuid[], out instructor uuid, out course uuid, out room uuid,
  out ltype text, out t_start time, out t_end time, out d0 date)
language plpgsql stable security definer set search_path = '' as $$
declare cap int; n int;
begin
  students := array(select distinct jsonb_array_elements_text(coalesce(p -> 'student_ids', '[]'::jsonb))::uuid);
  n := coalesce(array_length(students, 1), 0);
  if n = 0 and not p_allow_empty then raise exception 'En az bir öğrenci seçin.' using errcode = 'P0001'; end if;
  if n > 40 then raise exception 'Bir derse en fazla 40 öğrenci eklenebilir.' using errcode = 'P0001'; end if;
  if (select count(*) from public.students s where s.id = any (students)) <> n then
    raise exception 'Seçilen öğrencilerden biri bulunamadı.' using errcode = 'P0002';
  end if;
  instructor := nullif(p ->> 'instructor_id', '')::uuid;
  course := nullif(p ->> 'course_id', '')::uuid;
  if course is null and n = 1 then select s.course_id into course from public.students s where s.id = students[1]; end if;
  ltype := coalesce(nullif(p ->> 'lesson_type', ''), 'bireysel');
  if ltype not in ('bireysel', 'grup', 'online') then raise exception 'Geçersiz ders türü.' using errcode = '22023'; end if;
  if ltype = 'bireysel' and n > 1 then ltype := 'grup'; end if;
  room := case when ltype = 'online' then null else nullif(p ->> 'room_id', '')::uuid end;
  if room is not null then
    select capacity into cap from public.rooms where id = room;
    if not found then raise exception 'Sınıf bulunamadı.' using errcode = 'P0002'; end if;
    if cap is not null and n > cap then raise exception 'Sınıf kapasitesi (%) öğrenci sayısından az.', cap using errcode = 'P0001'; end if;
  end if;
  d0 := (p ->> 'date')::date;
  t_start := (p ->> 'start')::time;
  t_end := (p ->> 'end')::time;
  if d0 is null or t_start is null or t_end is null then raise exception 'Tarih ve saat zorunludur.' using errcode = '22023'; end if;
  if t_end <= t_start then raise exception 'Bitiş saati başlangıç saatinden sonra olmalı.' using errcode = '22023'; end if;
end $$;

create or replace function public.preview_lessons(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i record; d date; s timestamptz; e timestamptz; items jsonb := '[]'::jsonb; iss jsonb; nconf int := 0; nwarn int := 0; total int := 0;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  select * into i from private.lesson_plan_input(p);
  for d in select * from private.expand_dates(i.d0, p -> 'repeat') loop
    s := (d + i.t_start) at time zone 'Europe/Istanbul';
    e := (d + i.t_end) at time zone 'Europe/Istanbul';
    iss := private.slot_issues(i.students, i.instructor, i.room, s, e);
    total := total + 1;
    if jsonb_array_length(iss -> 'conflicts') > 0 then nconf := nconf + 1; end if;
    if jsonb_array_length(iss -> 'warnings') > 0 then nwarn := nwarn + 1; end if;
    if jsonb_array_length(items) < 400 then
      items := items || jsonb_build_object('starts_at', s, 'ends_at', e, 'conflicts', iss -> 'conflicts', 'warnings', iss -> 'warnings');
    end if;
  end loop;
  return jsonb_build_object('count', total, 'conflict_count', nconf, 'warning_count', nwarn,
    'students', coalesce(array_length(i.students, 1), 0), 'lesson_type', i.ltype, 'occurrences', items);
end $$;

create or replace function public.create_lessons(p jsonb, p_skip_conflicts boolean default false, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  i record; d date; s timestamptz; e timestamptz; iss jsonb; gid uuid; sid uuid; series uuid; created int := 0; skipped int := 0;
  first_id uuid; new_id uuid; res jsonb; n int; occ int := 0; title text; first_l public.lessons;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  if p_request_id is not null then
    insert into private.request_log (ref, fn) values (p_request_id, 'create_lessons') on conflict (ref) do nothing;
    get diagnostics n = row_count;
    if n = 0 then
      select result into res from private.request_log where ref = p_request_id;
      return coalesce(res, jsonb_build_object('created', 0, 'skipped', 0, 'duplicate', true));
    end if;
  end if;
  select * into i from private.lesson_plan_input(p);
  title := nullif(btrim(p ->> 'title'), '');
  perform set_config('mutu.bulk', 'on', true);

  if coalesce(p -> 'repeat' ->> 'freq', 'yok') not in ('yok', '') then
    insert into public.lesson_series (freq, weekdays, interval_days, start_date, until_date, start_time, end_time,
      title, lesson_type, instructor_id, course_id, room_id, student_ids)
    values (p -> 'repeat' ->> 'freq',
      array(select jsonb_array_elements_text(coalesce(p -> 'repeat' -> 'weekdays', '[]'::jsonb))::smallint),
      nullif(p -> 'repeat' ->> 'interval_days', '')::int, i.d0, (p -> 'repeat' ->> 'until')::date, i.t_start, i.t_end,
      title, i.ltype, i.instructor, i.course, i.room, i.students)
    returning id into series;
  end if;

  for d in select * from private.expand_dates(i.d0, p -> 'repeat') loop
    occ := occ + 1;
    s := (d + i.t_start) at time zone 'Europe/Istanbul';
    e := (d + i.t_end) at time zone 'Europe/Istanbul';
    iss := private.slot_issues(i.students, i.instructor, i.room, s, e);
    if jsonb_array_length(iss -> 'conflicts') > 0 then
      if p_skip_conflicts then skipped := skipped + 1; continue; end if;
      raise exception 'Çakışma (%): %', private.tr_tarih(s) || ' ' || private.tr_saat(s), iss -> 'conflicts' ->> 0 using errcode = 'P0001';
    end if;
    gid := case when array_length(i.students, 1) > 1 then gen_random_uuid() end;
    begin
      foreach sid in array i.students loop
        insert into public.lessons (student_id, instructor_id, course_id, room_id, lesson_type, title, series_id, group_id,
          starts_at, ends_at, notes, instructor_note, admin_note)
        values (sid, i.instructor, coalesce(i.course, (select st.course_id from public.students st where st.id = sid)), i.room, i.ltype, title,
          series, gid, s, e, nullif(btrim(p ->> 'notes'), ''), nullif(btrim(p ->> 'instructor_note'), ''), nullif(btrim(p ->> 'admin_note'), ''))
        returning id into new_id;
        first_id := coalesce(first_id, new_id);
      end loop;
      created := created + 1;
    exception when exclusion_violation then
      if p_skip_conflicts then skipped := skipped + 1;
      else raise exception 'Çakışma (%): seçilen saatte eğitmen, sınıf veya öğrenci dolu.', private.tr_tarih(s) || ' ' || private.tr_saat(s) using errcode = 'P0001';
      end if;
    end;
  end loop;

  if created = 0 then raise exception 'Hiç ders oluşturulamadı: tüm tarihler çakışıyor.' using errcode = 'P0001'; end if;

  select * into first_l from public.lessons where id = first_id;
  perform private.notify(array['admin', 'personel']::public.app_role[], i.instructor, 'ders_yeni', 'Yeni ders oluşturuldu',
    private.course_label(first_l) || ' – ' || coalesce(private.group_label(first_l), 'Öğrenci') || ', '
      || private.tr_tarih(first_l.starts_at) || ' ' || private.tr_saat(first_l.starts_at)
      || case when created > 1 then ' (toplam ' || created || ' ders)' else '' end,
    '/ders/' || first_id);
  if first_l.starts_at > now() and first_l.starts_at < now() + interval '7 days' then
    perform private.public_push('pub_new', 'Yeni ders oluşturuldu',
      private.public_lesson_text(first_l) || ' (' || private.tr_tarih(first_l.starts_at) || ')'
        || case when created > 1 then ' Toplam ' || created || ' ders programa eklendi.' else '' end,
      first_id, first_l.starts_at);
  end if;
  perform set_config('mutu.bulk', 'off', true);

  res := jsonb_build_object('created', created, 'skipped', skipped, 'series_id', series, 'first_lesson_id', first_id, 'occurrences', occ);
  if p_request_id is not null then update private.request_log set result = res where ref = p_request_id; end if;
  return res;
end $$;

-- -----------------------------------------------------------------------------
-- 10) Seri / grup kapsamı: yalnızca bu ders, bu ve sonrakiler, tüm seri
--     Geçmiş ve tamamlanmış dersler toplu değişikliklerden ETKİLENMEZ.
-- -----------------------------------------------------------------------------
create or replace function private.scope_ids(t public.lessons, p_scope text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(l.id order by l.starts_at), '{}') from public.lessons l
  where l.status = 'planlandi' and (
    case
      when coalesce(p_scope, 'this') = 'this' or t.series_id is null then coalesce(l.group_id, l.id) = coalesce(t.group_id, t.id)
      when p_scope = 'following' then l.series_id = t.series_id and l.starts_at >= t.starts_at
      else l.series_id = t.series_id and l.starts_at >= least(t.starts_at, now())
    end)
$$;

create or replace function public.preview_lesson_scope(p_lesson_id uuid, p_scope text)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, student_name text, status public.lesson_status)
language plpgsql stable security definer set search_path = '' as $$
declare t public.lessons;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  select * into t from public.lessons where lessons.id = p_lesson_id;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  return query
  select l.id, l.starts_at, l.ends_at, s.full_name, l.status
  from public.lessons l left join public.students s on s.id = l.student_id
  where l.id = any (private.scope_ids(t, p_scope))
  order by l.starts_at, s.full_name;
end $$;

-- p_changes: {date, start, end, instructor_id, room_id, course_id, title, lesson_type, notes, instructor_note, admin_note}
create or replace function public.update_lessons(p_lesson_id uuid, p_expected_version int, p_changes jsonb, p_scope text default 'this')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.lessons; ids uuid[]; n int; cap int; cnt int; c jsonb := coalesce(p_changes, '{}'::jsonb);
  new_start time; new_end time; first_new public.lessons; time_changed boolean;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  select * into t from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if p_expected_version is not null and t.version <> p_expected_version then
    raise exception 'Bu ders başka bir cihazda güncellendi. Lütfen yenileyip tekrar deneyin.' using errcode = '40001';
  end if;
  if t.status <> 'planlandi' then raise exception 'Yalnızca planlanmış dersler düzenlenebilir.' using errcode = 'P0001'; end if;
  ids := private.scope_ids(t, p_scope);
  perform 1 from public.lessons where id = any (ids) for update;

  new_start := coalesce(nullif(c ->> 'start', '')::time, (t.starts_at at time zone 'Europe/Istanbul')::time);
  new_end := coalesce(nullif(c ->> 'end', '')::time, (t.ends_at at time zone 'Europe/Istanbul')::time);
  if new_end <= new_start then raise exception 'Bitiş saati başlangıç saatinden sonra olmalı.' using errcode = '22023'; end if;
  if c ? 'room_id' and nullif(c ->> 'room_id', '') is not null then
    select capacity into cap from public.rooms where id = (c ->> 'room_id')::uuid;
    select max(k) into cnt from (select count(*) k from public.lessons where id = any (ids) group by coalesce(group_id, id)) z;
    if cap is not null and cnt > cap then raise exception 'Sınıf kapasitesi (%) öğrenci sayısından az.', cap using errcode = 'P0001'; end if;
  end if;

  perform set_config('mutu.bulk', 'on', true);
  begin
    update public.lessons l set
      starts_at = ((case when coalesce(p_scope, 'this') = 'this' and nullif(c ->> 'date', '') is not null then (c ->> 'date')::date
                    else (l.starts_at at time zone 'Europe/Istanbul')::date end) + new_start) at time zone 'Europe/Istanbul',
      ends_at = ((case when coalesce(p_scope, 'this') = 'this' and nullif(c ->> 'date', '') is not null then (c ->> 'date')::date
                  else (l.starts_at at time zone 'Europe/Istanbul')::date end) + new_end) at time zone 'Europe/Istanbul',
      instructor_id = case when c ? 'instructor_id' then nullif(c ->> 'instructor_id', '')::uuid else l.instructor_id end,
      room_id = case when coalesce(c ->> 'lesson_type', l.lesson_type) = 'online' then null
                     when c ? 'room_id' then nullif(c ->> 'room_id', '')::uuid else l.room_id end,
      course_id = case when c ? 'course_id' then nullif(c ->> 'course_id', '')::uuid else l.course_id end,
      title = case when c ? 'title' then nullif(btrim(c ->> 'title'), '') else l.title end,
      lesson_type = case when c ? 'lesson_type' and c ->> 'lesson_type' in ('bireysel', 'grup', 'online') then c ->> 'lesson_type' else l.lesson_type end,
      notes = case when c ? 'notes' then nullif(btrim(c ->> 'notes'), '') else l.notes end,
      instructor_note = case when c ? 'instructor_note' then nullif(btrim(c ->> 'instructor_note'), '') else l.instructor_note end,
      admin_note = case when c ? 'admin_note' then nullif(btrim(c ->> 'admin_note'), '') else l.admin_note end
    where l.id = any (ids);
    get diagnostics n = row_count;
  exception when exclusion_violation then
    raise exception 'Çakışma: seçilen saatte eğitmenin, sınıfın veya öğrencinin başka dersi var.' using errcode = 'P0001';
  end;

  select * into first_new from public.lessons where id = p_lesson_id;
  time_changed := first_new.starts_at <> t.starts_at or first_new.ends_at <> t.ends_at;
  if time_changed or first_new.instructor_id is distinct from t.instructor_id or first_new.room_id is distinct from t.room_id then
    perform private.notify(array['admin', 'personel']::public.app_role[], first_new.instructor_id, 'ders_degisiklik',
      case when time_changed then 'Ders saati değiştirildi' else 'Ders bilgileri güncellendi' end,
      'Ders programı güncellendi. ' || private.course_label(first_new) || ' (' || coalesce(private.group_label(first_new), 'Öğrenci') || ') '
        || case when time_changed then private.tr_tarih(t.starts_at) || ' ' || private.tr_saat(t.starts_at) || ' yerine '
              || private.tr_tarih(first_new.starts_at) || ' ' || private.tr_saat(first_new.starts_at, 'dat') || ' alındı.'
           else 'eğitmen/sınıf bilgisi değişti.' end
        || case when n > 1 and p_scope <> 'this' then ' (' || n || ' ders)' else '' end,
      '/ders/' || p_lesson_id);
    if time_changed and first_new.starts_at < now() + interval '7 days' then
      perform private.public_push('pub_time', 'Ders saati değiştirildi',
        'Ders programı güncellendi. ' || coalesce((select c2.name from public.courses c2 where c2.id = first_new.course_id), 'Ders') || ' '
          || private.tr_tarih(t.starts_at) || ' ' || private.tr_saat(t.starts_at) || ' yerine '
          || private.tr_tarih(first_new.starts_at) || ' ' || private.tr_saat(first_new.starts_at, 'dat') || ' alındı.',
        first_new.id, first_new.starts_at);
    end if;
  end if;
  perform set_config('mutu.bulk', 'off', true);
  return jsonb_build_object('updated', n);
end $$;

create or replace function public.delete_lessons(p_lesson_id uuid, p_expected_version int, p_scope text default 'this')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.lessons; ids uuid[]; n int;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  select * into t from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if p_expected_version is not null and t.version <> p_expected_version then
    raise exception 'Bu ders başka bir cihazda güncellendi. Lütfen yenileyip tekrar deneyin.' using errcode = '40001';
  end if;
  if t.status <> 'planlandi' then
    raise exception 'Gerçekleşmiş, ertelenmiş veya iptal edilmiş dersler silinmez; geçmiş korunur.' using errcode = 'P0001';
  end if;
  ids := private.scope_ids(t, p_scope);
  perform set_config('mutu.bulk', 'on', true);
  update public.push_deliveries set status = 'skipped', last_error = 'ders silindi'
  where lesson_id = any (ids) and status in ('pending', 'failed');
  delete from public.lessons where id = any (ids);
  get diagnostics n = row_count;
  perform private.notify(array['admin', 'personel']::public.app_role[], t.instructor_id, 'ders_iptal', 'Ders programdan kaldırıldı',
    private.course_label(t) || ' – ' || private.tr_tarih(t.starts_at) || ' ' || private.tr_saat(t.starts_at)
      || case when n > 1 then ' ve sonrası (' || n || ' ders)' else '' end, '/takvim');
  perform set_config('mutu.bulk', 'off', true);
  return jsonb_build_object('deleted', n);
end $$;

-- -----------------------------------------------------------------------------
-- 11) Erteleme (tek transaction; eski kayıt korunur, hak düşmez, eski hatırlatma iptal, yeni saate yeni hatırlatma)
-- -----------------------------------------------------------------------------
create or replace function private.postpone_label(code text)
returns text language sql immutable set search_path = '' as $$
  select case code when 'ogrenci' then 'Öğrenci talebi' when 'egitmen' then 'Eğitmen talebi' when 'tatil' then 'Resmi tatil'
    when 'saglik' then 'Sağlık/mazeret' when 'kurum' then 'Kurum kaynaklı' else 'Diğer' end
$$;

create or replace function public.postpone_lesson(
  p_lesson_id uuid, p_expected_version int, p_new_start timestamptz, p_new_end timestamptz,
  p_reason text default 'diger', p_note text default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.lessons; r public.lessons; nl public.lessons; gid uuid; first_new uuid; res jsonb; n int; txt text; reason text;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  if p_request_id is not null then
    insert into private.request_log (ref, fn) values (p_request_id, 'postpone_lesson') on conflict (ref) do nothing;
    get diagnostics n = row_count;
    if n = 0 then
      select result into res from private.request_log where ref = p_request_id;
      return coalesce(res, jsonb_build_object('duplicate', true));
    end if;
  end if;
  reason := coalesce(nullif(p_reason, ''), 'diger');
  if reason not in ('ogrenci', 'egitmen', 'tatil', 'saglik', 'kurum', 'diger') then
    raise exception 'Geçersiz erteleme nedeni.' using errcode = '22023';
  end if;
  if p_new_start is null or p_new_end is null or p_new_end <= p_new_start then
    raise exception 'Yeni bitiş saati başlangıç saatinden sonra olmalı.' using errcode = '22023';
  end if;
  if p_new_end - p_new_start > interval '10 hours' then raise exception 'Ders en fazla 10 saat olabilir.' using errcode = '22023'; end if;

  select * into t from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if t.status = 'ertelendi' then raise exception 'Bu ders zaten ertelendi.' using errcode = 'P0001'; end if;
  if p_expected_version is not null and t.version <> p_expected_version then
    raise exception 'Bu ders başka bir cihazda güncellendi. Lütfen yenileyip tekrar deneyin.' using errcode = '40001';
  end if;
  if t.status <> 'planlandi' then raise exception 'Yalnızca planlanmış dersler ertelenebilir.' using errcode = 'P0001'; end if;
  if p_new_start = t.starts_at and p_new_end = t.ends_at then
    raise exception 'Yeni tarih/saat eskisiyle aynı.' using errcode = 'P0001';
  end if;

  perform set_config('mutu.bulk', 'on', true);
  gid := case when t.group_id is not null then gen_random_uuid() end;
  for r in select * from public.lessons
           where coalesce(group_id, id) = coalesce(t.group_id, t.id) and status = 'planlandi'
           order by id for update
  loop
    update public.lessons set status = 'ertelendi', postpone_reason = reason,
      status_reason = private.postpone_label(reason) || coalesce(': ' || nullif(btrim(p_note), ''), '')
    where id = r.id;
    begin
      insert into public.lessons (student_id, instructor_id, course_id, room_id, lesson_type, title, group_id,
        starts_at, ends_at, rescheduled_from, notes, instructor_note, admin_note)
      values (r.student_id, r.instructor_id, r.course_id, r.room_id, r.lesson_type, r.title, gid,
        p_new_start, p_new_end, r.id, r.notes, null, r.admin_note)
      returning * into nl;
    exception when exclusion_violation then
      raise exception 'Çakışma: % % saatinde eğitmenin, sınıfın veya öğrencinin başka dersi var. Erteleme yapılmadı.',
        private.tr_tarih(p_new_start), private.tr_saat(p_new_start) using errcode = 'P0001';
    end;
    first_new := coalesce(first_new, nl.id);
  end loop;

  update public.push_deliveries set status = 'skipped', last_error = 'ders ertelendi'
  where status in ('pending', 'failed') and lesson_id in (
    select id from public.lessons where coalesce(group_id, id) = coalesce(t.group_id, t.id));

  txt := 'Ders programı güncellendi. ' || private.course_label(t) || ' '
    || case when (t.starts_at at time zone 'Europe/Istanbul')::date = (p_new_start at time zone 'Europe/Istanbul')::date
         then private.tr_saat(t.starts_at) || ' yerine ' || private.tr_saat(p_new_start, 'dat')
         else private.tr_tarih(t.starts_at) || ' ' || private.tr_saat(t.starts_at) || ' yerine '
              || private.tr_tarih(p_new_start) || ' ' || private.tr_saat(p_new_start, 'dat') end
    || ' ertelendi.';
  perform private.notify(array['admin', 'personel']::public.app_role[], t.instructor_id, 'ders_degisiklik', 'Ders ertelendi',
    txt || ' (' || coalesce(private.group_label(t), 'Öğrenci') || ' · ' || private.postpone_label(reason) || ')', '/ders/' || first_new);
  if least(t.starts_at, p_new_start) < now() + interval '7 days' and greatest(t.starts_at, p_new_start) > now() then
    perform private.public_push('pub_time', 'Ders ertelendi',
      replace(txt, private.course_label(t), coalesce((select c.name from public.courses c where c.id = t.course_id), 'Ders')),
      first_new, p_new_start);
  end if;
  perform set_config('mutu.bulk', 'off', true);

  res := jsonb_build_object('new_lesson_id', first_new, 'postponed', true);
  if p_request_id is not null then update private.request_log set result = res where ref = p_request_id; end if;
  return res;
end $$;

-- Eski imza: yeni erteleme işlemine yönlendirilir (aynı süre korunur)
create or replace function public.reschedule_lesson(
  p_lesson_id uuid, p_expected_version int, p_new_start timestamptz, p_reason text default null)
returns public.lessons
language plpgsql security definer set search_path = '' as $$
declare t public.lessons; res jsonb; n public.lessons;
begin
  select * into t from public.lessons where id = p_lesson_id;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  res := public.postpone_lesson(p_lesson_id, p_expected_version, p_new_start, p_new_start + (t.ends_at - t.starts_at), 'diger', p_reason, null);
  select * into n from public.lessons where id = (res ->> 'new_lesson_id')::uuid;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 12) İptal, iptali geri alma ve tamamlama (grup dersinin tüm öğrencileri)
-- -----------------------------------------------------------------------------
create or replace function public.cancel_lesson(p_lesson_id uuid, p_expected_version int, p_reason text default null)
returns public.lessons
language plpgsql security definer set search_path = '' as $$
declare l public.lessons;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  select * into l from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if p_expected_version is not null and l.version <> p_expected_version then
    raise exception 'Bu ders başka bir cihazda güncellendi. Lütfen yenileyip tekrar deneyin.' using errcode = '40001';
  end if;
  if l.status = 'iptal' then return l; end if;
  if l.status = 'ertelendi' then raise exception 'Ertelenmiş ders iptal edilemez; yeni tarihli dersi iptal edin.' using errcode = 'P0001'; end if;
  delete from public.attendance where lesson_id in (
    select id from public.lessons where coalesce(group_id, id) = coalesce(l.group_id, l.id) and status in ('planlandi', 'tamamlandi'));
  update public.lessons set status = 'iptal', status_reason = nullif(btrim(p_reason), '')
  where coalesce(group_id, id) = coalesce(l.group_id, l.id) and status in ('planlandi', 'tamamlandi');
  update public.push_deliveries set status = 'skipped', last_error = 'ders iptal'
  where status in ('pending', 'failed') and lesson_id in (select id from public.lessons where coalesce(group_id, id) = coalesce(l.group_id, l.id));
  select * into l from public.lessons where id = p_lesson_id;
  return l;
end $$;

create or replace function public.restore_lesson(p_lesson_id uuid, p_expected_version int)
returns public.lessons
language plpgsql security definer set search_path = '' as $$
declare l public.lessons;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  select * into l from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if p_expected_version is not null and l.version <> p_expected_version then
    raise exception 'Bu ders başka bir cihazda güncellendi. Lütfen yenileyip tekrar deneyin.' using errcode = '40001';
  end if;
  if l.status <> 'iptal' then raise exception 'Yalnızca iptal edilmiş ders geri alınabilir.' using errcode = 'P0001'; end if;
  perform set_config('mutu.bulk', 'on', true);
  begin
    update public.lessons set status = 'planlandi', status_reason = null
    where coalesce(group_id, id) = coalesce(l.group_id, l.id) and status = 'iptal';
  exception when exclusion_violation then
    raise exception 'İptal geri alınamadı: bu saatte eğitmenin, sınıfın veya öğrencinin artık başka dersi var.' using errcode = 'P0001';
  end;
  perform private.notify(array['admin', 'personel']::public.app_role[], l.instructor_id, 'ders_degisiklik', 'Ders iptali geri alındı',
    private.course_label(l) || ' – ' || coalesce(private.group_label(l), 'Öğrenci') || ', ' || private.tr_tarih(l.starts_at) || ' '
      || private.tr_saat(l.starts_at) || ' dersi yeniden planlandı.', '/ders/' || l.id);
  perform set_config('mutu.bulk', 'off', true);
  select * into l from public.lessons where id = p_lesson_id;
  return l;
end $$;

-- p_attendance: [{lesson_id, status, note}] – grup dersinde her öğrenci için ayrı yoklama
create or replace function public.complete_lesson(
  p_lesson_id uuid, p_expected_version int, p_attendance jsonb, p_instructor_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.lessons; r public.lessons; a jsonb; n int := 0;
begin
  select * into l from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if not (public.has_perm('lessons') or (l.instructor_id is not null and l.instructor_id = public.my_instructor_id())) then
    raise exception 'Bu dersi tamamlama yetkiniz yok.' using errcode = '42501';
  end if;
  if p_expected_version is not null and l.version <> p_expected_version then
    raise exception 'Bu ders başka bir cihazda güncellendi. Lütfen yenileyip tekrar deneyin.' using errcode = '40001';
  end if;
  if l.status in ('iptal', 'ertelendi') then raise exception 'İptal edilmiş veya ertelenmiş ders tamamlanamaz.' using errcode = 'P0001'; end if;
  if l.starts_at > now() + interval '1 hour' then
    raise exception 'Henüz başlamamış ders tamamlanamaz (ders saati: % %).', private.tr_tarih(l.starts_at), private.tr_saat(l.starts_at) using errcode = 'P0001';
  end if;
  for r in select * from public.lessons where coalesce(group_id, id) = coalesce(l.group_id, l.id) and status in ('planlandi', 'tamamlandi') order by id for update loop
    a := null;
    select x.value into a from jsonb_array_elements(coalesce(p_attendance, '[]'::jsonb)) as x(value) where x.value ->> 'lesson_id' = r.id::text limit 1;
    if a is null then raise exception 'Her öğrenci için yoklama seçin.' using errcode = 'P0001'; end if;
    insert into public.attendance (lesson_id, student_id, status, note, marked_by, marked_at)
    values (r.id, r.student_id, (a ->> 'status')::public.attendance_status, nullif(btrim(a ->> 'note'), ''), auth.uid(), now())
    on conflict (lesson_id) do update set status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = now();
    update public.lessons set status = 'tamamlandi',
      instructor_note = coalesce(nullif(btrim(p_instructor_note), ''), instructor_note)
    where id = r.id;
    perform private.refresh_student_usage(r.student_id);
    n := n + 1;
  end loop;
  return jsonb_build_object('completed', n);
end $$;

-- -----------------------------------------------------------------------------
-- 13) Program dosyası içe aktarma (onaylanan satırlar tek transaction; çakışan satırlar raporlanır)
--     p_rows: [{student_ids[] | new_student, instructor_id, course_id, room_id, date, start, end, title, repeat{...}}]
-- -----------------------------------------------------------------------------
create or replace function public.preview_import(p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rw jsonb; i record; d date; s timestamptz; e timestamptz; iss jsonb; idx int := 0; out jsonb := '[]'::jsonb;
  cnt int; nconf int; nwarn int; ndup int; msgs jsonb;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'En fazla 2000 satır önizlenebilir.' using errcode = 'P0001';
  end if;
  for rw in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1; cnt := 0; nconf := 0; nwarn := 0; ndup := 0; msgs := '[]'::jsonb;
    begin
      select * into i from private.lesson_plan_input(rw, true);
      for d in select * from private.expand_dates(i.d0, rw -> 'repeat') loop
        cnt := cnt + 1;
        s := (d + i.t_start) at time zone 'Europe/Istanbul';
        e := (d + i.t_end) at time zone 'Europe/Istanbul';
        iss := private.slot_issues(i.students, i.instructor, i.room, s, e);
        if exists (select 1 from public.lessons l where l.student_id = any (i.students) and l.starts_at = s and l.status in ('planlandi', 'tamamlandi')) then
          ndup := ndup + 1;
          if jsonb_array_length(msgs) < 3 then msgs := msgs || to_jsonb(private.tr_tarih(s) || ' ' || private.tr_saat(s) || ': bu ders zaten kayıtlı (olası mükerrer)'); end if;
        elsif jsonb_array_length(iss -> 'conflicts') > 0 then
          nconf := nconf + 1;
          if jsonb_array_length(msgs) < 3 then msgs := msgs || to_jsonb(private.tr_tarih(s) || ' ' || private.tr_saat(s) || ': ' || (iss -> 'conflicts' ->> 0)); end if;
        end if;
        if jsonb_array_length(iss -> 'warnings') > 0 then nwarn := nwarn + 1; end if;
      end loop;
      out := out || jsonb_build_object('row', idx, 'count', cnt, 'conflicts', nconf, 'duplicates', ndup, 'warnings', nwarn, 'messages', msgs);
    exception when others then
      out := out || jsonb_build_object('row', idx, 'count', 0, 'error', sqlerrm);
    end;
  end loop;
  return out;
end $$;

create or replace function public.import_lessons(p_rows jsonb, p_file_name text, p_skip_conflicts boolean default true, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  imp uuid; rw jsonb; i record; d date; s timestamptz; e timestamptz; iss jsonb; gid uuid; sid uuid; series uuid;
  created int := 0; skipped int := 0; new_students int := 0; problems jsonb := '[]'::jsonb; res jsonb; n int; idx int := 0;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'İçe aktarılacak satır yok.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Tek seferde en fazla 2000 satır aktarılabilir.' using errcode = 'P0001'; end if;
  if p_request_id is not null then
    insert into private.request_log (ref, fn) values (p_request_id, 'import_lessons') on conflict (ref) do nothing;
    get diagnostics n = row_count;
    if n = 0 then
      select result into res from private.request_log where ref = p_request_id;
      return coalesce(res, jsonb_build_object('duplicate', true));
    end if;
  end if;
  insert into public.schedule_imports (file_name, total_rows) values (left(p_file_name, 200), jsonb_array_length(p_rows)) returning id into imp;
  perform set_config('mutu.bulk', 'on', true);
  for rw in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    -- Dosyadaki yeni öğrenci aynı transaction içinde oluşturulur (aktarım başarısız olursa o da geri alınır)
    if nullif(btrim(rw ->> 'new_student'), '') is not null then
      if not public.has_perm('students') then raise exception 'Yeni öğrenci ekleme yetkiniz yok.' using errcode = '42501'; end if;
      sid := null;
      select st.id into sid from public.students st where lower(btrim(st.full_name)) = lower(btrim(rw ->> 'new_student')) limit 1;
      if sid is null then
        insert into public.students (full_name, instructor_id, course_id)
        values (btrim(rw ->> 'new_student'), nullif(rw ->> 'instructor_id', '')::uuid, nullif(rw ->> 'course_id', '')::uuid)
        returning id into sid;
        new_students := new_students + 1;
      end if;
      rw := jsonb_set(rw, '{student_ids}', jsonb_build_array(sid));
    end if;
    select * into i from private.lesson_plan_input(rw);
    series := null;
    if coalesce(rw -> 'repeat' ->> 'freq', 'yok') not in ('yok', '') then
      insert into public.lesson_series (freq, weekdays, interval_days, start_date, until_date, start_time, end_time,
        title, lesson_type, instructor_id, course_id, room_id, student_ids)
      values (rw -> 'repeat' ->> 'freq',
        array(select jsonb_array_elements_text(coalesce(rw -> 'repeat' -> 'weekdays', '[]'::jsonb))::smallint),
        nullif(rw -> 'repeat' ->> 'interval_days', '')::int, i.d0, (rw -> 'repeat' ->> 'until')::date, i.t_start, i.t_end,
        nullif(btrim(rw ->> 'title'), ''), i.ltype, i.instructor, i.course, i.room, i.students)
      returning id into series;
    end if;
    for d in select * from private.expand_dates(i.d0, rw -> 'repeat') loop
      s := (d + i.t_start) at time zone 'Europe/Istanbul';
      e := (d + i.t_end) at time zone 'Europe/Istanbul';
      iss := private.slot_issues(i.students, i.instructor, i.room, s, e);
      if jsonb_array_length(iss -> 'conflicts') > 0 then
        if not p_skip_conflicts then
          raise exception 'Satır % (%): %', idx, private.tr_tarih(s) || ' ' || private.tr_saat(s), iss -> 'conflicts' ->> 0 using errcode = 'P0001';
        end if;
        skipped := skipped + 1;
        if jsonb_array_length(problems) < 200 then
          problems := problems || jsonb_build_object('row', idx, 'date', private.tr_tarih(s) || ' ' || private.tr_saat(s), 'reason', iss -> 'conflicts' ->> 0);
        end if;
        continue;
      end if;
      gid := case when array_length(i.students, 1) > 1 then gen_random_uuid() end;
      begin
        foreach sid in array i.students loop
          insert into public.lessons (student_id, instructor_id, course_id, room_id, lesson_type, title, series_id, group_id, starts_at, ends_at, import_id)
          values (sid, i.instructor, coalesce(i.course, (select st.course_id from public.students st where st.id = sid)), i.room, i.ltype,
                  nullif(btrim(rw ->> 'title'), ''), series, gid, s, e, imp);
        end loop;
        created := created + 1;
      exception when exclusion_violation then
        skipped := skipped + 1;
        problems := problems || jsonb_build_object('row', idx, 'date', private.tr_tarih(s) || ' ' || private.tr_saat(s), 'reason', 'Çakışma');
      end;
    end loop;
  end loop;
  update public.schedule_imports set created_count = created, skipped_count = skipped,
    summary = jsonb_build_object('problems', problems, 'new_students', new_students)
  where id = imp;
  if created > 0 then
    perform private.notify(array['admin', 'personel']::public.app_role[], null, 'ders_yeni', 'Program dosyası içeri aktarıldı',
      coalesce(p_file_name, 'Dosya') || ': ' || created || ' ders eklendi' || case when skipped > 0 then ', ' || skipped || ' ders atlandı' else '' end || '.',
      '/takvim');
  end if;
  perform set_config('mutu.bulk', 'off', true);
  res := jsonb_build_object('import_id', imp, 'created', created, 'skipped', skipped, 'new_students', new_students, 'problems', problems);
  if p_request_id is not null then update private.request_log set result = res where ref = p_request_id; end if;
  return res;
end $$;

-- -----------------------------------------------------------------------------
-- 14) Herkese açık program: grup dersleri tek satır, sınıf adı (kişisel veri yok)
-- -----------------------------------------------------------------------------
drop function if exists public.get_public_schedule(timestamptz, timestamptz);
create function public.get_public_schedule(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid, starts_at timestamptz, ends_at timestamptz, status public.lesson_status, started boolean,
  student_label text, course_name text, course_color text, instructor_label text, instructor_color text,
  room_name text, lesson_type text)
language sql stable security definer set search_path = '' as $$
  select (array_agg(l.id order by l.id))[1], min(l.starts_at), max(l.ends_at), (array_agg(l.status order by l.id))[1],
         bool_or(l.started_at is not null),
         case when count(*) > 1 then count(*) || ' öğrenci' else private.short_name(max(s.full_name)) end,
         max(c.name), max(c.color), private.short_name(max(i.full_name)), max(i.color), max(r.name), max(l.lesson_type)
  from public.lessons l
  left join public.students s on s.id = l.student_id
  left join public.courses c on c.id = l.course_id
  left join public.instructors i on i.id = l.instructor_id
  left join public.rooms r on r.id = l.room_id
  where p_to > p_from and p_to - p_from <= interval '62 days'
    and l.starts_at >= p_from and l.starts_at < p_to
    and l.status <> 'ertelendi'
  group by coalesce(l.group_id, l.id)
  order by min(l.starts_at)
  limit 1000
$$;
revoke execute on function public.get_public_schedule from public;
grant execute on function public.get_public_schedule to anon, authenticated;

create trigger trg_public_schedule_broadcast after insert or update or delete on public.rooms
  for each statement execute function private.broadcast_schedule_change();

-- -----------------------------------------------------------------------------
-- 15) Aktiviteler: yeni tablolar ve erteleme nedeni
-- -----------------------------------------------------------------------------
create or replace function public.get_activities(p_limit int default 50, p_before bigint default null, p_lesson uuid default null)
returns table (
  id bigint, created_at timestamptz, table_name text, action text, actor_name text,
  student_id uuid, student_name text, summary jsonb, old_data jsonb, new_data jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare adm boolean := public.is_admin(); pay boolean := public.has_perm('payments'); inst uuid := public.my_instructor_id();
begin
  if not public.is_member() then return; end if;
  return query
  select a.id, a.created_at, a.table_name, a.action,
    coalesce(pr.full_name, case when a.actor_id is null then 'Sistem' else 'Cihaz' end),
    st.id, st.full_name,
    jsonb_strip_nulls(jsonb_build_object(
      'status', coalesce(a.new_data, a.old_data) ->> 'status',
      'old_status', a.old_data ->> 'status',
      'starts_at', coalesce(a.new_data, a.old_data) ->> 'starts_at',
      'old_starts_at', case when a.old_data ->> 'starts_at' is distinct from a.new_data ->> 'starts_at' then a.old_data ->> 'starts_at' end,
      'started_at', a.new_data ->> 'started_at',
      'old_started_at', a.old_data ->> 'started_at',
      'is_void', a.new_data ->> 'is_void',
      'name', coalesce(a.new_data, a.old_data) ->> 'name',
      'title', coalesce(a.new_data, a.old_data) ->> 'title',
      'postpone_reason', a.new_data ->> 'postpone_reason',
      'lesson_count', case when a.table_name = 'lesson_packages' then coalesce(a.new_data, a.old_data) ->> 'lesson_count' end,
      'kind', case when a.table_name = 'lesson_packages' then coalesce(a.new_data, a.old_data) ->> 'kind' end,
      'file_name', case when a.table_name = 'schedule_imports' then a.new_data ->> 'file_name' end,
      'full_name', case when a.table_name in ('students', 'instructors') then coalesce(a.new_data, a.old_data) ->> 'full_name' end,
      'lesson_id', case when a.table_name = 'lessons' then a.record_id::text
                        when a.table_name = 'attendance' then coalesce(a.new_data, a.old_data) ->> 'lesson_id' end,
      'amount', case when pay and a.table_name = 'payments' then coalesce(a.new_data, a.old_data) ->> 'amount' end)),
    case when adm then a.old_data - 'code_hash' end,
    case when adm then a.new_data - 'code_hash' end
  from public.audit_logs a
  left join public.profiles pr on pr.id = a.actor_id
  left join public.students st on st.id = coalesce(
    case when a.table_name = 'students' then a.record_id end,
    (coalesce(a.new_data, a.old_data) ->> 'student_id')::uuid)
  where a.table_name in ('students', 'lessons', 'attendance', 'payments', 'installments', 'instructors', 'weekly_schedules',
                         'courses', 'student_notes', 'lesson_packages', 'rooms', 'schedule_imports')
    and (p_before is null or a.id < p_before)
    and (p_lesson is null or (a.table_name = 'lessons' and a.record_id = p_lesson)
         or (a.table_name = 'attendance' and (coalesce(a.new_data, a.old_data) ->> 'lesson_id')::uuid = p_lesson))
    and (pay or a.table_name not in ('payments', 'installments'))
    and (public.is_staff() or (inst is not null and (
          (a.table_name in ('lessons') and (coalesce(a.new_data, a.old_data) ->> 'instructor_id')::uuid = inst)
          or (a.table_name = 'attendance' and exists (select 1 from public.lessons l where l.id = (coalesce(a.new_data, a.old_data) ->> 'lesson_id')::uuid and l.instructor_id = inst)))))
    and not (a.table_name = 'lessons' and a.action = 'update'
             and (a.new_data ->> 'status') is not distinct from (a.old_data ->> 'status')
             and (a.new_data ->> 'starts_at') is not distinct from (a.old_data ->> 'starts_at')
             and (a.new_data ->> 'instructor_id') is not distinct from (a.old_data ->> 'instructor_id')
             and (a.new_data ->> 'room_id') is not distinct from (a.old_data ->> 'room_id')
             and (a.new_data ->> 'started_at') is not distinct from (a.old_data ->> 'started_at'))
    and not (a.table_name = 'students' and a.action = 'update'
             and (a.new_data - 'used_lessons' - 'remaining_lessons' - 'total_lessons' - 'version' - 'updated_at')
                 = (a.old_data - 'used_lessons' - 'remaining_lessons' - 'total_lessons' - 'version' - 'updated_at'))
  order by a.id desc
  limit greatest(1, least(p_limit, 200));
end $$;

-- -----------------------------------------------------------------------------
-- 16) Rapor özeti (tarih aralığı ve eğitmen filtresi)
-- -----------------------------------------------------------------------------
create or replace function public.report_summary(p_from date, p_to date, p_instructor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f timestamptz := p_from::timestamp at time zone 'Europe/Istanbul';
  t timestamptz := (p_to + 1)::timestamp at time zone 'Europe/Istanbul';
  today date := (now() at time zone 'Europe/Istanbul')::date;
  wk date := today - (extract(isodow from today)::int - 1);
  mo date := date_trunc('month', today)::date;
  res jsonb; pay boolean := public.has_perm('payments'); thr int;
begin
  if not public.is_staff() then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Tarih aralığı geçersiz (en fazla 400 gün).' using errcode = '22023'; end if;
  select low_credit_threshold into thr from public.app_settings where id = 1;

  with ls as (
    select l.*, a.status::text att from public.lessons l left join public.attendance a on a.lesson_id = l.id
    where l.starts_at >= f and l.starts_at < t and (p_instructor is null or l.instructor_id = p_instructor)
  ), sess as (  -- grup dersi tek oturum sayılır
    select distinct on (coalesce(group_id, id)) * from ls order by coalesce(group_id, id), id
  )
  select jsonb_build_object(
    'active_students', (select count(*) from public.students where is_active),
    'new_students', (select count(*) from public.students where created_at >= f and created_at < t),
    'today', (select count(distinct coalesce(group_id, id)) from public.lessons where status <> 'ertelendi'
              and starts_at >= today::timestamp at time zone 'Europe/Istanbul' and starts_at < (today + 1)::timestamp at time zone 'Europe/Istanbul'
              and (p_instructor is null or instructor_id = p_instructor)),
    'this_week', (select count(distinct coalesce(group_id, id)) from public.lessons where status <> 'ertelendi'
              and starts_at >= wk::timestamp at time zone 'Europe/Istanbul' and starts_at < (wk + 7)::timestamp at time zone 'Europe/Istanbul'
              and (p_instructor is null or instructor_id = p_instructor)),
    'this_month', (select count(distinct coalesce(group_id, id)) from public.lessons where status <> 'ertelendi'
              and starts_at >= mo::timestamp at time zone 'Europe/Istanbul' and starts_at < (mo + interval '1 month')::timestamp at time zone 'Europe/Istanbul'
              and (p_instructor is null or instructor_id = p_instructor)),
    'sessions', (select count(*) from sess where status <> 'ertelendi'),
    'planned', (select count(*) from sess where status = 'planlandi'),
    'completed', (select count(*) from sess where status = 'tamamlandi'),
    'cancelled', (select count(*) from sess where status = 'iptal'),
    'postponed', (select count(*) from sess where status = 'ertelendi'),
    'attendance_total', (select count(*) from ls where att is not null),
    'absent', (select count(*) from ls where att = 'katilmadi'),
    'excused', (select count(*) from ls where att = 'izinli'),
    'late', (select count(*) from ls where att in ('gec_geldi', 'erken_ayrildi')),
    'absence_rate', (select case when count(*) filter (where att is not null) = 0 then 0
                       else round(100.0 * count(*) filter (where att = 'katilmadi') / count(*) filter (where att is not null), 1) end from ls),
    'hours', (select round(coalesce(sum(extract(epoch from ends_at - starts_at)) / 3600, 0)::numeric, 1) from sess where status = 'tamamlandi'),
    'by_instructor', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.full_name,
          'total', (select count(*) from sess where sess.instructor_id = i.id and sess.status <> 'ertelendi'),
          'completed', (select count(*) from sess where sess.instructor_id = i.id and sess.status = 'tamamlandi'),
          'cancelled', (select count(*) from sess where sess.instructor_id = i.id and sess.status = 'iptal'),
          'postponed', (select count(*) from sess where sess.instructor_id = i.id and sess.status = 'ertelendi'),
          'absent', (select count(*) from ls where ls.instructor_id = i.id and ls.att = 'katilmadi'),
          'attended', (select count(*) from ls where ls.instructor_id = i.id and ls.att in ('katildi', 'gec_geldi', 'erken_ayrildi')),
          'hours', (select round(coalesce(sum(extract(epoch from sess.ends_at - sess.starts_at)), 0)::numeric / 3600, 1)
                    from sess where sess.instructor_id = i.id and sess.status = 'tamamlandi')) order by i.full_name)
        from public.instructors i where exists (select 1 from ls where ls.instructor_id = i.id)), '[]'::jsonb),
    'postpone_reasons', coalesce((select jsonb_object_agg(private.postpone_label(postpone_reason), k) from (
        select postpone_reason, count(*) k from sess where status = 'ertelendi' group by postpone_reason) q), '{}'::jsonb),
    'low_credit', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'remaining', s.remaining_lessons, 'total', s.total_lessons)
        order by s.remaining_lessons, s.full_name)
        from public.students s where s.is_active and s.total_lessons > 0 and s.remaining_lessons <= thr
          and (p_instructor is null or s.instructor_id = p_instructor)), '[]'::jsonb),
    'pending_payments', case when pay then (select jsonb_build_object(
        'students', count(*) filter (where b.balance > 0),
        'amount', coalesce(sum(b.balance) filter (where b.balance > 0), 0),
        'overdue', (select count(*) from public.v_installments v where v.status = 'gecikti'),
        'overdue_amount', (select coalesce(sum(v.amount - v.covered), 0) from public.v_installments v where v.status = 'gecikti'))
        from public.v_student_balances b) end
  ) into res;
  return res;
end $$;

-- -----------------------------------------------------------------------------
-- 17) Yetkiler, gerçek zamanlı yayın
-- -----------------------------------------------------------------------------
revoke execute on function public.add_lesson_package, public.void_lesson_package, public.preview_lessons, public.create_lessons,
  public.preview_lesson_scope, public.update_lessons, public.delete_lessons, public.postpone_lesson, public.restore_lesson,
  public.complete_lesson, public.import_lessons, public.preview_import, public.report_summary from public, anon;
grant execute on function public.add_lesson_package, public.void_lesson_package, public.preview_lessons, public.create_lessons,
  public.preview_lesson_scope, public.update_lessons, public.delete_lessons, public.postpone_lesson, public.restore_lesson,
  public.complete_lesson, public.import_lessons, public.preview_import, public.report_summary to authenticated;

alter publication supabase_realtime add table public.rooms, public.instructor_availability, public.lesson_packages, public.schedule_imports;

update public.app_settings set notify_rules = coalesce(notify_rules, '{}'::jsonb) || '{"ders_yeni": true}'::jsonb where id = 1;
