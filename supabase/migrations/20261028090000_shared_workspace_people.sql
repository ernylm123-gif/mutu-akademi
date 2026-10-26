-- =============================================================================
-- MUTU AKADEMİ – Girişsiz ORTAK çalışma alanında öğrenci ve eğitmen yönetimi
-- Tek arayüz: herkes öğrenci/eğitmen ekleyip ders, yoklama ve hak takibi yapabilir.
-- Bu alan YALNIZCA hassas olmayan veri tutar: ad (görünen ad), kurslar, ders hakları, haftalık program,
-- çalışma saatleri. Telefon, veli, ödeme ve özel notlar burada YOKTUR; mevcut korumalı tablolarda (RLS) kalır.
-- Erişim yalnızca doğrulamalı RPC'lerle (hız sınırı + işlem geçmişi); tablolar doğrudan okunamaz/yazılamaz.
-- İstatistikler ders/yoklama/paket kayıtlarından sunucuda hesaplanır (Europe/Istanbul); elle girilmez.
-- =============================================================================

create table if not exists public.ws_instructors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 60),
  specialty text check (specialty is null or length(specialty) <= 80),
  courses text[] not null default '{}',
  work_days int[] not null default '{}',
  work_start time,
  work_end time,
  is_active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (work_start is null or work_end is null or work_end > work_start)
);

create table if not exists public.ws_students (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 60),
  courses text[] not null default '{}',
  instructor_ids uuid[] not null default '{}',
  package_name text check (package_name is null or length(package_name) <= 80),
  default_duration int not null default 60 check (default_duration between 15 and 600),
  registered_at date not null default (now() at time zone 'Europe/Istanbul')::date,
  weekly jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ws_packages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ws_students (id) on delete cascade,
  kind text not null default 'paket' check (kind in ('paket', 'duzeltme')),
  name text not null default 'Ders paketi' check (length(btrim(name)) between 1 and 80),
  lesson_count int not null check (lesson_count between -500 and 500 and lesson_count <> 0),
  note text check (note is null or length(note) <= 200),
  is_void boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ws_packages_student_idx on public.ws_packages (student_id);

alter table public.ws_instructors enable row level security;
alter table public.ws_students enable row level security;
alter table public.ws_packages enable row level security;
revoke all on public.ws_instructors, public.ws_students, public.ws_packages from anon, authenticated;

alter table public.shared_lessons add column if not exists ws_student_ids uuid[];
alter table public.shared_lessons add column if not exists ws_instructor_id uuid references public.ws_instructors (id) on delete set null;
alter table public.shared_lessons add column if not exists ws_att jsonb;
create index if not exists shared_lessons_ws_students_idx on public.shared_lessons using gin (ws_student_ids) where deleted_at is null;
create index if not exists shared_lessons_ws_instructor_idx on public.shared_lessons (ws_instructor_id, starts_at) where deleted_at is null;

-- Değişiklik yayını (kişisel veri taşımaz)
drop trigger if exists trg_ws_broadcast on public.ws_students;
create trigger trg_ws_broadcast after insert or update or delete on public.ws_students for each statement execute function private.broadcast_schedule_change();
drop trigger if exists trg_ws_broadcast on public.ws_instructors;
create trigger trg_ws_broadcast after insert or update or delete on public.ws_instructors for each statement execute function private.broadcast_schedule_change();
drop trigger if exists trg_ws_broadcast on public.ws_packages;
create trigger trg_ws_broadcast after insert or update or delete on public.ws_packages for each statement execute function private.broadcast_schedule_change();

