-- =============================================================================
-- MUTU AKADEMİ – Öğrenci ve eğitmen yönetimi tek ders programına bağlanır
-- * Ortak ders tablosu (shared_lessons) tek ders kaynağıdır; yetkili cihazlar dersi KORUMALI öğrenci ve
--   eğitmen kayıtlarına bağlar (student_ids, instructor_id). Bu alanlar herkese açık RPC'lerden ASLA dönmez;
--   herkese açık programda yalnızca paylaşılabilir kısa ad (public_label) görünür.
-- * Tüm istatistikler (ders sayıları, süreler, devamsızlık, kalan hak) ders/yoklama/paket kayıtlarından
--   sunucuda hesaplanır; elle girilmez. Saat dilimi Europe/Istanbul.
-- * Ders hakkı düşümü hesaplamayla yapılır (kayıt üzerinde sayaç yok) → çift düşüm olamaz.
-- Geriye dönük uyumlu: yalnızca yeni sütunlar/fonksiyonlar; mevcut veri silinmez.
-- =============================================================================

-- 1) Öğrenci ve eğitmen alanları -------------------------------------------------
alter table public.students add column if not exists public_label text check (public_label is null or length(btrim(public_label)) between 1 and 40);
alter table public.students add column if not exists registered_at date not null default (now() at time zone 'Europe/Istanbul')::date;
alter table public.students add column if not exists default_duration int not null default 60 check (default_duration between 15 and 600);
alter table public.students add column if not exists package_name text check (package_name is null or length(package_name) <= 80);
alter table public.students add column if not exists course_names text[] not null default '{}';
alter table public.students add column if not exists instructor_ids uuid[] not null default '{}';

alter table public.instructors add column if not exists public_label text check (public_label is null or length(btrim(public_label)) between 1 and 40);
alter table public.instructors add column if not exists course_names text[] not null default '{}';

-- Paylaşılabilir kısa ad: "Ezgi Kaya" → "Ezgi K."
create or replace function private.short_label(p_name text)
returns text language sql immutable set search_path = '' as $$
  select case when array_length(w, 1) > 1 then w[1] || ' ' || upper(left(w[array_length(w, 1)], 1)) || '.' else w[1] end
  from (select regexp_split_to_array(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ' ') w) x
$$;

create or replace function private.default_public_label()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.public_label is null or btrim(new.public_label) = '' then new.public_label := left(private.short_label(new.full_name), 40); end if;
  new.public_label := btrim(new.public_label);
  return new;
end $$;
drop trigger if exists trg_student_label on public.students;
create trigger trg_student_label before insert or update on public.students for each row execute function private.default_public_label();
drop trigger if exists trg_instructor_label on public.instructors;
create trigger trg_instructor_label before insert or update on public.instructors for each row execute function private.default_public_label();
update public.students set public_label = left(private.short_label(full_name), 40) where public_label is null;
update public.instructors set public_label = left(private.short_label(full_name), 40) where public_label is null;

-- 2) Ders ↔ öğrenci/eğitmen bağlantısı (yalnızca yetkili RPC'lerle okunur/yazılır) ---------
alter table public.shared_lessons add column if not exists student_ids uuid[];
alter table public.shared_lessons add column if not exists instructor_id uuid references public.instructors (id) on delete set null;
alter table public.shared_lessons add column if not exists student_att jsonb;
create index if not exists shared_lessons_students_idx on public.shared_lessons using gin (student_ids) where deleted_at is null;
create index if not exists shared_lessons_instructor_idx on public.shared_lessons (instructor_id, starts_at) where deleted_at is null;

-- Herkese açık satır: bağlantı alanları ÇIKARILIR
create or replace function private.shared_row(l public.shared_lessons)
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(l) - 'request_id' - 'deleted_at' - 'student_ids' - 'instructor_id' - 'student_att'
$$;

create or replace function private.require_staff()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.is_staff(), false) then
    raise exception 'Bu işlem yalnızca yetkili cihazlarda yapılabilir.' using errcode = '42501';
  end if;
end $$;

