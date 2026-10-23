-- =============================================================================
-- MUTU AKADEMİ – Girişsiz ORTAK ders alanı
-- Bağlantıyı açan herkes ders ekleyip düzenleyebilir. Bu alan YALNIZCA paylaşılabilir ders verisi içerir:
-- kurs adı, öğrenci için kısa ad/takma ad, eğitmen adı, sınıf, saat, durum, yoklama sonucu.
-- Öğrenci telefonları, veli bilgileri, ödemeler ve özel notlar ayrı tablolarda RLS ile korunmaya devam eder.
--
-- Önemli kısıt: Kimlik doğrulaması olmadığı için bağlantıyı bilen biri ortak dersleri değiştirebilir.
-- Bunu azaltmak için: yazma işlemleri yalnızca doğrulama yapan RPC'lerle, IP başına hız sınırı,
-- her değişikliğin işlem geçmişi, silmede geri alma (kalıcı silme yok), toplu silme yok.
-- =============================================================================

create table if not exists public.shared_lessons (
  id uuid primary key default gen_random_uuid(),
  course_name text not null check (length(btrim(course_name)) between 1 and 80),
  student_label text check (student_label is null or length(student_label) <= 80),
  instructor_name text check (instructor_name is null or length(instructor_name) <= 80),
  room text check (room is null or length(room) <= 60),
  title text check (title is null or length(title) <= 120),
  note text check (note is null or length(note) <= 500),
  is_group boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planlandi' check (status in ('planlandi', 'tamamlandi', 'ertelendi', 'iptal')),
  attendance text check (attendance is null or attendance in ('katildi', 'katilmadi', 'izinli', 'gec_geldi', 'erken_ayrildi')),
  started_at timestamptz,
  completed_at timestamptz,
  status_reason text check (status_reason is null or length(status_reason) <= 300),
  postpone_reason text check (postpone_reason is null or postpone_reason in ('ogrenci', 'egitmen', 'tatil', 'saglik', 'kurum', 'diger')),
  rescheduled_from uuid references public.shared_lessons (id) on delete set null,
  series_id uuid,
  deleted_at timestamptz,
  request_id uuid unique,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '10 hours')
);
create index if not exists shared_lessons_time_idx on public.shared_lessons (starts_at) where deleted_at is null;
create index if not exists shared_lessons_from_idx on public.shared_lessons (rescheduled_from);
alter table public.shared_lessons enable row level security;  -- politika yok: yalnızca RPC ile erişim
revoke all on public.shared_lessons from anon, authenticated;

create table if not exists public.shared_lesson_events (
  id bigint generated always as identity primary key,
  lesson_id uuid references public.shared_lessons (id) on delete cascade,
  action text not null,
  detail jsonb,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists shared_lesson_events_lesson_idx on public.shared_lesson_events (lesson_id, id desc);
create index if not exists shared_lesson_events_time_idx on public.shared_lesson_events (created_at desc);
alter table public.shared_lesson_events enable row level security;
revoke all on public.shared_lesson_events from anon, authenticated;

create table if not exists private.shared_writes (key text not null, at timestamptz not null default now());
create index if not exists shared_writes_idx on private.shared_writes (key, at);
create index if not exists shared_writes_at_idx on private.shared_writes (at);

-- İstemci anahtarı: IP adresinin tuzlu özeti (IP saklanmaz)
create or replace function private.client_key()
returns text language sql stable set search_path = '' as $$
  select left(encode(extensions.digest(
    coalesce(nullif(btrim(split_part(coalesce(current_setting('request.headers', true), '{}')::jsonb ->> 'x-forwarded-for', ',', 1)), ''), 'yerel')
      || ':mutu-ortak', 'sha256'), 'hex'), 16)
$$;

-- Hız sınırı: istemci başına 10 dakikada 60, tüm sistemde dakikada 300 yazma
create or replace function private.shared_guard(p_weight int default 1)
returns text language plpgsql security definer set search_path = '' as $$
declare k text := private.client_key(); n int;
begin
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

create or replace function private.shared_text(v text, maxlen int)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(coalesce(v, ''), '[\r\n\t]+', ' ', 'g')), maxlen), '')
$$;