-- Öğrencinin bir dersteki yoklaması
create or replace function private.ws_att_of(l public.shared_lessons, p_sid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(l.ws_att ->> p_sid::text,
                  case when l.is_group and l.group_attendance is not null
                       then l.group_attendance ->> (select s.name from public.ws_students s where s.id = p_sid) end,
                  case when l.status = 'tamamlandi' then coalesce(l.attendance, 'katildi') end)
$$;

-- Ders koruması: ertelemede bağlantı aktarımı, öğrenci/eğitmen çakışması, eğitmen çalışma saatleri
create or replace function private.ws_lesson_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c record; ins public.ws_instructors; ls time; le time; wd int;
begin
  if tg_op = 'INSERT' and new.rescheduled_from is not null and new.ws_student_ids is null and new.ws_instructor_id is null then
    select o.ws_student_ids, o.ws_instructor_id into new.ws_student_ids, new.ws_instructor_id from public.shared_lessons o where o.id = new.rescheduled_from;
  end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('mutu.ws', true), '') <> 'on'
     and (new.attendance is distinct from old.attendance or new.group_attendance is distinct from old.group_attendance) then
    new.ws_att := null;
  end if;
  if new.status <> 'tamamlandi' then new.ws_att := null; end if;
  if cardinality(new.ws_student_ids) = 0 then new.ws_student_ids := null; end if;

  if new.deleted_at is null and new.status in ('planlandi', 'tamamlandi')
     and (coalesce(cardinality(new.ws_student_ids), 0) > 0 or new.ws_instructor_id is not null)
     and (tg_op = 'INSERT' or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at
          or new.ws_student_ids is distinct from old.ws_student_ids or new.ws_instructor_id is distinct from old.ws_instructor_id
          or old.deleted_at is not null or old.status not in ('planlandi', 'tamamlandi')) then
    if coalesce(cardinality(new.ws_student_ids), 0) > 0 then
      select l.course_name, l.starts_at, l.ends_at,
             (select string_agg(s.name, ', ') from public.ws_students s where s.id = any (l.ws_student_ids) and s.id = any (new.ws_student_ids)) who
        into c
      from public.shared_lessons l
      where l.id <> new.id and l.deleted_at is null and l.status in ('planlandi', 'tamamlandi')
        and l.ws_student_ids && new.ws_student_ids and tstzrange(l.starts_at, l.ends_at) && tstzrange(new.starts_at, new.ends_at)
      limit 1;
      if found then
        raise exception 'Çakışma: % % – % arasında başka derste (%, %).', c.who, private.tr_saat(c.starts_at), private.tr_saat(c.ends_at), c.course_name, private.tr_tarih(c.starts_at)
          using errcode = 'P0001';
      end if;
    end if;
    if new.ws_instructor_id is not null then
      select l.course_name, l.starts_at, l.ends_at into c
      from public.shared_lessons l
      where l.id <> new.id and l.deleted_at is null and l.status in ('planlandi', 'tamamlandi')
        and l.ws_instructor_id = new.ws_instructor_id and tstzrange(l.starts_at, l.ends_at) && tstzrange(new.starts_at, new.ends_at)
      limit 1;
      if found then
        raise exception 'Çakışma: eğitmen % – % arasında başka derste (%, %).', private.tr_saat(c.starts_at), private.tr_saat(c.ends_at), c.course_name, private.tr_tarih(c.starts_at)
          using errcode = 'P0001';
      end if;
      select * into ins from public.ws_instructors where id = new.ws_instructor_id;
      if new.status = 'planlandi' and cardinality(ins.work_days) > 0 then
        wd := extract(isodow from new.starts_at at time zone 'Europe/Istanbul')::int;
        ls := (new.starts_at at time zone 'Europe/Istanbul')::time;
        le := (new.ends_at at time zone 'Europe/Istanbul')::time;
        if not (wd = any (ins.work_days)) then
          raise exception 'Eğitmen bu gün çalışmıyor (%).', private.tr_tarih(new.starts_at) using errcode = 'P0001';
        end if;
        if (ins.work_start is not null and ls < ins.work_start) or (ins.work_end is not null and le > ins.work_end)
           or (new.ends_at at time zone 'Europe/Istanbul')::date <> (new.starts_at at time zone 'Europe/Istanbul')::date then
          raise exception 'Eğitmen bu saatte çalışmıyor (çalışma saatleri %–%).', to_char(ins.work_start, 'HH24.MI'), to_char(ins.work_end, 'HH24.MI') using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ws_lesson_guard on public.shared_lessons;
create trigger trg_ws_lesson_guard before insert or update on public.shared_lessons for each row execute function private.ws_lesson_guard();