-- Yetkili cihazlar hız sınırına takılmaz (toplu kayıt/içe aktarma)
create or replace function private.shared_guard(p_weight int default 1)
returns text language plpgsql security definer set search_path = '' as $$
declare k text; n int;
begin
  if coalesce(public.is_staff(), false) then return 'yetkili'; end if;
  k := private.client_key();
  select count(*) into n from private.shared_writes where key = k and at > now() - interval '10 minutes';
  if n + p_weight > 60 then
    raise exception 'Çok fazla işlem yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.' using errcode = 'P0001';
  end if;
  select count(*) into n from private.shared_writes where at > now() - interval '1 minute';
  if n > 300 then raise exception 'Sistem şu an çok yoğun. Lütfen biraz sonra tekrar deneyin.' using errcode = 'P0001'; end if;
  insert into private.shared_writes (key) select k from generate_series(1, greatest(1, p_weight));
  if random() < 0.02 then delete from private.shared_writes where at < now() - interval '1 day'; end if;
  return k;
end $$;

-- Bir öğrencinin bir dersteki yoklaması (yetkili kayıt > grup yoklaması > ders özeti)
create or replace function private.att_of(l public.shared_lessons, p_sid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(l.student_att ->> p_sid::text,
                  case when l.is_group and l.group_attendance is not null
                       then l.group_attendance ->> (select s.public_label from public.students s where s.id = p_sid) end,
                  case when l.status = 'tamamlandi' then coalesce(l.attendance, 'katildi') end)
$$;

create or replace function private.minutes(l public.shared_lessons)
returns int language sql immutable set search_path = '' as $$
  select (extract(epoch from (l.ends_at - l.starts_at)) / 60)::int
$$;

-- Ders koruması: bağlı derslerde çakışma/müsaitlik kontrolü, ertelemede bağlantı aktarımı
create or replace function private.shared_people_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare staff boolean := coalesce(current_setting('mutu.staff', true), '') = 'on'; c record; ls time; le time; wd int; av text;
begin
  if tg_op = 'INSERT' and new.rescheduled_from is not null and new.student_ids is null and new.instructor_id is null then
    select o.student_ids, o.instructor_id into new.student_ids, new.instructor_id from public.shared_lessons o where o.id = new.rescheduled_from;
  end if;
  if tg_op = 'UPDATE' and not staff then
    if coalesce(cardinality(old.student_ids), 0) > 0 and new.student_label is distinct from old.student_label then
      raise exception 'Bu ders kayıtlı öğrenciye bağlı; öğrenci yalnızca yetkili cihazdan değiştirilebilir.' using errcode = 'P0001';
    end if;
    if old.instructor_id is not null and new.instructor_name is distinct from old.instructor_name then
      raise exception 'Bu ders kayıtlı eğitmene bağlı; eğitmen yalnızca yetkili cihazdan değiştirilebilir.' using errcode = 'P0001';
    end if;
    if new.attendance is distinct from old.attendance or new.group_attendance is distinct from old.group_attendance then
      new.student_att := null;
    end if;
  end if;
  if new.status <> 'tamamlandi' then new.student_att := null; end if;
  if cardinality(new.student_ids) = 0 then new.student_ids := null; end if;

  if new.deleted_at is null and new.status in ('planlandi', 'tamamlandi')
     and (coalesce(cardinality(new.student_ids), 0) > 0 or new.instructor_id is not null)
     and (tg_op = 'INSERT' or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at
          or new.student_ids is distinct from old.student_ids or new.instructor_id is distinct from old.instructor_id
          or old.deleted_at is not null or old.status not in ('planlandi', 'tamamlandi')) then
    if coalesce(cardinality(new.student_ids), 0) > 0 then
      select l.course_name, l.starts_at, l.ends_at,
             (select string_agg(s.public_label, ', ') from public.students s where s.id = any (l.student_ids) and s.id = any (new.student_ids)) who
        into c
      from public.shared_lessons l
      where l.id <> new.id and l.deleted_at is null and l.status in ('planlandi', 'tamamlandi')
        and l.student_ids && new.student_ids and tstzrange(l.starts_at, l.ends_at) && tstzrange(new.starts_at, new.ends_at)
      limit 1;
      if found then
        raise exception 'Çakışma: % % – % arasında başka derste (%, %).', c.who, private.tr_saat(c.starts_at), private.tr_saat(c.ends_at), c.course_name, private.tr_tarih(c.starts_at)
          using errcode = 'P0001';
      end if;
    end if;
    if new.instructor_id is not null then
      select l.course_name, l.starts_at, l.ends_at into c
      from public.shared_lessons l
      where l.id <> new.id and l.deleted_at is null and l.status in ('planlandi', 'tamamlandi')
        and l.instructor_id = new.instructor_id and tstzrange(l.starts_at, l.ends_at) && tstzrange(new.starts_at, new.ends_at)
      limit 1;
      if found then
        raise exception 'Çakışma: eğitmen % – % arasında başka derste (%, %).', private.tr_saat(c.starts_at), private.tr_saat(c.ends_at), c.course_name, private.tr_tarih(c.starts_at)
          using errcode = 'P0001';
      end if;
      -- Çalışma saatleri tanımlıysa ders bu saatlerin içinde olmalı (yalnızca planlanan dersler)
      if new.status = 'planlandi' and exists (select 1 from public.instructor_availability a where a.instructor_id = new.instructor_id) then
        wd := extract(isodow from new.starts_at at time zone 'Europe/Istanbul')::int;
        ls := (new.starts_at at time zone 'Europe/Istanbul')::time;
        le := (new.ends_at at time zone 'Europe/Istanbul')::time;
        if (new.ends_at at time zone 'Europe/Istanbul')::date <> (new.starts_at at time zone 'Europe/Istanbul')::date
           or not exists (select 1 from public.instructor_availability a
                          where a.instructor_id = new.instructor_id and a.weekday = wd and a.start_time <= ls and a.end_time >= le) then
          select string_agg(to_char(a.start_time, 'HH24.MI') || '–' || to_char(a.end_time, 'HH24.MI'), ', ' order by a.start_time) into av
          from public.instructor_availability a where a.instructor_id = new.instructor_id and a.weekday = wd;
          raise exception 'Eğitmen bu saatte çalışmıyor (%: %).', private.tr_tarih(new.starts_at), coalesce('çalışma saatleri ' || av, 'bu gün çalışma günü değil')
            using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_shared_people_guard on public.shared_lessons;
create trigger trg_shared_people_guard before insert or update on public.shared_lessons
  for each row execute function private.shared_people_guard();

-- Öğrenci/eğitmen/paket değişince tüm açık ekranlar yenilensin (yayın kişisel veri taşımaz)
drop trigger if exists trg_people_broadcast on public.students;
create trigger trg_people_broadcast after insert or update or delete on public.students
  for each statement execute function private.broadcast_schedule_change();
drop trigger if exists trg_people_broadcast on public.instructors;
create trigger trg_people_broadcast after insert or update or delete on public.instructors
  for each statement execute function private.broadcast_schedule_change();
drop trigger if exists trg_people_broadcast on public.lesson_packages;
create trigger trg_people_broadcast after insert or update or delete on public.lesson_packages
  for each statement execute function private.broadcast_schedule_change();
drop trigger if exists trg_people_broadcast on public.instructor_availability;
create trigger trg_people_broadcast after insert or update or delete on public.instructor_availability
  for each statement execute function private.broadcast_schedule_change();

-- 3) Yetkili ders işlemleri ------------------------------------------------------
-- p: shared_create girdisi + {student_ids: uuid[], instructor_id: uuid}
create or replace function private.people_payload(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare sids uuid[]; iid uuid; lbl text; iname text; n int;
begin
  if not (p ? 'student_ids' or p ? 'instructor_id') then return p; end if;
  sids := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p -> 'student_ids', '[]'::jsonb)) x);
  if cardinality(sids) > 30 then raise exception 'Bir derste en fazla 30 öğrenci olabilir.' using errcode = '22023'; end if;
  select count(*), string_agg(s.public_label, ', ' order by s.public_label) into n, lbl from public.students s where s.id = any (sids);
  if n <> cardinality(sids) then raise exception 'Seçilen öğrenci bulunamadı.' using errcode = '22023'; end if;
  iid := nullif(p ->> 'instructor_id', '')::uuid;
  if iid is not null then
    select i.public_label into iname from public.instructors i where i.id = iid;
    if not found then raise exception 'Seçilen eğitmen bulunamadı.' using errcode = '22023'; end if;
  end if;
  return p - 'student_ids' - 'instructor_id'
    || jsonb_build_object('_sids', to_jsonb(sids), '_iid', iid)
    || case when cardinality(sids) > 0 then jsonb_build_object('student_label', lbl, 'is_group', cardinality(sids) > 1 or coalesce((p ->> 'is_group')::boolean, false)) else '{}'::jsonb end
    || case when iid is not null then jsonb_build_object('instructor_name', iname) else '{}'::jsonb end;
