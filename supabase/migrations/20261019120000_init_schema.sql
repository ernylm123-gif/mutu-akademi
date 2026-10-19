-- MUTU AKADEMİ – temel şema
-- Saat dilimi: Europe/Istanbul. Tüm zaman damgaları timestamptz olarak saklanır.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Tipler
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'egitmen', 'personel');
create type public.lesson_status as enum ('planlandi', 'tamamlandi', 'ertelendi', 'iptal');
create type public.attendance_status as enum ('katildi', 'katilmadi', 'izinli');
create type public.payment_method as enum ('nakit', 'kart', 'havale', 'diger');

-- ---------------------------------------------------------------------------
-- Özel şema (API üzerinden erişilemez)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- İlk yönetici e-postaları. Bu adreslerle açılan hesaplar otomatik admin olur.
create table private.bootstrap_admins (
  email text primary key
);

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  role public.app_role not null default 'personel',
  is_active boolean not null default true,
  approved boolean not null default false,
  permissions jsonb not null default '{"students": true, "lessons": true, "payments": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  absence_consumes_credit boolean not null default true,
  low_credit_threshold int not null default 2 check (low_credit_threshold >= 0),
  payment_reminder_days int not null default 3 check (payment_reminder_days between 0 and 60),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  phone text,
  email text,
  specialty text,
  color text not null default '#29A8DF',
  notes text,
  is_active boolean not null default true,
  profile_id uuid unique references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 120),
  description text,
  default_lesson_count int not null default 8 check (default_lesson_count >= 0),
  default_fee numeric(12, 2) not null default 0 check (default_fee >= 0),
  duration_minutes int not null default 60 check (duration_minutes between 10 and 600),
  color text not null default '#D6268B',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  phone text,
  email text,
  birth_date date,
  guardian_name text,
  guardian_phone text,
  address text,
  course_id uuid references public.courses (id) on delete set null,
  instructor_id uuid references public.instructors (id) on delete set null,
  total_lessons int not null default 0 check (total_lessons >= 0),
  used_lessons int not null default 0,
  remaining_lessons int generated always as (total_lessons - used_lessons) stored,
  total_fee numeric(12, 2) not null default 0 check (total_fee >= 0),
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1
);

create table public.student_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  instructor_id uuid references public.instructors (id) on delete set null,
  weekday smallint not null check (weekday between 1 and 7), -- 1 = Pazartesi
  start_time time not null,
  duration_minutes int not null default 60 check (duration_minutes between 10 and 600),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  instructor_id uuid references public.instructors (id) on delete set null,
  course_id uuid references public.courses (id) on delete set null,
  schedule_id uuid references public.weekly_schedules (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.lesson_status not null default 'planlandi',
  credit_used boolean not null default false,
  rescheduled_from uuid references public.lessons (id) on delete set null,
  status_reason text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '10 hours'),
  -- Çakışma kontrolü: aynı eğitmen / aynı öğrenci için aktif dersler üst üste binemez.
  constraint lessons_no_instructor_overlap exclude using gist (
    instructor_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status in ('planlandi', 'tamamlandi') and instructor_id is not null),
  constraint lessons_no_student_overlap exclude using gist (
    student_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status in ('planlandi', 'tamamlandi'))
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  status public.attendance_status not null,
  note text,
  marked_by uuid references public.profiles (id) on delete set null default auth.uid(),
  marked_at timestamptz not null default now()
);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  due_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  paid_at date not null default (now() at time zone 'Europe/Istanbul')::date,
  method public.payment_method not null default 'nakit',
  note text,
  is_void boolean not null default false,
  void_reason text,
  voided_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  version int not null default 1
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  action text not null,
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- İndeksler
-- ---------------------------------------------------------------------------
create index on public.students (instructor_id);
create index on public.students (course_id);
create index on public.students (is_active);
create index on public.student_notes (student_id, created_at desc);
create index on public.weekly_schedules (student_id);
create index on public.weekly_schedules (instructor_id);
create index on public.lessons (starts_at);
create index on public.lessons (student_id, starts_at);
create index on public.lessons (instructor_id, starts_at);
create index on public.lessons (schedule_id);
create index on public.lessons (rescheduled_from);
create index on public.attendance (student_id);
create index on public.installments (student_id, due_date);
create index on public.payments (student_id, paid_at);
create index on public.notifications (user_id, created_at desc);
create index on public.audit_logs (table_name, record_id);
create index on public.audit_logs (created_at desc);
create index on public.instructors (profile_id);
create index on public.students (created_by);
create index on public.lessons (course_id);
create index on public.lessons (created_by);
create index on public.attendance (marked_by);
create index on public.installments (created_by);
create index on public.payments (created_by);
create index on public.payments (voided_by);
create index on public.student_notes (author_id);