-- Öğrenci hakları ve dönem sayaçları --------------------------------------------
create or replace function private.ws_credit(p_sid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('purchased', b.purchased, 'used', u.used, 'remaining', b.purchased - u.used)
  from (select greatest(0, coalesce(sum(lesson_count), 0))::int purchased from public.ws_packages where student_id = p_sid and not is_void) b,
       (select count(*)::int used from public.shared_lessons l
         where l.deleted_at is null and l.status = 'tamamlandi' and p_sid = any (l.ws_student_ids) and private.consumes(private.ws_att_of(l, p_sid))) u
$$;

create or replace function private.ws_student_period(p_sid uuid, p_range tstzrange)
returns jsonb language sql stable security definer set search_path = '' as $$
  with x as (
    select l.status, private.ws_att_of(l, p_sid) att, private.minutes(l) m
    from public.shared_lessons l
    where l.deleted_at is null and p_sid = any (l.ws_student_ids) and p_range @> l.starts_at)
  select jsonb_build_object(
    'planned', count(*) filter (where status in ('planlandi', 'tamamlandi')),
    'completed', count(*) filter (where status = 'tamamlandi'),
    'attended', count(*) filter (where status = 'tamamlandi' and att in ('katildi', 'gec_geldi', 'erken_ayrildi')),
    'absent', count(*) filter (where status = 'tamamlandi' and att = 'katilmadi'),
    'excused', count(*) filter (where status = 'tamamlandi' and att = 'izinli'),
    'late', count(*) filter (where status = 'tamamlandi' and att = 'gec_geldi'),
    'early', count(*) filter (where status = 'tamamlandi' and att = 'erken_ayrildi'),
    'cancelled', count(*) filter (where status = 'iptal'),
    'postponed', count(*) filter (where status = 'ertelendi'),
    'scheduled_min', coalesce(sum(m) filter (where status in ('planlandi', 'tamamlandi')), 0),
    'attended_min', coalesce(sum(m) filter (where status = 'tamamlandi' and att in ('katildi', 'gec_geldi', 'erken_ayrildi')), 0))
  from x
$$;

create or replace function private.ws_instructor_period(p_iid uuid, p_range tstzrange)
returns jsonb language sql stable security definer set search_path = '' as $$
  with x as (
    select l.status, l.attendance att, private.minutes(l) m
    from public.shared_lessons l
    where l.deleted_at is null and l.ws_instructor_id = p_iid and p_range @> l.starts_at)
  select jsonb_build_object(
    'planned', count(*) filter (where status in ('planlandi', 'tamamlandi')),
    'completed', count(*) filter (where status = 'tamamlandi'),
    'taught', count(*) filter (where status = 'tamamlandi' and coalesce(att, 'katildi') in ('katildi', 'gec_geldi', 'erken_ayrildi')),
    'no_show', count(*) filter (where status = 'tamamlandi' and att in ('katilmadi', 'izinli')),
    'cancelled', count(*) filter (where status = 'iptal'),
    'postponed', count(*) filter (where status = 'ertelendi'),
    'scheduled_min', coalesce(sum(m) filter (where status in ('planlandi', 'tamamlandi')), 0),
    'taught_min', coalesce(sum(m) filter (where status = 'tamamlandi' and coalesce(att, 'katildi') in ('katildi', 'gec_geldi', 'erken_ayrildi')), 0))
  from x
$$;

create or replace function private.ws_lesson_row(l public.shared_lessons)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.shared_row(l)
$$;

-- Okuma ---------------------------------------------------------------------------
create or replace function public.ws_directory()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'students', coalesce((select jsonb_agg(to_jsonb(s) || private.ws_credit(s.id) || jsonb_build_object(
        'next_at', (select min(l.starts_at) from public.shared_lessons l where l.deleted_at is null and s.id = any (l.ws_student_ids) and l.status = 'planlandi' and l.starts_at > now()),
        'month_min', (private.ws_student_period(s.id, private.ist_month((now() at time zone 'Europe/Istanbul')::date)) ->> 'attended_min')::int)
      order by s.name) from public.ws_students s), '[]'::jsonb),
    'instructors', coalesce((select jsonb_agg(to_jsonb(i) order by i.name) from public.ws_instructors i), '[]'::jsonb))
$$;

create or replace function public.ws_packages_of(p_sid uuid)
returns setof public.ws_packages language sql stable security definer set search_path = '' as $$
  select * from public.ws_packages where student_id = p_sid order by created_at desc limit 200
$$;