end $$;

create or replace function public.staff_create(p jsonb, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q jsonb; r jsonb; fid uuid; ser uuid;
begin
  perform private.require_staff();
  q := private.people_payload(p);
  perform set_config('mutu.staff', 'on', true);
  r := public.shared_create(q - '_sids' - '_iid', p_request_id);
  if coalesce((r ->> 'duplicate')::boolean, false) or not (q ? '_sids') then return r; end if;
  fid := (r ->> 'first_id')::uuid;
  select series_id into ser from public.shared_lessons where id = fid;
  update public.shared_lessons set
    student_ids = array(select x::uuid from jsonb_array_elements_text(q -> '_sids') x),
    instructor_id = nullif(q ->> '_iid', '')::uuid
  where id = fid or (ser is not null and series_id = ser);
  return r;
end $$;

create or replace function public.staff_update(p_id uuid, p_version int, p jsonb, p_scope text default 'this')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q jsonb; r jsonb; l public.shared_lessons; scope text := coalesce(nullif(p_scope, ''), 'this');
begin
  perform private.require_staff();
  select * into l from public.shared_lessons where id = p_id and deleted_at is null;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if l.series_id is null then scope := 'this'; end if;
  q := private.people_payload(p);
  perform set_config('mutu.staff', 'on', true);
  r := public.shared_update(p_id, p_version, q - '_sids' - '_iid', scope);
  if q ? '_sids' then
    update public.shared_lessons x set
      student_ids = array(select y::uuid from jsonb_array_elements_text(q -> '_sids') y),
      instructor_id = nullif(q ->> '_iid', '')::uuid
    where x.deleted_at is null and (
      x.id = l.id
      or (scope = 'following' and x.series_id = l.series_id and x.status = 'planlandi' and x.starts_at >= l.starts_at)
      or (scope = 'all' and x.series_id = l.series_id and x.status = 'planlandi' and x.starts_at >= least(l.starts_at, now())));
  end if;
  return r;
end $$;

-- Öğrenci bazında yoklama: p_att = {student_id: katildi|katilmadi|izinli|gec_geldi|erken_ayrildi}
create or replace function public.staff_complete(p_id uuid, p_version int, p_att jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; g jsonb := '{}'::jsonb; sid uuid; st text; r jsonb; att text;
begin
  perform private.require_staff();
  select * into l from public.shared_lessons where id = p_id and deleted_at is null;
  if not found then raise exception 'Ders bulunamadı.' using errcode = 'P0002'; end if;
  if coalesce(cardinality(l.student_ids), 0) = 0 then raise exception 'Bu ders kayıtlı öğrenciye bağlı değil.' using errcode = 'P0001'; end if;
  if p_att is null or jsonb_typeof(p_att) <> 'object' then raise exception 'Yoklama eksik.' using errcode = '22023'; end if;
  foreach sid in array l.student_ids loop
    st := p_att ->> sid::text;
    if st is null or st not in ('katildi', 'katilmadi', 'izinli', 'gec_geldi', 'erken_ayrildi') then
      raise exception 'Her öğrenci için yoklama seçin.' using errcode = '22023';
    end if;
    g := g || jsonb_build_object((select s.public_label from public.students s where s.id = sid), st);
  end loop;
  perform set_config('mutu.staff', 'on', true);
  if cardinality(l.student_ids) = 1 then
    att := p_att ->> l.student_ids[1]::text;
    r := public.shared_complete(p_id, p_version, att, null);
  else
    r := public.shared_complete(p_id, p_version, 'katildi', g);
  end if;
  update public.shared_lessons set student_att = (select jsonb_object_agg(k, v) from jsonb_each_text(p_att) e(k, v) where k::uuid = any (l.student_ids))
  where id = p_id;
  return r;
end $$;

-- Yetkili cihaz için bağlantılı ders satırı
create or replace function private.staff_row(l public.shared_lessons)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.shared_row(l) || jsonb_build_object('student_ids', coalesce(to_jsonb(l.student_ids), '[]'::jsonb), 'instructor_id', l.instructor_id, 'student_att', l.student_att)
$$;

create or replace function public.staff_links(p_ids uuid[])
returns table (id uuid, student_ids uuid[], instructor_id uuid, student_att jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query select l.id, l.student_ids, l.instructor_id, l.student_att from public.shared_lessons l where l.id = any (p_ids) and cardinality(p_ids) <= 2000;
end $$;

-- 4) Hesaplanan istatistikler -----------------------------------------------------
create or replace function private.ist_month(p date)
returns tstzrange language sql stable set search_path = '' as $$
  select tstzrange((date_trunc('month', p)::date)::timestamp at time zone 'Europe/Istanbul',
                   ((date_trunc('month', p) + interval '1 month')::date)::timestamp at time zone 'Europe/Istanbul')
$$;

create or replace function private.consumes(att text)
returns boolean language sql stable security definer set search_path = '' as $$
  select att in ('katildi', 'gec_geldi', 'erken_ayrildi')
      or (att = 'katilmadi' and coalesce((select absence_consumes_credit from public.app_settings where id = 1), true))
$$;

create or replace function private.student_credit(p_sid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('purchased', b.purchased, 'used', u.used, 'remaining', b.purchased - u.used)
  from (select greatest(0, coalesce(sum(lesson_count), 0))::int purchased from public.lesson_packages where student_id = p_sid and not is_void) b,
       (select count(*)::int used from public.shared_lessons l
         where l.deleted_at is null and l.status = 'tamamlandi' and p_sid = any (l.student_ids) and private.consumes(private.att_of(l, p_sid))) u
$$;

-- Bir dönem için öğrenci sayaçları
create or replace function private.student_period(p_sid uuid, p_range tstzrange)
returns jsonb language sql stable security definer set search_path = '' as $$
  with x as (
    select l.status, private.att_of(l, p_sid) att, private.minutes(l) m
    from public.shared_lessons l
    where l.deleted_at is null and p_sid = any (l.student_ids) and p_range @> l.starts_at)
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

create or replace function public.staff_student_stats(p_sid uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare mon date := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/Istanbul')::date))::date;
  wk timestamptz := date_trunc('week', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
begin
  perform private.require_staff();
  if not exists (select 1 from public.students where id = p_sid) then raise exception 'Öğrenci bulunamadı.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'month_start', mon,
    'month', private.student_period(p_sid, private.ist_month(mon)),
    'this_month', private.student_period(p_sid, private.ist_month((now() at time zone 'Europe/Istanbul')::date)),
    'week', private.student_period(p_sid, tstzrange(wk, wk + interval '7 days')),
    'total', private.student_period(p_sid, tstzrange(null, null)),
    'credits', private.student_credit(p_sid),
    'next', (select jsonb_build_object('id', l.id, 'starts_at', l.starts_at, 'ends_at', l.ends_at, 'course_name', l.course_name)
             from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.student_ids) and l.status = 'planlandi' and l.starts_at > now()
             order by l.starts_at limit 1),
    'last', (select jsonb_build_object('id', l.id, 'starts_at', l.starts_at, 'ends_at', l.ends_at, 'course_name', l.course_name, 'attendance', private.att_of(l, p_sid))
             from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.student_ids) and l.status = 'tamamlandi'
             order by l.starts_at desc limit 1),
    'by_course', coalesce((select jsonb_agg(jsonb_build_object('course', c.course_name, 'attended', c.n, 'attended_min', c.m) order by c.m desc)
             from (select l.course_name, count(*) n, sum(private.minutes(l)) m from public.shared_lessons l
                   where l.deleted_at is null and p_sid = any (l.student_ids) and l.status = 'tamamlandi'
                     and private.att_of(l, p_sid) in ('katildi', 'gec_geldi', 'erken_ayrildi') group by l.course_name) c), '[]'::jsonb),
    'history', (select jsonb_agg(jsonb_build_object('month', g.m) || private.student_period(p_sid, private.ist_month(g.m)) order by g.m)
                from (select (mon - (i || ' months')::interval)::date m from generate_series(0, 5) i) g),
    'lessons', coalesce((select jsonb_agg(private.staff_row(l) || jsonb_build_object('my_att', private.att_of(l, p_sid)) order by l.starts_at)
             from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.student_ids) and private.ist_month(mon) @> l.starts_at), '[]'::jsonb));
end $$;

-- Eğitmen: ders süresi grup derslerinde BİR kez sayılır; öğrencinin gelmediği/izinli olduğu ders eğitim süresine eklenmez
create or replace function private.instructor_period(p_iid uuid, p_range tstzrange)
returns jsonb language sql stable security definer set search_path = '' as $$
  with x as (
    select l.status, l.attendance att, private.minutes(l) m
    from public.shared_lessons l
    where l.deleted_at is null and l.instructor_id = p_iid and p_range @> l.starts_at)
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

create or replace function public.staff_instructor_stats(p_iid uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare mon date := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/Istanbul')::date))::date;
  td date := (now() at time zone 'Europe/Istanbul')::date;
  wk timestamptz := date_trunc('week', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
begin
  perform private.require_staff();
  if not exists (select 1 from public.instructors where id = p_iid) then raise exception 'Eğitmen bulunamadı.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'month_start', mon,
    'month', private.instructor_period(p_iid, private.ist_month(mon)),
    'today', private.instructor_period(p_iid, tstzrange(td::timestamp at time zone 'Europe/Istanbul', (td + 1)::timestamp at time zone 'Europe/Istanbul')),
    'week', private.instructor_period(p_iid, tstzrange(wk, wk + interval '7 days')),
    'this_month', private.instructor_period(p_iid, private.ist_month(td)),
    'total', private.instructor_period(p_iid, tstzrange(null, null)),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'is_active', s.is_active) order by s.full_name)
             from public.students s
             where s.instructor_id = p_iid or p_iid = any (s.instructor_ids)
                or exists (select 1 from public.shared_lessons l where l.deleted_at is null and l.instructor_id = p_iid and s.id = any (l.student_ids)
                           and l.starts_at > now() - interval '90 days')), '[]'::jsonb),
    'history', (select jsonb_agg(jsonb_build_object('month', g.m) || private.instructor_period(p_iid, private.ist_month(g.m)) order by g.m)
                from (select (mon - (i || ' months')::interval)::date m from generate_series(0, 5) i) g),
    'lessons', coalesce((select jsonb_agg(private.staff_row(l) order by l.starts_at)
             from public.shared_lessons l where l.deleted_at is null and l.instructor_id = p_iid and private.ist_month(mon) @> l.starts_at), '[]'::jsonb));