-- Aynı eğitmen veya aynı sınıf aynı saatte iki derste olamaz
create or replace function private.shared_conflict(p_instructor text, p_room text, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when l.instructor_name is not null and p_instructor is not null and lower(l.instructor_name) = lower(p_instructor)
      then 'Çakışma: ' || l.instructor_name || ' ' || private.tr_saat(l.starts_at) || '–' || private.tr_saat(l.ends_at) || ' arasında başka derste (' || l.course_name || ').'
    else 'Çakışma: ' || l.room || ' ' || private.tr_saat(l.starts_at) || '–' || private.tr_saat(l.ends_at) || ' arasında dolu (' || l.course_name || ').' end
  from public.shared_lessons l
  where l.deleted_at is null and l.status in ('planlandi', 'tamamlandi')
    and (p_exclude is null or l.id <> p_exclude)
    and tstzrange(l.starts_at, l.ends_at) && tstzrange(p_start, p_end)
    and ((p_instructor is not null and lower(l.instructor_name) = lower(p_instructor))
         or (p_room is not null and lower(l.room) = lower(p_room)))
  limit 1
$$;

create or replace function private.shared_log(p_lesson uuid, p_action text, p_detail jsonb, p_actor text)
returns void language sql security definer set search_path = '' as $$
  insert into public.shared_lesson_events (lesson_id, action, detail, actor) values (p_lesson, p_action, p_detail, p_actor)
$$;

create or replace function private.shared_row(l public.shared_lessons)
returns jsonb language sql stable set search_path = '' as $$
  select to_jsonb(l) - 'request_id' - 'deleted_at'
$$;

-- -----------------------------------------------------------------------------
-- Okuma
-- -----------------------------------------------------------------------------
create or replace function public.shared_list(p_from timestamptz, p_to timestamptz)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select private.shared_row(l) from public.shared_lessons l
  where l.deleted_at is null and p_to > p_from and p_to - p_from <= interval '62 days'
    and l.starts_at >= p_from and l.starts_at < p_to
  order by l.starts_at
  limit 1500
$$;

create or replace function public.shared_get(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.shared_row(l) || jsonb_build_object(
    'moved_to', (select jsonb_build_object('id', n.id, 'starts_at', n.starts_at) from public.shared_lessons n where n.rescheduled_from = l.id and n.deleted_at is null limit 1),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'detail', e.detail, 'at', e.created_at) order by e.id desc)
                         from (select * from public.shared_lesson_events e2 where e2.lesson_id = l.id order by e2.id desc limit 30) e), '[]'::jsonb))
  from public.shared_lessons l where l.id = p_id
$$;