create or replace function public.ws_student_stats(p_sid uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare mon date := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/Istanbul')::date))::date;
  wk timestamptz := date_trunc('week', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
begin
  if not exists (select 1 from public.ws_students where id = p_sid) then raise exception 'Öğrenci bulunamadı.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'month_start', mon,
    'month', private.ws_student_period(p_sid, private.ist_month(mon)),
    'this_month', private.ws_student_period(p_sid, private.ist_month((now() at time zone 'Europe/Istanbul')::date)),
    'week', private.ws_student_period(p_sid, tstzrange(wk, wk + interval '7 days')),
    'total', private.ws_student_period(p_sid, tstzrange(null, null)),
    'credits', private.ws_credit(p_sid),
    'next', (select jsonb_build_object('id', l.id, 'starts_at', l.starts_at, 'ends_at', l.ends_at, 'course_name', l.course_name)
             from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.ws_student_ids) and l.status = 'planlandi' and l.starts_at > now()
             order by l.starts_at limit 1),
    'last', (select jsonb_build_object('id', l.id, 'starts_at', l.starts_at, 'ends_at', l.ends_at, 'course_name', l.course_name, 'attendance', private.ws_att_of(l, p_sid))
             from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.ws_student_ids) and l.status = 'tamamlandi'
             order by l.starts_at desc limit 1),
    'by_course', coalesce((select jsonb_agg(jsonb_build_object('course', c.course_name, 'attended', c.n, 'attended_min', c.m) order by c.m desc)
             from (select l.course_name, count(*) n, sum(private.minutes(l)) m from public.shared_lessons l
                   where l.deleted_at is null and p_sid = any (l.ws_student_ids) and l.status = 'tamamlandi'
                     and private.ws_att_of(l, p_sid) in ('katildi', 'gec_geldi', 'erken_ayrildi') group by l.course_name) c), '[]'::jsonb),
    'history', (select jsonb_agg(jsonb_build_object('month', g.m) || private.ws_student_period(p_sid, private.ist_month(g.m)) order by g.m)
                from (select (mon - (i || ' months')::interval)::date m from generate_series(0, 5) i) g),
    'lessons', coalesce((select jsonb_agg(private.shared_row(l) || jsonb_build_object('my_att', private.ws_att_of(l, p_sid)) order by l.starts_at)
             from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.ws_student_ids) and private.ist_month(mon) @> l.starts_at), '[]'::jsonb));
end $$;

create or replace function public.ws_instructor_stats(p_iid uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare mon date := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/Istanbul')::date))::date;
  td date := (now() at time zone 'Europe/Istanbul')::date;
  wk timestamptz := date_trunc('week', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
begin
  if not exists (select 1 from public.ws_instructors where id = p_iid) then raise exception 'Eğitmen bulunamadı.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'month_start', mon,
    'month', private.ws_instructor_period(p_iid, private.ist_month(mon)),
    'today', private.ws_instructor_period(p_iid, tstzrange(td::timestamp at time zone 'Europe/Istanbul', (td + 1)::timestamp at time zone 'Europe/Istanbul')),
    'week', private.ws_instructor_period(p_iid, tstzrange(wk, wk + interval '7 days')),
    'this_month', private.ws_instructor_period(p_iid, private.ist_month(td)),
    'total', private.ws_instructor_period(p_iid, tstzrange(null, null)),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'is_active', s.is_active) order by s.name)
             from public.ws_students s
             where p_iid = any (s.instructor_ids)
                or exists (select 1 from public.shared_lessons l where l.deleted_at is null and l.ws_instructor_id = p_iid and s.id = any (l.ws_student_ids)
                           and l.starts_at > now() - interval '90 days')), '[]'::jsonb),
    'history', (select jsonb_agg(jsonb_build_object('month', g.m) || private.ws_instructor_period(p_iid, private.ist_month(g.m)) order by g.m)
                from (select (mon - (i || ' months')::interval)::date m from generate_series(0, 5) i) g),
    'lessons', coalesce((select jsonb_agg(private.shared_row(l) order by l.starts_at)
             from public.shared_lessons l where l.deleted_at is null and l.ws_instructor_id = p_iid and private.ist_month(mon) @> l.starts_at), '[]'::jsonb));
end $$;