end $$;

-- Liste görünümü için öğrenci özetleri (kalan hak, sonraki ders, bu ay süre)
create or replace function public.staff_students_overview()
returns table (id uuid, purchased int, used int, remaining int, next_at timestamptz, month_min int, month_attended int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query
  select s.id, (c ->> 'purchased')::int, (c ->> 'used')::int, (c ->> 'remaining')::int,
    (select min(l.starts_at) from public.shared_lessons l where l.deleted_at is null and s.id = any (l.student_ids) and l.status = 'planlandi' and l.starts_at > now()),
    (mp ->> 'attended_min')::int, (mp ->> 'attended')::int
  from public.students s
  cross join lateral private.student_credit(s.id) c
  cross join lateral private.student_period(s.id, private.ist_month((now() at time zone 'Europe/Istanbul')::date)) mp;
end $$;

create or replace function public.staff_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare td date := (now() at time zone 'Europe/Istanbul')::date; thr int; mr tstzrange := private.ist_month((now() at time zone 'Europe/Istanbul')::date);
begin
  perform private.require_staff();
  select coalesce(low_credit_threshold, 2) into thr from public.app_settings where id = 1;
  return jsonb_build_object(
    'active_students', (select count(*) from public.students where is_active),
    'instructors', (select count(*) from public.instructors where is_active),
    'today', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status <> 'ertelendi'
              and (l.starts_at at time zone 'Europe/Istanbul')::date = td),
    'today_completed', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'tamamlandi'
              and (l.starts_at at time zone 'Europe/Istanbul')::date = td),
    'upcoming', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'planlandi'
              and l.starts_at > now() and l.starts_at < now() + interval '7 days'),
    'month_taught_min', (select coalesce(sum(private.minutes(l)), 0) from public.shared_lessons l where l.deleted_at is null and l.status = 'tamamlandi'
              and coalesce(l.attendance, 'katildi') in ('katildi', 'gec_geldi', 'erken_ayrildi') and mr @> l.starts_at),
    'month_completed', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'tamamlandi' and mr @> l.starts_at),
    'month_postponed', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'ertelendi' and mr @> l.starts_at),
    'low_credit_threshold', thr,
    'low_credit', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'remaining', (c ->> 'remaining')::int, 'purchased', (c ->> 'purchased')::int)
                                    order by (c ->> 'remaining')::int)
              from public.students s cross join lateral private.student_credit(s.id) c
              where s.is_active and (c ->> 'purchased')::int > 0 and (c ->> 'remaining')::int <= thr), '[]'::jsonb),
    'needs_attendance', (select count(*) from public.shared_lessons l where l.deleted_at is null and l.status = 'planlandi' and l.ends_at < now()
              and l.starts_at > now() - interval '60 days'));