create or replace function public.shared_events(p_limit int default 30)
returns table (id bigint, lesson_id uuid, action text, course_name text, starts_at timestamptz, detail jsonb, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.lesson_id, e.action, l.course_name, l.starts_at, e.detail - 'old' - 'new', e.created_at
  from public.shared_lesson_events e left join public.shared_lessons l on l.id = e.lesson_id
  order by e.id desc limit greatest(1, least(p_limit, 100))
$$;

-- -----------------------------------------------------------------------------
-- Yazma (hepsi doğrulama + hız sınırı + işlem geçmişi)
-- p: {course_name, student_label, instructor_name, room, title, note, is_group, date, start, end, repeat_until}
-- -----------------------------------------------------------------------------
create or replace function public.shared_create(p jsonb, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k text; d0 date; d date; t1 time; t2 time; until date; s timestamptz; e timestamptz; series uuid; first_id uuid; nid uuid;
  created int := 0; c text; course text; instr text; room text; existing uuid;
begin
  if p_request_id is not null then
    select id into existing from public.shared_lessons where request_id = p_request_id;
    if found then return jsonb_build_object('created', 0, 'first_id', existing, 'duplicate', true); end if;
  end if;
  course := private.shared_text(p ->> 'course_name', 80);
  if course is null then raise exception 'Ders / kurs adını yazın.' using errcode = '22023'; end if;
  instr := private.shared_text(p ->> 'instructor_name', 80);
  room := private.shared_text(p ->> 'room', 60);
  d0 := (p ->> 'date')::date; t1 := (p ->> 'start')::time; t2 := (p ->> 'end')::time;
  if d0 is null or t1 is null or t2 is null then raise exception 'Tarih ve saat seçin.' using errcode = '22023'; end if;
  if t2 <= t1 then raise exception 'Bitiş saati başlangıç saatinden sonra olmalı.' using errcode = '22023'; end if;
  if d0 < (now() at time zone 'Europe/Istanbul')::date - 31 or d0 > (now() at time zone 'Europe/Istanbul')::date + 400 then
    raise exception 'Tarih bugünden en fazla 1 ay önce veya 13 ay sonra olabilir.' using errcode = '22023';
  end if;
  until := nullif(p ->> 'repeat_until', '')::date;
  if until is not null and (until < d0 or until > d0 + 182) then
    raise exception 'Tekrar bitişi en fazla 6 ay sonra olabilir.' using errcode = '22023';
  end if;
  k := private.shared_guard(case when until is null then 1 else least(26, ((until - d0) / 7) + 1) end);
  if until is not null then series := gen_random_uuid(); end if;

  d := d0;
  loop
    s := (d + t1) at time zone 'Europe/Istanbul';
    e := (d + t2) at time zone 'Europe/Istanbul';
    c := private.shared_conflict(instr, room, s, e);
    if c is not null then
      raise exception '% (%)', c, private.tr_tarih(s) using errcode = 'P0001';
    end if;
    insert into public.shared_lessons (course_name, student_label, instructor_name, room, title, note, is_group, starts_at, ends_at, series_id, request_id)
    values (course, private.shared_text(p ->> 'student_label', 80), instr, room, private.shared_text(p ->> 'title', 120),
            private.shared_text(p ->> 'note', 500), coalesce((p ->> 'is_group')::boolean, false), s, e, series,
            case when first_id is null then p_request_id end)
    returning id into nid;
    first_id := coalesce(first_id, nid);
    created := created + 1;
    perform private.shared_log(nid, 'olusturuldu', jsonb_build_object('starts_at', s), k);
    exit when until is null;
    d := d + 7;
    exit when d > until or created >= 26;
  end loop;
  return jsonb_build_object('created', created, 'first_id', first_id);
end $$;

create or replace function private.shared_lock(p_id uuid, p_version int)
returns public.shared_lessons language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons;
begin
  select * into l from public.shared_lessons where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Ders bulunamadı (silinmiş olabilir).' using errcode = 'P0002'; end if;
  if p_version is not null and l.version <> p_version then
    raise exception 'Bu ders başka bir telefonda değiştirildi. Güncel hali yüklendi; lütfen tekrar deneyin.' using errcode = '40001';
  end if;
  return l;
end $$;

-- Düzenleme: tarih/saat ve paylaşılabilir alanlar
create or replace function public.shared_update(p_id uuid, p_version int, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; n public.shared_lessons; k text; s timestamptz; e timestamptz; c text;
begin
  k := private.shared_guard();
  l := private.shared_lock(p_id, p_version);
  if l.status <> 'planlandi' and (p ? 'date' or p ? 'start' or p ? 'end') then
    raise exception 'Yalnızca planlanmış dersin tarihi/saati değiştirilebilir.' using errcode = 'P0001';
  end if;
  s := (coalesce(nullif(p ->> 'date', '')::date, (l.starts_at at time zone 'Europe/Istanbul')::date)
        + coalesce(nullif(p ->> 'start', '')::time, (l.starts_at at time zone 'Europe/Istanbul')::time)) at time zone 'Europe/Istanbul';
  e := (coalesce(nullif(p ->> 'date', '')::date, (l.starts_at at time zone 'Europe/Istanbul')::date)
        + coalesce(nullif(p ->> 'end', '')::time, (l.ends_at at time zone 'Europe/Istanbul')::time)) at time zone 'Europe/Istanbul';
  if e <= s then raise exception 'Bitiş saati başlangıç saatinden sonra olmalı.' using errcode = '22023'; end if;
  update public.shared_lessons set
    course_name = coalesce(case when p ? 'course_name' then private.shared_text(p ->> 'course_name', 80) end, course_name),
    student_label = case when p ? 'student_label' then private.shared_text(p ->> 'student_label', 80) else student_label end,
    instructor_name = case when p ? 'instructor_name' then private.shared_text(p ->> 'instructor_name', 80) else instructor_name end,
    room = case when p ? 'room' then private.shared_text(p ->> 'room', 60) else room end,
    title = case when p ? 'title' then private.shared_text(p ->> 'title', 120) else title end,
    note = case when p ? 'note' then private.shared_text(p ->> 'note', 500) else note end,
    is_group = coalesce((p ->> 'is_group')::boolean, is_group),
    starts_at = s, ends_at = e, version = version + 1, updated_at = now()
  where id = l.id returning * into n;
  c := case when n.status in ('planlandi', 'tamamlandi') then private.shared_conflict(n.instructor_name, n.room, n.starts_at, n.ends_at, n.id) end;
  if c is not null then raise exception '%', c using errcode = 'P0001'; end if;
  perform private.shared_log(l.id, case when s <> l.starts_at or e <> l.ends_at then 'saat_degisti' else 'duzenlendi' end,
    jsonb_build_object('old_starts_at', l.starts_at, 'starts_at', s), k);
  return private.shared_row(n);
end $$;

-- Erteleme: eski kayıt "ertelendi" olarak kalır, yeni tarihte yeni ders (eski hatırlatmalar gönderilmez)
create or replace function public.shared_postpone(p_id uuid, p_version int, p_date date, p_start time, p_end time, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; nid uuid; k text; s timestamptz; e timestamptz; c text; reason text := coalesce(nullif(p_reason, ''), 'diger');
begin
  k := private.shared_guard();
  if reason not in ('ogrenci', 'egitmen', 'tatil', 'saglik', 'kurum', 'diger') then raise exception 'Geçersiz erteleme nedeni.' using errcode = '22023'; end if;
  l := private.shared_lock(p_id, p_version);
  if l.status = 'ertelendi' then raise exception 'Bu ders zaten ertelendi.' using errcode = 'P0001'; end if;
  if l.status <> 'planlandi' then raise exception 'Yalnızca planlanmış ders ertelenebilir.' using errcode = 'P0001'; end if;
  if p_date is null or p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Yeni tarih ve saatleri doğru seçin (bitiş başlangıçtan sonra).' using errcode = '22023';
  end if;
  s := (p_date + p_start) at time zone 'Europe/Istanbul';
  e := (p_date + p_end) at time zone 'Europe/Istanbul';
  if s = l.starts_at and e = l.ends_at then raise exception 'Yeni tarih/saat eskisiyle aynı.' using errcode = 'P0001'; end if;
  update public.shared_lessons set status = 'ertelendi', postpone_reason = reason,
    status_reason = private.postpone_label(reason) || coalesce(': ' || private.shared_text(p_note, 250), ''), version = version + 1, updated_at = now()
  where id = l.id;
  c := private.shared_conflict(l.instructor_name, l.room, s, e, l.id);
  if c is not null then raise exception '% Erteleme yapılmadı.', c using errcode = 'P0001'; end if;
  insert into public.shared_lessons (course_name, student_label, instructor_name, room, title, note, is_group, starts_at, ends_at, rescheduled_from)
  values (l.course_name, l.student_label, l.instructor_name, l.room, l.title, l.note, l.is_group, s, e, l.id)
  returning id into nid;
  perform private.shared_log(l.id, 'ertelendi', jsonb_build_object('old_starts_at', l.starts_at, 'starts_at', s, 'reason', private.postpone_label(reason)), k);
  perform private.shared_log(nid, 'olusturuldu', jsonb_build_object('starts_at', s, 'rescheduled_from', l.id), k);
  return jsonb_build_object('new_id', nid);
end $$;

create or replace function public.shared_cancel(p_id uuid, p_version int, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; n public.shared_lessons; k text;
begin
  k := private.shared_guard();
  l := private.shared_lock(p_id, p_version);
  if l.status = 'iptal' then return private.shared_row(l); end if;
  if l.status <> 'planlandi' then raise exception 'Yalnızca planlanmış ders iptal edilebilir.' using errcode = 'P0001'; end if;
  update public.shared_lessons set status = 'iptal', status_reason = private.shared_text(p_reason, 300), version = version + 1, updated_at = now()
  where id = l.id returning * into n;
  perform private.shared_log(l.id, 'iptal', jsonb_build_object('reason', private.shared_text(p_reason, 300)), k);
  return private.shared_row(n);
end $$;

create or replace function public.shared_restore(p_id uuid, p_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; n public.shared_lessons; k text; c text;
begin
  k := private.shared_guard();
  l := private.shared_lock(p_id, p_version);
  if l.status <> 'iptal' then raise exception 'Yalnızca iptal edilmiş ders geri alınabilir.' using errcode = 'P0001'; end if;
  c := private.shared_conflict(l.instructor_name, l.room, l.starts_at, l.ends_at, l.id);
  if c is not null then raise exception 'İptal geri alınamadı. %', c using errcode = 'P0001'; end if;
  update public.shared_lessons set status = 'planlandi', status_reason = null, version = version + 1, updated_at = now()
  where id = l.id returning * into n;
  perform private.shared_log(l.id, 'iptal_geri_alindi', null, k);
  return private.shared_row(n);
end $$;

create or replace function public.shared_start(p_id uuid, p_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; n public.shared_lessons; k text;
begin
  k := private.shared_guard();
  l := private.shared_lock(p_id, p_version);
  if l.status <> 'planlandi' then raise exception 'Yalnızca planlanmış ders başlatılabilir.' using errcode = 'P0001'; end if;
  if l.starts_at > now() + interval '1 hour' then raise exception 'Ders saatinden 1 saatten daha erken başlatılamaz.' using errcode = 'P0001'; end if;
  if l.started_at is not null then return private.shared_row(l); end if;
  update public.shared_lessons set started_at = now(), version = version + 1, updated_at = now() where id = l.id returning * into n;
  perform private.shared_log(l.id, 'basladi', null, k);
  return private.shared_row(n);
end $$;

-- Tamamlama + yoklama (ders saati dolunca OTOMATİK tamamlanmaz; yalnızca bu işlemle). Tekrar çağrı çift kayıt oluşturmaz.
create or replace function public.shared_complete(p_id uuid, p_version int, p_attendance text default 'katildi')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; n public.shared_lessons; k text; att text := coalesce(nullif(p_attendance, ''), 'katildi');
begin
  k := private.shared_guard();
  if att not in ('katildi', 'katilmadi', 'izinli', 'gec_geldi', 'erken_ayrildi') then raise exception 'Geçersiz yoklama durumu.' using errcode = '22023'; end if;
  l := private.shared_lock(p_id, p_version);
  if l.status in ('iptal', 'ertelendi') then raise exception 'İptal edilmiş veya ertelenmiş ders tamamlanamaz.' using errcode = 'P0001'; end if;
  if l.starts_at > now() + interval '1 hour' then raise exception 'Henüz başlamamış ders tamamlanamaz.' using errcode = 'P0001'; end if;
  if l.status = 'tamamlandi' and l.attendance is not distinct from att then return private.shared_row(l); end if;
  update public.shared_lessons set status = 'tamamlandi', attendance = att, completed_at = coalesce(completed_at, now()),
    version = version + 1, updated_at = now()
  where id = l.id returning * into n;
  perform private.shared_log(l.id, case when l.status = 'tamamlandi' then 'yoklama_degisti' else 'tamamlandi' end, jsonb_build_object('attendance', att), k);
  return private.shared_row(n);
end $$;

-- Tamamlanmayı / yoklamayı geri al
create or replace function public.shared_reopen(p_id uuid, p_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; n public.shared_lessons; k text;
begin
  k := private.shared_guard();
  l := private.shared_lock(p_id, p_version);
  if l.status <> 'tamamlandi' then raise exception 'Yalnızca tamamlanmış ders geri açılabilir.' using errcode = 'P0001'; end if;
  update public.shared_lessons set status = 'planlandi', attendance = null, completed_at = null, version = version + 1, updated_at = now()
  where id = l.id returning * into n;
  perform private.shared_log(l.id, 'tamamlama_geri_alindi', null, k);
  return private.shared_row(n);
end $$;

-- Silme: kalıcı değil (geri alınabilir); tek tek, toplu silme yok
create or replace function public.shared_delete(p_id uuid, p_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; k text;
begin
  k := private.shared_guard();
  l := private.shared_lock(p_id, p_version);
  update public.shared_lessons set deleted_at = now(), version = version + 1, updated_at = now() where id = l.id;
  perform private.shared_log(l.id, 'silindi', null, k);
  return jsonb_build_object('deleted', l.id);
end $$;

create or replace function public.shared_undelete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; n public.shared_lessons; k text; c text;
begin
  k := private.shared_guard();
  select * into l from public.shared_lessons where id = p_id and deleted_at is not null for update;
  if not found then raise exception 'Geri alınacak silinmiş ders bulunamadı.' using errcode = 'P0002'; end if;
  c := case when l.status in ('planlandi', 'tamamlandi') then private.shared_conflict(l.instructor_name, l.room, l.starts_at, l.ends_at, l.id) end;
  if c is not null then raise exception 'Silme geri alınamadı. %', c using errcode = 'P0001'; end if;
  update public.shared_lessons set deleted_at = null, version = version + 1, updated_at = now() where id = l.id returning * into n;
  perform private.shared_log(l.id, 'silme_geri_alindi', null, k);
  return private.shared_row(n);
end $$;

-- -----------------------------------------------------------------------------
-- Canlı yayın (kişisel veri içermeyen "program değişti" sinyali)
-- -----------------------------------------------------------------------------
create trigger trg_shared_broadcast after insert or update or delete on public.shared_lessons
  for each statement execute function private.broadcast_schedule_change();

-- -----------------------------------------------------------------------------
-- Bildirimler: ortak ders abonelerine (girişsiz cihazlar) zamanlı ve olay bildirimleri
-- -----------------------------------------------------------------------------
alter table public.push_subscriptions add column if not exists prefs jsonb not null default '{}'::jsonb;
alter table public.push_deliveries add column if not exists shared_lesson_id uuid references public.shared_lessons (id) on delete cascade;
create unique index if not exists push_deliveries_shared_uniq on public.push_deliveries (shared_lesson_id, subscription_id, kind, lesson_starts_at)
  where shared_lesson_id is not null;
create index if not exists push_deliveries_shared_idx on public.push_deliveries (shared_lesson_id);

create or replace function private.shared_event_text(l public.shared_lessons, kind text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare c text := coalesce(nullif(l.title, ''), l.course_name); title text; body text;
begin
  case kind
    when 'lesson_60' then title := 'Ders Hatırlatması'; body := c || ' saat ' || private.tr_saat(l.starts_at, 'loc') || ' başlayacak. Dersin başlamasına 1 saat kaldı.';
    when 'lesson_15' then title := 'Ders Başlamak Üzere'; body := c || ' 15 dakika sonra başlayacak. Ders saati: ' || private.tr_saat(l.starts_at) || '.';
    when 'lesson_start' then title := 'Ders Saati Geldi'; body := c || ' başladı. Yoklama alabilir ve dersi devam ediyor olarak işaretleyebilirsiniz.';
    when 'lesson_end15' then title := 'Dersin Bitmesine Az Kaldı'; body := private.tr_genitive(c) || ' bitmesine 15 dakika kaldı. Planlanan bitiş: ' || private.tr_saat(l.ends_at) || '.';
    when 'lesson_end' then title := 'Ders Süresi Doldu'; body := private.tr_genitive(c) || ' planlanan süresi doldu. Dersi tamamlandı olarak işaretleyebilirsiniz.';
    when 'pub_time' then title := 'Ders Ertelendi'; body := c || ' yeni tarih ve saate ertelendi: ' || private.tr_tarih(l.starts_at) || ' ' || private.tr_saat(l.starts_at) || '.';
    when 'pub_cancel' then title := 'Ders İptal Edildi'; body := 'Planlanan ' || c || ' iptal edildi. (' || private.tr_tarih(l.starts_at) || ' ' || private.tr_saat(l.starts_at) || ')';
    else title := 'Ders Tamamlandı'; body := c || ' tamamlandı olarak kaydedildi.';
  end case;
  return jsonb_build_object('title', 'MUTU AKADEMİ – ' || title,
    'body', body || coalesce(E'\n' || case when l.is_group then 'Grup: ' else 'Öğrenci: ' end || l.student_label, ''),
    'url', '/?ders=' || l.id);
end $$;

create or replace function private.shared_push(l public.shared_lessons, kind text)
returns int language plpgsql security definer set search_path = '' as $$
declare txt jsonb := private.shared_event_text(l, kind); c int;
begin
  insert into public.push_deliveries (subscription_id, user_id, kind, shared_lesson_id, lesson_starts_at, title, body, url)
  select ps.id, null, kind, l.id, l.starts_at, txt ->> 'title', txt ->> 'body', txt ->> 'url'
  from public.push_subscriptions ps
  where ps.is_public and coalesce((ps.prefs ->> kind)::boolean, true)
    and (kind in ('pub_time', 'pub_cancel') or not private.in_quiet_hours(ps.prefs))
  on conflict do nothing;
  get diagnostics c = row_count;
  return c;
end $$;

-- Olay bildirimleri: erteleme (yeni ders), iptal, tamamlandı
create or replace function private.on_shared_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.rescheduled_from is not null and new.starts_at > now() and new.starts_at < now() + interval '30 days' then
      perform private.shared_push(new, 'pub_time');
    end if;
  elsif new.deleted_at is null then
    if new.status = 'iptal' and old.status <> 'iptal' and new.starts_at > now() - interval '1 hour' then
      perform private.shared_push(new, 'pub_cancel');
    elsif new.status = 'tamamlandi' and old.status <> 'tamamlandi' then
      perform private.shared_push(new, 'pub_done');
    end if;
  end if;
  return null;
end $$;
create trigger trg_shared_event after insert or update on public.shared_lessons
  for each row execute function private.on_shared_event();

-- Zamanlı bildirimler (her dakika, mevcut zamanlayıcıdan): ortak dersler de eklenir
create or replace function private.enqueue_shared_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; k record; l public.shared_lessons;
begin
  for k in select * from (values
      ('lesson_60', 'starts_at', 60), ('lesson_15', 'starts_at', 15), ('lesson_start', 'starts_at', 0),
      ('lesson_end15', 'ends_at', 15), ('lesson_end', 'ends_at', 0)) v(kind, col, minutes)
  loop
    for l in
      select * from public.shared_lessons x
      where x.status = 'planlandi' and x.deleted_at is null
        and case k.col when 'starts_at' then x.starts_at else x.ends_at end > now() + make_interval(mins => k.minutes - 2)
        and case k.col when 'starts_at' then x.starts_at else x.ends_at end <= now() + make_interval(mins => k.minutes)
        and (k.kind not in ('lesson_60', 'lesson_15', 'lesson_start') or x.started_at is null)
    loop
      n := n + private.shared_push(l, k.kind);
    end loop;
  end loop;
  return n;
end $$;

-- Mevcut her dakikalık iş: önce yetkili dersler, sonra ortak dersler
create or replace function private.enqueue_all_reminders()
returns int language plpgsql security definer set search_path = '' as $$
begin
  return private.enqueue_lesson_reminders() + private.enqueue_shared_reminders();
end $$;

create or replace function private.push_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare url text;
begin
  perform private.enqueue_all_reminders();
  perform public.check_payment_reminders();
  if exists (select 1 from public.push_deliveries
             where (status = 'pending' or (status = 'failed' and attempts < 4)
                    or (status = 'claimed' and claimed_at < now() - interval '2 minutes' and attempts < 4))
               and next_try_at <= now()) then
    select value into url from private.config where key = 'dispatch_url';
    if url is not null then
      perform net.http_post(url := url, body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb,
                            timeout_milliseconds := 25000);
    end if;
  end if;
  delete from public.push_deliveries where created_at < now() - interval '30 days';
end $$;

-- Gönderim anında son kontrol (iptal/ertelenen/silinen/tamamlanan/saati değişen derse eski bildirim gitmez)
create or replace function public.claim_push_batch(p_secret text, p_limit int default 200)
returns table (delivery_id uuid, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.dispatcher_ok(p_secret) then
    perform pg_sleep(0.3);
    raise exception 'yetkisiz' using errcode = '42501';
  end if;

  update public.push_deliveries d set status = 'skipped', last_error = 'ders değişti/iptal/tamamlandı'
  from public.lessons l
  where d.lesson_id = l.id and d.status in ('pending', 'failed')
    and d.kind in ('lesson_60', 'lesson_15', 'lesson_start', 'lesson_end15', 'lesson_end')
    and (l.status <> 'planlandi' or l.starts_at <> d.lesson_starts_at
         or (d.kind in ('lesson_60', 'lesson_15', 'lesson_start') and l.started_at is not null)
         or (d.kind in ('lesson_60', 'lesson_15') and l.starts_at < now())
         or (d.kind = 'lesson_end15' and l.ends_at < now())
         or d.created_at < now() - interval '20 minutes');
  update public.push_deliveries d set status = 'skipped', last_error = 'ortak ders değişti/iptal/silindi/tamamlandı'
  from public.shared_lessons l
  where d.shared_lesson_id = l.id and d.status in ('pending', 'failed')
    and (l.deleted_at is not null
         or (d.kind in ('lesson_60', 'lesson_15', 'lesson_start', 'lesson_end15', 'lesson_end') and (
              l.status <> 'planlandi' or l.starts_at <> d.lesson_starts_at
              or (d.kind in ('lesson_60', 'lesson_15', 'lesson_start') and l.started_at is not null)
              or (d.kind in ('lesson_60', 'lesson_15') and l.starts_at < now())
              or (d.kind = 'lesson_end15' and l.ends_at < now())
              or d.created_at < now() - interval '20 minutes'))
         or (d.kind = 'pub_cancel' and l.status <> 'iptal')
         or (d.kind = 'pub_time' and l.status not in ('planlandi')));
  update public.push_deliveries set status = 'skipped', last_error = 'süre aşımı'
  where status in ('pending', 'failed') and created_at < now() - interval '2 hours';

  return query
  with picked as (
    select d.id from public.push_deliveries d
    where (d.status = 'pending' or (d.status = 'failed' and d.attempts < 4)
           or (d.status = 'claimed' and d.claimed_at < now() - interval '2 minutes' and d.attempts < 4))
      and d.next_try_at <= now()
    order by d.created_at
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  ), upd as (
    update public.push_deliveries d
    set status = 'claimed', claimed_at = now(), attempts = d.attempts + 1
    from picked where d.id = picked.id
    returning d.*
  )
  select upd.id, s.endpoint, s.p256dh, s.auth, upd.title, upd.body, upd.url,
         case when coalesce((coalesce(pr.notification_prefs, s.prefs) ->> 'grupla')::boolean, false) then 'mutu-' || upd.kind
              else coalesce(coalesce(upd.lesson_id, upd.shared_lesson_id)::text || ':' || upd.kind, upd.notification_id::text, upd.id::text) end
  from upd join public.push_subscriptions s on s.id = upd.subscription_id
  left join public.profiles pr on pr.id = s.user_id;
end $$;

-- Girişsiz cihaz kendi bildirim tercihlerini kaydeder (yalnızca bilinen anahtarlar)
create or replace function public.set_public_push_prefs(p_endpoint text, p_prefs jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare clean jsonb := '{}'::jsonb; key text;
begin
  perform private.shared_guard();
  foreach key in array array['lesson_60', 'lesson_15', 'lesson_start', 'lesson_end15', 'lesson_end', 'pub_time', 'pub_cancel', 'pub_done', 'pub_new', 'grupla', 'quiet_enabled'] loop
    if jsonb_typeof(p_prefs -> key) = 'boolean' then clean := clean || jsonb_build_object(key, p_prefs -> key); end if;
  end loop;
  if (p_prefs ->> 'quiet_start') ~ '^\d\d:\d\d$' then clean := clean || jsonb_build_object('quiet_start', p_prefs ->> 'quiet_start'); end if;
  if (p_prefs ->> 'quiet_end') ~ '^\d\d:\d\d$' then clean := clean || jsonb_build_object('quiet_end', p_prefs ->> 'quiet_end'); end if;
  update public.push_subscriptions set prefs = clean where endpoint = p_endpoint and is_public;
  if not found then raise exception 'Bu cihaz için bildirim aboneliği bulunamadı.' using errcode = 'P0002'; end if;
end $$;

create or replace function public.get_public_push_prefs(p_endpoint text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select prefs from public.push_subscriptions where endpoint = p_endpoint and is_public
$$;

revoke execute on function public.shared_list, public.shared_get, public.shared_events, public.shared_create, public.shared_update,
  public.shared_postpone, public.shared_cancel, public.shared_restore, public.shared_start, public.shared_complete, public.shared_reopen,
  public.shared_delete, public.shared_undelete, public.set_public_push_prefs, public.get_public_push_prefs from public;
grant execute on function public.shared_list, public.shared_get, public.shared_events, public.shared_create, public.shared_update,
  public.shared_postpone, public.shared_cancel, public.shared_restore, public.shared_start, public.shared_complete, public.shared_reopen,
  public.shared_delete, public.shared_undelete, public.set_public_push_prefs, public.get_public_push_prefs to anon, authenticated;