create or replace function public.ws_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare td date := (now() at time zone 'Europe/Istanbul')::date; thr int; mr tstzrange := private.ist_month((now() at time zone 'Europe/Istanbul')::date);
begin
  select coalesce(low_credit_threshold, 2) into thr from public.app_settings where id = 1;
  thr := coalesce(thr, 2);
  return jsonb_build_object(
    'active_students', (select count(*) from public.ws_students where is_active),
    'instructors', (select count(*) from public.ws_instructors where is_active),
    'today', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status <> 'ertelendi' and (l.starts_at at time zone 'Europe/Istanbul')::date = td),
    'today_completed', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'tamamlandi' and (l.starts_at at time zone 'Europe/Istanbul')::date = td),
    'upcoming', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'planlandi' and l.starts_at > now() and l.starts_at < now() + interval '7 days'),
    'month_taught_min', (select coalesce(sum(private.minutes(l)), 0) from public.shared_lessons l where l.deleted_at is null and l.status = 'tamamlandi'
              and coalesce(l.attendance, 'katildi') in ('katildi', 'gec_geldi', 'erken_ayrildi') and mr @> l.starts_at),
    'month_completed', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'tamamlandi' and mr @> l.starts_at),
    'month_postponed', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'ertelendi' and mr @> l.starts_at),
    'low_credit_threshold', thr,
    'low_credit', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'remaining', (c ->> 'remaining')::int, 'purchased', (c ->> 'purchased')::int)
                                    order by (c ->> 'remaining')::int)
              from public.ws_students s cross join lateral private.ws_credit(s.id) c
              where s.is_active and (c ->> 'purchased')::int > 0 and (c ->> 'remaining')::int <= thr), '[]'::jsonb),
    'needs_attendance', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'planlandi' and l.ends_at < now()
              and l.starts_at > now() - interval '60 days'));
end $$;

create or replace function public.ws_report(p_from date, p_to date, p_student uuid default null, p_instructor uuid default null, p_course text default null)
returns table (lesson_id uuid, starts_at timestamptz, ends_at timestamptz, course_name text, student_id uuid, student_name text,
               instructor_id uuid, instructor_name text, status text, attendance text, scheduled_min int, taught_min int, attended_min int, is_group boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Tarih aralığı en fazla 400 gün olabilir.' using errcode = '22023';
  end if;
  return query
  select l.id, l.starts_at, l.ends_at, l.course_name, sid, coalesce(s.name, l.student_label),
    l.ws_instructor_id, coalesce(i.name, l.instructor_name), l.status,
    case when sid is null then case when l.status = 'tamamlandi' then l.attendance end else private.ws_att_of(l, sid) end,
    private.minutes(l),
    case when l.status = 'tamamlandi' and coalesce(l.attendance, 'katildi') in ('katildi', 'gec_geldi', 'erken_ayrildi') then private.minutes(l) else 0 end,
    case when l.status = 'tamamlandi' and (case when sid is null then coalesce(l.attendance, 'katildi') else private.ws_att_of(l, sid) end) in ('katildi', 'gec_geldi', 'erken_ayrildi')
         then private.minutes(l) else 0 end,
    l.is_group
  from public.shared_lessons l
  left join lateral unnest(coalesce(l.ws_student_ids, array[null::uuid])) sid on true
  left join public.ws_students s on s.id = sid
  left join public.ws_instructors i on i.id = l.ws_instructor_id
  where l.deleted_at is null
    and l.starts_at >= p_from::timestamp at time zone 'Europe/Istanbul'
    and l.starts_at < (p_to + 1)::timestamp at time zone 'Europe/Istanbul'
    and (p_student is null or sid = p_student)
    and (p_instructor is null or l.ws_instructor_id = p_instructor)
    and (p_course is null or l.course_name = p_course)
  order by l.starts_at, s.name
  limit 20000;
end $$;

-- Yazma (doğrulama + hız sınırı + işlem geçmişi) ------------------------------------
create or replace function private.ws_text_array(j jsonb, maxn int, maxlen int)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array(select distinct left(btrim(x), maxlen) from jsonb_array_elements_text(coalesce(j, '[]'::jsonb)) x where btrim(x) <> '' limit maxn), '{}')
$$;