end $$;

-- Rapor satırları: öğrenci başına bir satır (bağlı değilse kısa adla bir satır)
create or replace function public.staff_report(p_from date, p_to date, p_student uuid default null, p_instructor uuid default null, p_course text default null)
returns table (lesson_id uuid, starts_at timestamptz, ends_at timestamptz, course_name text, student_id uuid, student_name text,
               instructor_id uuid, instructor_name text, status text, attendance text, scheduled_min int, taught_min int, attended_min int, is_group boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Tarih aralığı en fazla 400 gün olabilir.' using errcode = '22023';
  end if;
  return query
  select l.id, l.starts_at, l.ends_at, l.course_name, sid, coalesce(s.full_name, l.student_label),
    l.instructor_id, coalesce(i.full_name, l.instructor_name), l.status,
    case when sid is null then case when l.status = 'tamamlandi' then l.attendance end else private.att_of(l, sid) end,
    private.minutes(l),
    case when l.status = 'tamamlandi' and coalesce(l.attendance, 'katildi') in ('katildi', 'gec_geldi', 'erken_ayrildi') then private.minutes(l) else 0 end,
    case when l.status = 'tamamlandi' and (case when sid is null then coalesce(l.attendance, 'katildi') else private.att_of(l, sid) end) in ('katildi', 'gec_geldi', 'erken_ayrildi')
         then private.minutes(l) else 0 end,
    l.is_group
  from public.shared_lessons l
  left join lateral unnest(coalesce(l.student_ids, array[null::uuid])) sid on true
  left join public.students s on s.id = sid
  left join public.instructors i on i.id = l.instructor_id
  where l.deleted_at is null
    and l.starts_at >= p_from::timestamp at time zone 'Europe/Istanbul'
    and l.starts_at < (p_to + 1)::timestamp at time zone 'Europe/Istanbul'
    and (p_student is null or sid = p_student)
    and (p_instructor is null or l.instructor_id = p_instructor)
    and (p_course is null or l.course_name = p_course)
  order by l.starts_at, s.full_name
  limit 20000;
end $$;

-- Çalışma günleri/saatleri tek seferde (gün başına bir aralık)
create or replace function public.staff_set_availability(p_iid uuid, p_days int[], p_start time, p_end time)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if not exists (select 1 from public.instructors where id = p_iid) then raise exception 'Eğitmen bulunamadı.' using errcode = 'P0002'; end if;
  if cardinality(p_days) > 0 and (p_start is null or p_end is null or p_end <= p_start) then
    raise exception 'Müsaitlik bitişi başlangıçtan sonra olmalı.' using errcode = '22023';
  end if;
  delete from public.instructor_availability where instructor_id = p_iid;
  insert into public.instructor_availability (instructor_id, weekday, start_time, end_time)
  select p_iid, d, p_start, p_end from unnest(p_days) d where d between 1 and 7 group by d;
end $$;

revoke all on function public.staff_create(jsonb, uuid), public.staff_update(uuid, int, jsonb, text), public.staff_complete(uuid, int, jsonb),
  public.staff_links(uuid[]), public.staff_student_stats(uuid, date), public.staff_instructor_stats(uuid, date), public.staff_students_overview(),
  public.staff_dashboard(), public.staff_report(date, date, uuid, uuid, text), public.staff_set_availability(uuid, int[], time, time) from public, anon;
grant execute on function public.staff_create(jsonb, uuid), public.staff_update(uuid, int, jsonb, text), public.staff_complete(uuid, int, jsonb),
  public.staff_links(uuid[]), public.staff_student_stats(uuid, date), public.staff_instructor_stats(uuid, date), public.staff_students_overview(),
  public.staff_dashboard(), public.staff_report(date, date, uuid, uuid, text), public.staff_set_availability(uuid, int[], time, time) to authenticated;