-- ---------------------------------------------------------------------------
-- Yetki yardımcıları (SECURITY DEFINER, RLS özyinelemesini önler)
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active and p.approved
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_app_role() = 'admin', false) $$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_app_role() in ('admin', 'personel'), false) $$;

create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.current_app_role() is not null $$;

create or replace function public.has_perm(perm text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case
       when p.role = 'admin' then true
       when p.role = 'personel' then coalesce((p.permissions ->> perm)::boolean, false)
       else false end
     from public.profiles p
     where p.id = auth.uid() and p.is_active and p.approved),
    false)
$$;

create or replace function public.my_instructor_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select i.id from public.instructors i
  join public.profiles p on p.id = i.profile_id
  where p.id = auth.uid() and p.is_active and p.approved and p.role = 'egitmen'
  limit 1
$$;

-- Eğitmenin öğrenciyi görebilmesi: kendisine atanmış ya da kendisiyle dersi olan öğrenciler.
create or replace function public.can_view_student(sid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_staff() or exists (
    select 1 from public.students s
    where s.id = sid and s.instructor_id = public.my_instructor_id()
  ) or exists (
    select 1 from public.lessons l
    where l.student_id = sid and l.instructor_id = public.my_instructor_id()
  )
$$;

revoke execute on function public.current_app_role, public.is_admin, public.is_staff,
  public.is_member, public.has_perm, public.my_instructor_id, public.can_view_student from public, anon;

-- ---------------------------------------------------------------------------
-- Genel tetikleyiciler
-- ---------------------------------------------------------------------------
create or replace function private.touch_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and to_jsonb(new) ? 'version' then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

create trigger trg_touch before update on public.profiles for each row execute function private.touch_row();
create trigger trg_touch before update on public.instructors for each row execute function private.touch_row();
create trigger trg_touch before update on public.courses for each row execute function private.touch_row();
create trigger trg_touch before update on public.students for each row execute function private.touch_row();
create trigger trg_touch before update on public.lessons for each row execute function private.touch_row();
create trigger trg_touch before update on public.app_settings for each row execute function private.touch_row();

create or replace function private.bump_payment_version()
returns trigger language plpgsql set search_path = '' as $$
begin new.version := old.version + 1; return new; end $$;
create trigger trg_version before update on public.payments for each row execute function private.bump_payment_version();

-- Audit log
create or replace function private.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  rid := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'))::uuid;
  insert into public.audit_logs (table_name, record_id, action, actor_id, old_data, new_data)
  values (tg_table_name, rid, lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger trg_audit after insert or update or delete on public.profiles for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.instructors for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.courses for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.students for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.lessons for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.attendance for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.payments for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.installments for each row execute function private.audit();
create trigger trg_audit after insert or update or delete on public.weekly_schedules for each row execute function private.audit();
create trigger trg_audit after update on public.app_settings for each row execute function private.audit();

-- Profil: yeni auth kullanıcısı -> profil (onaysız). Bootstrap e-postası ise admin.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare is_boot boolean;
begin
  select exists (select 1 from private.bootstrap_admins b where lower(b.email) = lower(new.email)) into is_boot;
  insert into public.profiles (id, email, full_name, role, approved, permissions)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    case when is_boot then 'admin'::public.app_role
         when new.raw_app_meta_data ->> 'role' in ('admin', 'egitmen', 'personel')
           then (new.raw_app_meta_data ->> 'role')::public.app_role
         else 'personel'::public.app_role end,
    is_boot or coalesce((new.raw_app_meta_data ->> 'approved')::boolean, false),
    '{"students": true, "lessons": true, "payments": false}'::jsonb
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Profil: yönetici olmayanlar rol / onay / izin alanlarını değiştiremez.
create or replace function private.guard_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.approved is distinct from old.approved
       or new.is_active is distinct from old.is_active or new.permissions is distinct from old.permissions
       or new.email is distinct from old.email or new.id is distinct from old.id then
      raise exception 'Bu alanları değiştirme yetkiniz yok.' using errcode = '42501';
    end if;
  end if;
  -- Sistemde en az bir aktif admin kalmalı
  if old.role = 'admin' and old.is_active and old.approved
     and (new.role <> 'admin' or not new.is_active or not new.approved)
     and not exists (select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.is_active and p.approved) then
    raise exception 'Sistemde en az bir aktif yönetici kalmalıdır.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_guard_profile before update on public.profiles for each row execute function private.guard_profile();

-- ---------------------------------------------------------------------------
-- Bildirimler
-- ---------------------------------------------------------------------------
-- Hedef: roller + (varsa) ilgili eğitmenin kullanıcı hesabı. Tetikleyen kişiye gönderilmez.
create or replace function private.notify(
  p_roles public.app_role[], p_instructor uuid, p_type text, p_title text,
  p_body text, p_link text, p_dedupe text default null, p_include_actor boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, type, title, body, link, dedupe_key)
  select distinct p.id, p_type, p_title, p_body, p_link, p_dedupe
  from public.profiles p
  where p.is_active and p.approved
    and (p_include_actor or p.id is distinct from auth.uid())
    and (p.role = any (p_roles)
         or p.id = (select i.profile_id from public.instructors i where i.id = p_instructor))
  on conflict (user_id, dedupe_key) do nothing;
end $$;

create or replace function private.fmt_ts(t timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(t at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI')
$$;

create or replace function private.on_student_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(array['admin', 'personel']::public.app_role[], new.instructor_id,
    'yeni_ogrenci', 'Yeni öğrenci kaydı', new.full_name || ' sisteme eklendi.', '/ogrenciler/' || new.id);
  return new;
end $$;
create trigger trg_student_notify after insert on public.students for each row execute function private.on_student_insert();

create or replace function private.on_lesson_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sname text;
begin
  select s.full_name into sname from public.students s where s.id = new.student_id;
  if tg_op = 'UPDATE' then
    if new.status = 'iptal' and old.status <> 'iptal' then
      perform private.notify(array['admin', 'personel']::public.app_role[], new.instructor_id,
        'ders_iptal', 'Ders iptal edildi',
        coalesce(sname, 'Öğrenci') || ' – ' || private.fmt_ts(new.starts_at) || coalesce(' (' || new.status_reason || ')', ''),
        '/takvim?tarih=' || to_char(new.starts_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD'));
    elsif new.status = 'ertelendi' and old.status <> 'ertelendi' then
      perform private.notify(array['admin', 'personel']::public.app_role[], new.instructor_id,
        'ders_degisiklik', 'Ders ertelendi',
        coalesce(sname, 'Öğrenci') || ' – ' || private.fmt_ts(old.starts_at) || ' tarihli ders ertelendi.',
        '/takvim?tarih=' || to_char(new.starts_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD'));
    elsif new.starts_at <> old.starts_at or new.ends_at <> old.ends_at
          or new.instructor_id is distinct from old.instructor_id then
      perform private.notify(array['admin', 'personel']::public.app_role[], new.instructor_id,
        'ders_degisiklik', 'Ders saati değişti',
        coalesce(sname, 'Öğrenci') || ': ' || private.fmt_ts(old.starts_at) || ' → ' || private.fmt_ts(new.starts_at),
        '/takvim?tarih=' || to_char(new.starts_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD'));
      if old.instructor_id is distinct from new.instructor_id and old.instructor_id is not null then
        perform private.notify(array[]::public.app_role[], old.instructor_id,
          'ders_degisiklik', 'Ders başka eğitmene aktarıldı',
          coalesce(sname, 'Öğrenci') || ' – ' || private.fmt_ts(new.starts_at), '/takvim');
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_lesson_notify after update on public.lessons for each row execute function private.on_lesson_change();

-- ---------------------------------------------------------------------------
-- Ders hakkı hesabı (merkezi, idempotent)
-- ---------------------------------------------------------------------------
-- Kural: Ders "tamamlandi" ise ve yoklama "katildi" ise hak düşer.
--        "katilmadi" ise ayara göre düşer (varsayılan: düşer). "izinli" düşmez.
--        Ertelenen / iptal edilen ders hak düşürmez.
-- Hesap her seferinde baştan sayılır; bu yüzden aynı işlem iki kez uygulanamaz.
create or replace function private.refresh_student_usage(p_student uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  absence_counts boolean;
  threshold int;
  before_remaining int;
  after_remaining int;
  s record;
begin
  if p_student is null then return; end if;
  select absence_consumes_credit, low_credit_threshold into absence_counts, threshold
  from public.app_settings where id = 1;

  select remaining_lessons into before_remaining from public.students where id = p_student for update;

  update public.lessons l
  set credit_used = (l.status = 'tamamlandi' and a.status is not null
                     and (a.status = 'katildi' or (a.status = 'katilmadi' and absence_counts)))
  from public.lessons l2
  left join public.attendance a on a.lesson_id = l2.id
  where l.id = l2.id and l.student_id = p_student
    and l.credit_used is distinct from (l2.status = 'tamamlandi' and a.status is not null
                     and (a.status = 'katildi' or (a.status = 'katilmadi' and absence_counts)));

  update public.students st
  set used_lessons = (select count(*) from public.lessons l where l.student_id = p_student and l.credit_used)
  where st.id = p_student
    and st.used_lessons <> (select count(*) from public.lessons l where l.student_id = p_student and l.credit_used);

  select * into s from public.students where id = p_student;
  after_remaining := s.remaining_lessons;
  if s.total_lessons > 0 and after_remaining <= threshold
     and (before_remaining is null or before_remaining > threshold or after_remaining < before_remaining) then
    perform private.notify(array['admin', 'personel']::public.app_role[], s.instructor_id,
      'dusuk_ders_hakki', 'Düşük ders hakkı',
      s.full_name || ' için kalan ders hakkı: ' || after_remaining,
      '/ogrenciler/' || s.id, 'low:' || s.id || ':' || after_remaining, true);
  end if;
end $$;

create or replace function private.on_lesson_usage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    perform private.refresh_student_usage(old.student_id);
  elsif tg_op = 'INSERT' or new.status is distinct from old.status or new.student_id is distinct from old.student_id then
    perform private.refresh_student_usage(new.student_id);
    if tg_op = 'UPDATE' and new.student_id is distinct from old.student_id then
      perform private.refresh_student_usage(old.student_id);
    end if;
  end if;
  return null;
end $$;
create trigger trg_lesson_usage after insert or update or delete on public.lessons
  for each row execute function private.on_lesson_usage();

create or replace function private.on_attendance_usage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sname text; lrow record;
begin
  perform private.refresh_student_usage(coalesce(new.student_id, old.student_id));
  if tg_op <> 'DELETE' and new.status = 'katilmadi' and (tg_op = 'INSERT' or old.status <> 'katilmadi') then
    select s.full_name into sname from public.students s where s.id = new.student_id;
    select * into lrow from public.lessons where id = new.lesson_id;
    perform private.notify(array['admin', 'personel']::public.app_role[], lrow.instructor_id,
      'devamsizlik', 'Devamsızlık', coalesce(sname, 'Öğrenci') || ' derse katılmadı (' || private.fmt_ts(lrow.starts_at) || ').',
      '/ogrenciler/' || new.student_id);
  end if;
  return null;
end $$;
create trigger trg_attendance_usage after insert or update or delete on public.attendance
  for each row execute function private.on_attendance_usage();

create or replace function private.on_settings_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if new.absence_consumes_credit is distinct from old.absence_consumes_credit then
    for sid in select id from public.students loop
      perform private.refresh_student_usage(sid);
    end loop;
  end if;
  return null;
end $$;
create trigger trg_settings_change after update on public.app_settings
  for each row execute function private.on_settings_change();

-- ---------------------------------------------------------------------------
-- Görünümler (RLS'ye uyar: security_invoker)
-- ---------------------------------------------------------------------------
create view public.v_student_balances with (security_invoker = true) as
select s.id as student_id, s.full_name, s.total_fee,
  coalesce(p.paid, 0)::numeric(12, 2) as paid,
  (s.total_fee - coalesce(p.paid, 0))::numeric(12, 2) as balance
from public.students s
left join (
  select student_id, sum(amount) as paid from public.payments where not is_void group by student_id
) p on p.student_id = s.id;

create view public.v_installments with (security_invoker = true) as
with paid as (
  select student_id, sum(amount) as total from public.payments where not is_void group by student_id
), cum as (
  select i.*, sum(i.amount) over (partition by i.student_id order by i.due_date, i.created_at, i.id) as cum_due
  from public.installments i
)
select c.id, c.student_id, c.due_date, c.amount, c.note, c.created_at,
  greatest(0, least(c.amount, coalesce(p.total, 0) - (c.cum_due - c.amount)))::numeric(12, 2) as covered,
  case
    when coalesce(p.total, 0) >= c.cum_due then 'odendi'
    when c.due_date < (now() at time zone 'Europe/Istanbul')::date then 'gecikti'
    when coalesce(p.total, 0) > c.cum_due - c.amount then 'kismi'
    else 'bekliyor'
  end as status
from cum c left join paid p on p.student_id = c.student_id;

-- ---------------------------------------------------------------------------
-- RPC: yoklama, erteleme, iptal, tekrarlayan ders üretimi
-- ---------------------------------------------------------------------------
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
  if l.status in ('iptal', 'ertelendi') and p_status <> 'izinli' then
    raise exception 'İptal edilmiş veya ertelenmiş derse yoklama girilemez.' using errcode = 'P0001';
  end if;

  insert into public.attendance (lesson_id, student_id, status, note, marked_by, marked_at)
  values (l.id, l.student_id, p_status, p_note, auth.uid(), now())
  on conflict (lesson_id) do update
    set status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = now();

  update public.lessons
  set status = case when p_status = 'izinli' then 'iptal'::public.lesson_status else 'tamamlandi'::public.lesson_status end,
      status_reason = case when p_status = 'izinli' then coalesce(p_note, 'Öğrenci izinli') else status_reason end
  where id = l.id
  returning * into l;

  perform private.refresh_student_usage(l.student_id);
  select * into l from public.lessons where id = p_lesson_id;
  return l;
end $$;

create or replace function public.clear_attendance(p_lesson_id uuid, p_expected_version int)
returns public.lessons
language plpgsql security definer set search_path = '' as $$
declare l public.lessons;
begin
  select * into l from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if not (public.has_perm('lessons') or (l.instructor_id is not null and l.instructor_id = public.my_instructor_id())) then
    raise exception 'Yetkiniz yok.' using errcode = '42501';
  end if;
  if p_expected_version is not null and l.version <> p_expected_version then
    raise exception 'Bu ders başka bir cihazda güncellendi. Lütfen yenileyip tekrar deneyin.' using errcode = '40001';
  end if;
  delete from public.attendance where lesson_id = l.id;
  update public.lessons set status = 'planlandi', status_reason = null where id = l.id returning * into l;
  perform private.refresh_student_usage(l.student_id);
  select * into l from public.lessons where id = p_lesson_id;
  return l;
end $$;

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
  delete from public.attendance where lesson_id = l.id and status <> 'izinli';
  update public.lessons set status = 'iptal', status_reason = p_reason where id = l.id returning * into l;
  return l;
end $$;

create or replace function public.reschedule_lesson(
  p_lesson_id uuid, p_expected_version int, p_new_start timestamptz, p_reason text default null)
returns public.lessons
language plpgsql security definer set search_path = '' as $$
declare l public.lessons; n public.lessons;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  select * into l from public.lessons where id = p_lesson_id for update;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if p_expected_version is not null and l.version <> p_expected_version then
    raise exception 'Bu ders başka bir cihazda güncellendi. Lütfen yenileyip tekrar deneyin.' using errcode = '40001';
  end if;
  if l.status <> 'planlandi' then
    raise exception 'Yalnızca planlanmış dersler ertelenebilir.' using errcode = 'P0001';
  end if;
  update public.lessons set status = 'ertelendi', status_reason = p_reason where id = l.id;
  insert into public.lessons (student_id, instructor_id, course_id, schedule_id, starts_at, ends_at, rescheduled_from, notes)
  values (l.student_id, l.instructor_id, l.course_id, l.schedule_id, p_new_start,
          p_new_start + (l.ends_at - l.starts_at), l.id, l.notes)
  returning * into n;
  return n;
end $$;

-- Haftalık programdan ders üretimi. Çakışan dersler atlanır ve sayısı döner.
create or replace function public.generate_schedule_lessons(p_schedule_id uuid, p_from date, p_until date)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sc public.weekly_schedules; st public.students;
  d date; ts timestamptz; created int := 0; skipped int := 0;
begin
  if not public.has_perm('lessons') then raise exception 'Yetkiniz yok.' using errcode = '42501'; end if;
  if p_until < p_from or p_until - p_from > 370 then
    raise exception 'Geçersiz tarih aralığı (en fazla 1 yıl).' using errcode = '22023';
  end if;
  select * into sc from public.weekly_schedules where id = p_schedule_id;
  if not found then raise exception 'Program bulunamadı.' using errcode = 'P0002'; end if;
  select * into st from public.students where id = sc.student_id;

  d := p_from + ((sc.weekday - extract(isodow from p_from)::int + 7) % 7);
  while d <= p_until loop
    ts := (d + sc.start_time) at time zone 'Europe/Istanbul';
    if ts > now() and not exists (
      select 1 from public.lessons l where l.schedule_id = sc.id and l.starts_at = ts
    ) then
      begin
        insert into public.lessons (student_id, instructor_id, course_id, schedule_id, starts_at, ends_at)
        values (sc.student_id, coalesce(sc.instructor_id, st.instructor_id), st.course_id, sc.id,
                ts, ts + make_interval(mins => sc.duration_minutes));
        created := created + 1;
      exception when exclusion_violation then
        skipped := skipped + 1;
      end;
    end if;
    d := d + 7;
  end loop;
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;

-- Yaklaşan ödeme bildirimleri (günlük zamanlanmış görev ve istemci tarafından çağrılır)
create or replace function public.check_payment_reminders()
returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; days int;
begin
  if auth.uid() is not null and not public.is_member() then return 0; end if;
  select payment_reminder_days into days from public.app_settings where id = 1;
  for r in
    select vi.*, s.full_name from public.v_installments vi
    join public.students s on s.id = vi.student_id
    where vi.status in ('bekliyor', 'kismi', 'gecikti') and s.is_active
      and vi.due_date <= (now() at time zone 'Europe/Istanbul')::date + days
  loop
    perform private.notify(array['admin']::public.app_role[], null,
      case when r.status = 'gecikti' then 'gecikmis_odeme' else 'yaklasan_odeme' end,
      case when r.status = 'gecikti' then 'Gecikmiş ödeme' else 'Yaklaşan ödeme' end,
      r.full_name || ': ' || to_char(r.amount - r.covered, 'FM999G999G990D00') || ' ₺ – vade ' || to_char(r.due_date, 'DD.MM.YYYY'),
      '/ogrenciler/' || r.student_id,
      'inst:' || r.id || ':' || r.status, true);
    -- yetkili personele de
    insert into public.notifications (user_id, type, title, body, link, dedupe_key)
    select p.id,
      case when r.status = 'gecikti' then 'gecikmis_odeme' else 'yaklasan_odeme' end,
      case when r.status = 'gecikti' then 'Gecikmiş ödeme' else 'Yaklaşan ödeme' end,
      r.full_name || ': vade ' || to_char(r.due_date, 'DD.MM.YYYY'),
      '/ogrenciler/' || r.student_id, 'inst:' || r.id || ':' || r.status
    from public.profiles p
    where p.role = 'personel' and p.is_active and p.approved and coalesce((p.permissions ->> 'payments')::boolean, false)
    on conflict (user_id, dedupe_key) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.mark_attendance, public.clear_attendance, public.cancel_lesson,
  public.reschedule_lesson, public.generate_schedule_lessons, public.check_payment_reminders from public, anon;
grant execute on function public.mark_attendance, public.clear_attendance, public.cancel_lesson,
  public.reschedule_lesson, public.generate_schedule_lessons, public.check_payment_reminders to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.instructors enable row level security;
alter table public.courses enable row level security;
alter table public.students enable row level security;
alter table public.student_notes enable row level security;
alter table public.weekly_schedules enable row level security;
alter table public.lessons enable row level security;
alter table public.attendance enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- profiles
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
create policy "profiles_update_self_or_admin" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles_delete_admin" on public.profiles for delete to authenticated
  using ((select public.is_admin()) and id <> (select auth.uid()));

-- app_settings
create policy "settings_select" on public.app_settings for select to authenticated using ((select public.is_member()));
create policy "settings_update" on public.app_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- instructors
create policy "instructors_select" on public.instructors for select to authenticated using ((select public.is_member()));
create policy "instructors_insert" on public.instructors for insert to authenticated with check ((select public.is_admin()));
create policy "instructors_update" on public.instructors for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "instructors_delete" on public.instructors for delete to authenticated using ((select public.is_admin()));

-- courses
create policy "courses_select" on public.courses for select to authenticated using ((select public.is_member()));
create policy "courses_insert" on public.courses for insert to authenticated with check ((select public.is_admin()));
create policy "courses_update" on public.courses for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "courses_delete" on public.courses for delete to authenticated using ((select public.is_admin()));

-- students
create policy "students_select" on public.students for select to authenticated
  using ((select public.is_staff()) or instructor_id = (select public.my_instructor_id()) or public.can_view_student(id));
create policy "students_insert" on public.students for insert to authenticated with check ((select public.has_perm('students')));
create policy "students_update" on public.students for update to authenticated
  using ((select public.has_perm('students'))) with check ((select public.has_perm('students')));
create policy "students_delete" on public.students for delete to authenticated using ((select public.is_admin()));

-- student_notes
create policy "notes_select" on public.student_notes for select to authenticated using (public.can_view_student(student_id));
create policy "notes_insert" on public.student_notes for insert to authenticated
  with check (public.can_view_student(student_id) and author_id = (select auth.uid()));
create policy "notes_delete" on public.student_notes for delete to authenticated
  using ((select public.is_admin()) or author_id = (select auth.uid()));

-- weekly_schedules
create policy "schedules_select" on public.weekly_schedules for select to authenticated
  using ((select public.is_staff()) or instructor_id = (select public.my_instructor_id()) or public.can_view_student(student_id));
create policy "schedules_insert" on public.weekly_schedules for insert to authenticated with check ((select public.has_perm('lessons')));
create policy "schedules_update" on public.weekly_schedules for update to authenticated
  using ((select public.has_perm('lessons'))) with check ((select public.has_perm('lessons')));
create policy "schedules_delete" on public.weekly_schedules for delete to authenticated using ((select public.has_perm('lessons')));

-- lessons
create policy "lessons_select" on public.lessons for select to authenticated
  using ((select public.is_staff()) or instructor_id = (select public.my_instructor_id()));
create policy "lessons_insert" on public.lessons for insert to authenticated with check ((select public.has_perm('lessons')));
create policy "lessons_update" on public.lessons for update to authenticated
  using ((select public.has_perm('lessons'))) with check ((select public.has_perm('lessons')));
create policy "lessons_delete" on public.lessons for delete to authenticated using ((select public.is_admin()));

-- attendance (yazma işlemleri mark_attendance RPC ile; admin doğrudan düzeltebilir)
create policy "attendance_select" on public.attendance for select to authenticated
  using ((select public.is_staff()) or exists (
    select 1 from public.lessons l where l.id = lesson_id and l.instructor_id = (select public.my_instructor_id())));
create policy "attendance_admin_all" on public.attendance for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- installments
create policy "installments_select" on public.installments for select to authenticated using ((select public.has_perm('payments')));
create policy "installments_insert" on public.installments for insert to authenticated with check ((select public.has_perm('payments')));
create policy "installments_update" on public.installments for update to authenticated
  using ((select public.has_perm('payments'))) with check ((select public.has_perm('payments')));
create policy "installments_delete" on public.installments for delete to authenticated using ((select public.has_perm('payments')));

-- payments (düzeltme = yönetici iptali + yeni kayıt; silme yok)
create policy "payments_select" on public.payments for select to authenticated using ((select public.has_perm('payments')));
create policy "payments_insert" on public.payments for insert to authenticated
  with check ((select public.has_perm('payments')) and not is_void);
create policy "payments_update_admin" on public.payments for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- notifications
create policy "notifications_select_own" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications_update_own" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications_delete_own" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

-- audit_logs
create policy "audit_select_admin" on public.audit_logs for select to authenticated using ((select public.is_admin()));

-- Notification kullanıcı yalnızca is_read alanını değiştirebilsin
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;

-- anon rolüne tablo erişimi verilmez
revoke all on all tables in schema public from anon;
revoke all on public.audit_logs from authenticated;
grant select on public.audit_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter table public.lessons replica identity full;
alter table public.attendance replica identity full;
alter table public.payments replica identity full;
alter table public.installments replica identity full;

alter publication supabase_realtime add table
  public.profiles, public.instructors, public.courses, public.students, public.student_notes,
  public.weekly_schedules, public.lessons, public.attendance, public.installments,
  public.payments, public.notifications, public.app_settings;