-- p: {name, courses[], instructor_ids[], package_name, default_duration, registered_at, weekly[{weekday,start,duration}], is_active, total_credits}
create or replace function public.ws_save_student(p jsonb, p_id uuid default null, p_version int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; s public.ws_students; nm text := private.shared_text(p ->> 'name', 60); iids uuid[]; wk jsonb; total int; cur int;
begin
  k := private.shared_guard();
  if nm is null or length(nm) < 2 then raise exception 'Öğrenci adını yazın.' using errcode = '22023'; end if;
  iids := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p -> 'instructor_ids', '[]'::jsonb)) x);
  if exists (select 1 from unnest(iids) x where not exists (select 1 from public.ws_instructors i where i.id = x)) then
    raise exception 'Seçilen eğitmen bulunamadı.' using errcode = '22023';
  end if;
  wk := coalesce((select jsonb_agg(jsonb_build_object('weekday', (w ->> 'weekday')::int, 'start', left(w ->> 'start', 5), 'duration', (w ->> 'duration')::int))
                  from jsonb_array_elements(coalesce(p -> 'weekly', '[]'::jsonb)) w
                  where (w ->> 'weekday')::int between 1 and 7 and (w ->> 'start') ~ '^\d\d:\d\d' and (w ->> 'duration')::int between 15 and 600), '[]'::jsonb);
  if p_id is null then
    insert into public.ws_students (name, courses, instructor_ids, package_name, default_duration, registered_at, weekly, is_active)
    values (nm, private.ws_text_array(p -> 'courses', 20, 80), iids, private.shared_text(p ->> 'package_name', 80),
            coalesce((p ->> 'default_duration')::int, 60), coalesce(nullif(p ->> 'registered_at', '')::date, (now() at time zone 'Europe/Istanbul')::date),
            wk, coalesce((p ->> 'is_active')::boolean, true))
    returning * into s;
  else
    update public.ws_students set name = nm, courses = private.ws_text_array(p -> 'courses', 20, 80), instructor_ids = iids,
      package_name = private.shared_text(p ->> 'package_name', 80), default_duration = coalesce((p ->> 'default_duration')::int, default_duration),
      registered_at = coalesce(nullif(p ->> 'registered_at', '')::date, registered_at), weekly = wk,
      is_active = coalesce((p ->> 'is_active')::boolean, is_active), version = version + 1, updated_at = now()
    where id = p_id and (p_version is null or version = p_version)
    returning * into s;
    if not found then raise exception 'Bu öğrenci başka bir cihazda değiştirildi. Kapatıp yeniden açın.' using errcode = 'P0001'; end if;
  end if;
  -- Toplam ders hakkı: fark paket/düzeltme hareketi olarak kaydedilir (hak elle düşülmez)
  if p ? 'total_credits' then
    total := greatest(0, least(2000, (p ->> 'total_credits')::int));
    select coalesce(sum(lesson_count), 0)::int into cur from public.ws_packages where student_id = s.id and not is_void;
    if total <> cur then
      insert into public.ws_packages (student_id, kind, name, lesson_count)
      values (s.id, case when cur = 0 and total > 0 then 'paket' else 'duzeltme' end,
              case when cur = 0 and total > 0 then coalesce(s.package_name, 'Başlangıç paketi') else 'Elle düzeltme' end, total - cur);
    end if;
  end if;
  perform private.shared_log(null, case when p_id is null then 'ogrenci_eklendi' else 'ogrenci_guncellendi' end, jsonb_build_object('name', s.name), k);
  return to_jsonb(s) || private.ws_credit(s.id);
end $$;

-- p: {name, specialty, courses[], work_days[], work_start, work_end, is_active}
create or replace function public.ws_save_instructor(p jsonb, p_id uuid default null, p_version int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; i public.ws_instructors; nm text := private.shared_text(p ->> 'name', 60); days int[]; ws time; we time;
begin
  k := private.shared_guard();
  if nm is null or length(nm) < 2 then raise exception 'Eğitmen adını yazın.' using errcode = '22023'; end if;
  days := coalesce(array(select distinct x::int from jsonb_array_elements_text(coalesce(p -> 'work_days', '[]'::jsonb)) x where x::int between 1 and 7 order by 1), '{}');
  ws := nullif(p ->> 'work_start', '')::time; we := nullif(p ->> 'work_end', '')::time;
  if cardinality(days) = 0 then ws := null; we := null; end if;
  if ws is not null and we is not null and we <= ws then raise exception 'Çalışma bitişi başlangıçtan sonra olmalı.' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.ws_instructors (name, specialty, courses, work_days, work_start, work_end, is_active)
    values (nm, private.shared_text(p ->> 'specialty', 80), private.ws_text_array(p -> 'courses', 20, 80), days, ws, we, coalesce((p ->> 'is_active')::boolean, true))
    returning * into i;
  else
    update public.ws_instructors set name = nm, specialty = private.shared_text(p ->> 'specialty', 80), courses = private.ws_text_array(p -> 'courses', 20, 80),
      work_days = days, work_start = ws, work_end = we, is_active = coalesce((p ->> 'is_active')::boolean, is_active), version = version + 1, updated_at = now()
    where id = p_id and (p_version is null or version = p_version)
    returning * into i;
    if not found then raise exception 'Bu eğitmen başka bir cihazda değiştirildi. Kapatıp yeniden açın.' using errcode = 'P0001'; end if;
    -- Ad değişirse bağlı derslerdeki görünen ad güncellenir
    update public.shared_lessons set instructor_name = i.name where ws_instructor_id = i.id and deleted_at is null and instructor_name is distinct from i.name;
  end if;
  perform private.shared_log(null, case when p_id is null then 'egitmen_eklendi' else 'egitmen_guncellendi' end, jsonb_build_object('name', i.name), k);
  return to_jsonb(i);
end $$;

create or replace function public.ws_add_package(p_sid uuid, p_name text, p_count int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; r public.ws_packages;
begin
  k := private.shared_guard();
  if not exists (select 1 from public.ws_students where id = p_sid) then raise exception 'Öğrenci bulunamadı.' using errcode = 'P0002'; end if;
  if p_count is null or p_count < 1 or p_count > 500 then raise exception 'Ders sayısı 1–500 arasında olmalı.' using errcode = '22023'; end if;
  insert into public.ws_packages (student_id, name, lesson_count, note)
  values (p_sid, coalesce(private.shared_text(p_name, 80), 'Ders paketi'), p_count, private.shared_text(p_note, 200)) returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.ws_void_package(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; r public.ws_packages;
begin
  k := private.shared_guard();
  update public.ws_packages set is_void = true where id = p_id and not is_void returning * into r;
  if not found then raise exception 'Paket bulunamadı veya zaten iptal.' using errcode = 'P0002'; end if;
  return to_jsonb(r);
end $$;

-- Ders: p = shared_create girdisi + {student_ids: uuid[], instructor_id: uuid}
create or replace function private.ws_payload(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare sids uuid[]; iid uuid; lbl text; iname text; n int;
begin
  if not (p ? 'student_ids' or p ? 'instructor_id') then return p; end if;
  sids := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p -> 'student_ids', '[]'::jsonb)) x);
  if cardinality(sids) > 30 then raise exception 'Bir derste en fazla 30 öğrenci olabilir.' using errcode = '22023'; end if;
  select count(*), string_agg(s.name, ', ' order by s.name) into n, lbl from public.ws_students s where s.id = any (sids);
  if n <> cardinality(sids) then raise exception 'Seçilen öğrenci bulunamadı.' using errcode = '22023'; end if;
  iid := nullif(p ->> 'instructor_id', '')::uuid;
  if iid is not null then
    select i.name into iname from public.ws_instructors i where i.id = iid;
    if not found then raise exception 'Seçilen eğitmen bulunamadı.' using errcode = '22023'; end if;
  end if;
  return p - 'student_ids' - 'instructor_id'
    || jsonb_build_object('_sids', to_jsonb(sids), '_iid', iid)
    || case when cardinality(sids) > 0 then jsonb_build_object('student_label', left(lbl, 80), 'is_group', cardinality(sids) > 1 or coalesce((p ->> 'is_group')::boolean, false)) else '{}'::jsonb end
    || case when iid is not null then jsonb_build_object('instructor_name', iname) else '{}'::jsonb end;
end $$;

create or replace function public.ws_create(p jsonb, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q jsonb; r jsonb; fid uuid; ser uuid;
begin
  q := private.ws_payload(p);
  r := public.shared_create(q - '_sids' - '_iid', p_request_id);
  if coalesce((r ->> 'duplicate')::boolean, false) or not (q ? '_sids') then return r; end if;
  fid := (r ->> 'first_id')::uuid;
  select series_id into ser from public.shared_lessons where id = fid;
  update public.shared_lessons set
    ws_student_ids = array(select x::uuid from jsonb_array_elements_text(q -> '_sids') x),
    ws_instructor_id = nullif(q ->> '_iid', '')::uuid
  where id = fid or (ser is not null and series_id = ser);
  return r;
end $$;

create or replace function public.ws_update(p_id uuid, p_version int, p jsonb, p_scope text default 'this')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q jsonb; r jsonb; l public.shared_lessons; scope text := coalesce(nullif(p_scope, ''), 'this');
begin
  select * into l from public.shared_lessons where id = p_id and deleted_at is null;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if l.series_id is null then scope := 'this'; end if;
  q := private.ws_payload(p);
  r := public.shared_update(p_id, p_version, q - '_sids' - '_iid', scope);
  if q ? '_sids' then
    update public.shared_lessons x set
      ws_student_ids = array(select y::uuid from jsonb_array_elements_text(q -> '_sids') y),
      ws_instructor_id = nullif(q ->> '_iid', '')::uuid
    where x.deleted_at is null and (
      x.id = l.id
      or (scope = 'following' and x.series_id = l.series_id and x.status = 'planlandi' and x.starts_at >= l.starts_at)
      or (scope = 'all' and x.series_id = l.series_id and x.status = 'planlandi' and x.starts_at >= least(l.starts_at, now())));
  end if;
  select * into l from public.shared_lessons where id = p_id;
  return private.shared_row(l) || jsonb_build_object('updated', coalesce((r ->> 'updated')::int, 1));
end $$;

-- Öğrenci bazında yoklama: p_att = {student_id: katildi|katilmadi|izinli|gec_geldi|erken_ayrildi}
create or replace function public.ws_complete(p_id uuid, p_version int, p_att jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; g jsonb := '{}'::jsonb; sid uuid; st text; r jsonb;
begin
  select * into l from public.shared_lessons where id = p_id and deleted_at is null;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if coalesce(cardinality(l.ws_student_ids), 0) = 0 then raise exception 'Bu ders kayıtlı öğrenciye bağlı değil.' using errcode = 'P0001'; end if;
  if p_att is null or jsonb_typeof(p_att) <> 'object' then raise exception 'Yoklama eksik.' using errcode = '22023'; end if;
  foreach sid in array l.ws_student_ids loop
    st := p_att ->> sid::text;
    if st is null or st not in ('katildi', 'katilmadi', 'izinli', 'gec_geldi', 'erken_ayrildi') then
      raise exception 'Her öğrenci için yoklama seçin.' using errcode = '22023';
    end if;
    g := g || jsonb_build_object((select s.name from public.ws_students s where s.id = sid), st);
  end loop;
  perform set_config('mutu.ws', 'on', true);
  if cardinality(l.ws_student_ids) = 1 then
    r := public.shared_complete(p_id, p_version, p_att ->> l.ws_student_ids[1]::text, null);
  else
    r := public.shared_complete(p_id, p_version, 'katildi', g);
  end if;
  update public.shared_lessons set ws_att = (select jsonb_object_agg(e.k, e.v) from jsonb_each_text(p_att) e(k, v) where e.k::uuid = any (l.ws_student_ids))
  where id = p_id returning * into l;
  return private.shared_row(l);
end $$;

grant execute on function public.ws_directory(), public.ws_packages_of(uuid), public.ws_student_stats(uuid, date), public.ws_instructor_stats(uuid, date),
  public.ws_dashboard(), public.ws_report(date, date, uuid, uuid, text), public.ws_save_student(jsonb, uuid, int), public.ws_save_instructor(jsonb, uuid, int),
  public.ws_add_package(uuid, text, int, text), public.ws_void_package(uuid), public.ws_create(jsonb, uuid), public.ws_update(uuid, int, jsonb, text),
  public.ws_complete(uuid, int, jsonb) to anon, authenticated;
