-- =============================================================================
-- Ortak ders alanı: grup dersinde öğrenci başına yoklama, seri düzenleme (bu / sonrakiler / tüm seri),
-- tablo (Excel/CSV) içe aktarma ön kontrolü ve aktarımı. Geriye uyumlu; yalnızca paylaşılabilir veri.
-- =============================================================================

alter table public.shared_lessons add column if not exists group_attendance jsonb;

-- Tamamlama + yoklama; grup dersinde p_group = {"Ezgi":"katildi","Mert":"izinli"}
drop function if exists public.shared_complete(uuid, int, text);
create or replace function public.shared_complete(p_id uuid, p_version int, p_attendance text default 'katildi', p_group jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; n public.shared_lessons; k text; att text := coalesce(nullif(p_attendance, ''), 'katildi'); g jsonb; key text;
begin
  k := private.shared_guard();
  if att not in ('katildi', 'katilmadi', 'izinli', 'gec_geldi', 'erken_ayrildi') then raise exception 'Geçersiz yoklama durumu.' using errcode = '22023'; end if;
  if p_group is not null then
    if jsonb_typeof(p_group) <> 'object' then raise exception 'Geçersiz grup yoklaması.' using errcode = '22023'; end if;
    g := '{}'::jsonb;
    for key in select jsonb_object_keys(p_group) loop
      if length(key) > 80 or (p_group ->> key) not in ('katildi', 'katilmadi', 'izinli', 'gec_geldi', 'erken_ayrildi') then
        raise exception 'Geçersiz grup yoklaması.' using errcode = '22023';
      end if;
      g := g || jsonb_build_object(key, p_group ->> key);
    end loop;
    -- dersin genel yoklama özeti: en az biri katıldıysa "katildi"
    att := case when exists (select 1 from jsonb_each_text(g) x where x.value in ('katildi', 'gec_geldi', 'erken_ayrildi')) then 'katildi'
                when exists (select 1 from jsonb_each_text(g) x where x.value = 'katilmadi') then 'katilmadi' else 'izinli' end;
  end if;
  l := private.shared_lock(p_id, p_version);
  if l.status in ('iptal', 'ertelendi') then raise exception 'İptal edilmiş veya ertelenmiş ders tamamlanamaz.' using errcode = 'P0001'; end if;
  if l.starts_at > now() + interval '1 hour' then raise exception 'Henüz başlamamış ders tamamlanamaz.' using errcode = 'P0001'; end if;
  if l.status = 'tamamlandi' and l.attendance is not distinct from att and l.group_attendance is not distinct from g then return private.shared_row(l); end if;
  update public.shared_lessons set status = 'tamamlandi', attendance = att, group_attendance = g, completed_at = coalesce(completed_at, now()),
    version = version + 1, updated_at = now()
  where id = l.id returning * into n;
  perform private.shared_log(l.id, case when l.status = 'tamamlandi' then 'yoklama_degisti' else 'tamamlandi' end,
    jsonb_build_object('attendance', att) || case when g is not null then jsonb_build_object('group', g) else '{}'::jsonb end, k);
  return private.shared_row(n);
end $$;

create or replace function public.shared_reopen(p_id uuid, p_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; n public.shared_lessons; k text;
begin
  k := private.shared_guard();
  l := private.shared_lock(p_id, p_version);
  if l.status <> 'tamamlandi' then raise exception 'Yalnızca tamamlanmış ders geri açılabilir.' using errcode = 'P0001'; end if;
  update public.shared_lessons set status = 'planlandi', attendance = null, group_attendance = null, completed_at = null, version = version + 1, updated_at = now()
  where id = l.id returning * into n;
  perform private.shared_log(l.id, 'tamamlama_geri_alindi', null, k);
  return private.shared_row(n);
end $$;

-- Düzenleme kapsamı: this (yalnızca bu ders), following (bu ve sonraki), all (serinin gelecekteki tümü).
-- Seri kapsamında tarih değişmez; saat ve bilgiler her derse uygulanır. Geçmiş/tamamlanan dersler etkilenmez.
drop function if exists public.shared_update(uuid, int, jsonb);
create or replace function public.shared_update(p_id uuid, p_version int, p jsonb, p_scope text default 'this')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; r public.shared_lessons; n public.shared_lessons; k text; s timestamptz; e timestamptz; c text; cnt int := 0;
  scope text := coalesce(nullif(p_scope, ''), 'this');
begin
  if scope not in ('this', 'following', 'all') then raise exception 'Geçersiz kapsam.' using errcode = '22023'; end if;
  l := private.shared_lock(p_id, p_version);
  if l.series_id is null then scope := 'this'; end if;
  k := private.shared_guard(case when scope = 'this' then 1 else 3 end);
  if l.status <> 'planlandi' and (p ? 'date' or p ? 'start' or p ? 'end') then
    raise exception 'Yalnızca planlanmış dersin tarihi/saati değiştirilebilir.' using errcode = 'P0001';
  end if;
  for r in
    select * from public.shared_lessons x
    where x.deleted_at is null and (
      x.id = l.id
      or (scope = 'following' and x.series_id = l.series_id and x.status = 'planlandi' and x.starts_at >= l.starts_at)
      or (scope = 'all' and x.series_id = l.series_id and x.status = 'planlandi' and x.starts_at >= least(l.starts_at, now())))
    order by x.starts_at for update
  loop
    s := (coalesce(case when scope = 'this' then nullif(p ->> 'date', '')::date end, (r.starts_at at time zone 'Europe/Istanbul')::date)
          + coalesce(nullif(p ->> 'start', '')::time, (r.starts_at at time zone 'Europe/Istanbul')::time)) at time zone 'Europe/Istanbul';
    e := (coalesce(case when scope = 'this' then nullif(p ->> 'date', '')::date end, (r.starts_at at time zone 'Europe/Istanbul')::date)
          + coalesce(nullif(p ->> 'end', '')::time, (r.ends_at at time zone 'Europe/Istanbul')::time)) at time zone 'Europe/Istanbul';
    if e <= s then raise exception 'Bitiş saati başlangıç saatinden sonra olmalı.' using errcode = '22023'; end if;
    update public.shared_lessons set
      course_name = coalesce(case when p ? 'course_name' then private.shared_text(p ->> 'course_name', 80) end, course_name),
      student_label = case when p ? 'student_label' then private.shared_text(p ->> 'student_label', 80) else student_label end,
      instructor_name = case when p ? 'instructor_name' then private.shared_text(p ->> 'instructor_name', 80) else instructor_name end,
      room = case when p ? 'room' then private.shared_text(p ->> 'room', 60) else room end,
      title = case when p ? 'title' then private.shared_text(p ->> 'title', 120) else title end,
      note = case when p ? 'note' then private.shared_text(p ->> 'note', 500) else note end,
      is_group = coalesce((p ->> 'is_group')::boolean, is_group),
      starts_at = case when status = 'planlandi' then s else starts_at end,
      ends_at = case when status = 'planlandi' then e else ends_at end,
      version = version + 1, updated_at = now()
    where id = r.id returning * into n;
    c := case when n.status in ('planlandi', 'tamamlandi') then private.shared_conflict(n.instructor_name, n.room, n.starts_at, n.ends_at, n.id) end;
    if c is not null then raise exception '% (%)', c, private.tr_tarih(n.starts_at) using errcode = 'P0001'; end if;
    perform private.shared_log(r.id, case when n.starts_at <> r.starts_at or n.ends_at <> r.ends_at then 'saat_degisti' else 'duzenlendi' end,
      jsonb_build_object('old_starts_at', r.starts_at, 'starts_at', n.starts_at) || case when scope <> 'this' then jsonb_build_object('scope', scope) else '{}'::jsonb end, k);
    cnt := cnt + 1;
  end loop;
  select * into n from public.shared_lessons where id = l.id;
  return private.shared_row(n) || jsonb_build_object('updated', cnt);
end $$;

-- Seri silme (planlı, gelecekteki dersler; geri alınabilir)
create or replace function public.shared_delete_series(p_id uuid, p_version int, p_scope text default 'following')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.shared_lessons; k text; ids uuid[];
begin
  if coalesce(p_scope, '') not in ('following', 'all') then raise exception 'Geçersiz kapsam.' using errcode = '22023'; end if;
  l := private.shared_lock(p_id, p_version);
  if l.series_id is null then raise exception 'Bu ders bir serinin parçası değil.' using errcode = 'P0001'; end if;
  k := private.shared_guard(3);
  select array_agg(id) into ids from public.shared_lessons x
  where x.deleted_at is null and x.series_id = l.series_id and x.status in ('planlandi', 'iptal')
    and x.starts_at >= case when p_scope = 'following' then l.starts_at else least(l.starts_at, now()) end;
  update public.shared_lessons set deleted_at = now(), version = version + 1, updated_at = now() where id = any (coalesce(ids, '{}'));
  perform private.shared_log(x, 'silindi', jsonb_build_object('scope', p_scope), k) from unnest(coalesce(ids, '{}')) x;
  return jsonb_build_object('deleted', coalesce(array_length(ids, 1), 0), 'ids', to_jsonb(coalesce(ids, '{}')));
end $$;

create or replace function public.shared_undelete_many(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text; n int;
begin
  if coalesce(array_length(p_ids, 1), 0) > 60 then raise exception 'Tek seferde en fazla 60 ders geri alınabilir.' using errcode = 'P0001'; end if;
  k := private.shared_guard(2);
  update public.shared_lessons set deleted_at = null, version = version + 1, updated_at = now()
  where id = any (p_ids) and deleted_at is not null and deleted_at > now() - interval '1 day';
  get diagnostics n = row_count;
  perform private.shared_log(x, 'silme_geri_alindi', null, k) from unnest(p_ids) x;
  return jsonb_build_object('restored', n);
end $$;

-- -----------------------------------------------------------------------------
-- İçe aktarma: p_rows = [{course_name, student_label, instructor_name, room, title, is_group, date, start, end, repeat_until}]
-- -----------------------------------------------------------------------------
create or replace function private.shared_row_occurrences(rw jsonb)
returns table (s timestamptz, e timestamptz) language plpgsql stable set search_path = '' as $$
declare d0 date := (rw ->> 'date')::date; t1 time := (rw ->> 'start')::time; t2 time := (rw ->> 'end')::time;
  until date := nullif(rw ->> 'repeat_until', '')::date; d date; n int := 0;
begin
  if d0 is null or t1 is null or t2 is null then raise exception 'Tarih ve saat eksik.' using errcode = '22023'; end if;
  if t2 <= t1 then raise exception 'Bitiş saati başlangıçtan önce.' using errcode = '22023'; end if;
  if d0 < (now() at time zone 'Europe/Istanbul')::date - 31 or d0 > (now() at time zone 'Europe/Istanbul')::date + 400 then
    raise exception 'Tarih aralık dışında.' using errcode = '22023';
  end if;
  if until is not null and (until < d0 or until > d0 + 182) then raise exception 'Tekrar bitişi en fazla 6 ay sonra olabilir.' using errcode = '22023'; end if;
  d := d0;
  loop
    s := (d + t1) at time zone 'Europe/Istanbul'; e := (d + t2) at time zone 'Europe/Istanbul';
    return next;
    n := n + 1;
    exit when until is null; d := d + 7; exit when d > until or n >= 26;
  end loop;
end $$;

create or replace function public.shared_check_import(p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rw jsonb; o record; out jsonb := '[]'::jsonb; idx int := 0; cnt int; conf int; dup int; msgs jsonb; inst text; room text;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 300 then raise exception 'En fazla 300 satır.' using errcode = 'P0001'; end if;
  for rw in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1; cnt := 0; conf := 0; dup := 0; msgs := '[]'::jsonb;
    inst := private.shared_text(rw ->> 'instructor_name', 80); room := private.shared_text(rw ->> 'room', 60);
    begin
      if private.shared_text(rw ->> 'course_name', 80) is null then raise exception 'Kurs adı yok.'; end if;
      for o in select * from private.shared_row_occurrences(rw) loop
        cnt := cnt + 1;
        if exists (select 1 from public.shared_lessons l where l.deleted_at is null and l.status in ('planlandi', 'tamamlandi')
                   and l.starts_at = o.s and lower(l.course_name) = lower(btrim(rw ->> 'course_name'))
                   and coalesce(lower(l.student_label), '') = coalesce(lower(btrim(rw ->> 'student_label')), '')) then
          dup := dup + 1;
          if jsonb_array_length(msgs) < 2 then msgs := msgs || to_jsonb(private.tr_tarih(o.s) || ' ' || private.tr_saat(o.s) || ': zaten kayıtlı'); end if;
        elsif private.shared_conflict(inst, room, o.s, o.e) is not null then
          conf := conf + 1;
          if jsonb_array_length(msgs) < 2 then msgs := msgs || to_jsonb(private.tr_tarih(o.s) || ' – ' || private.shared_conflict(inst, room, o.s, o.e)); end if;
        end if;
      end loop;
      out := out || jsonb_build_object('row', idx, 'count', cnt, 'conflicts', conf, 'duplicates', dup, 'messages', msgs);
    exception when others then
      out := out || jsonb_build_object('row', idx, 'count', 0, 'error', sqlerrm);
    end;
  end loop;
  return out;
end $$;

create or replace function public.shared_import(p_rows jsonb, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rw jsonb; o record; k text; created int := 0; skipped int := 0; series uuid; inst text; room text; course text; first_id uuid; nid uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'İçe aktarılacak satır yok.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'Tek seferde en fazla 300 satır.' using errcode = 'P0001'; end if;
  if p_request_id is not null and exists (select 1 from public.shared_lessons where request_id = p_request_id) then
    return jsonb_build_object('created', 0, 'skipped', 0, 'duplicate', true);
  end if;
  k := private.shared_guard(10);
  for rw in select * from jsonb_array_elements(p_rows) loop
    course := private.shared_text(rw ->> 'course_name', 80);
    if course is null then skipped := skipped + 1; continue; end if;
    inst := private.shared_text(rw ->> 'instructor_name', 80); room := private.shared_text(rw ->> 'room', 60);
    series := case when nullif(rw ->> 'repeat_until', '') is not null then gen_random_uuid() end;
    for o in select * from private.shared_row_occurrences(rw) loop
      if private.shared_conflict(inst, room, o.s, o.e) is not null
         or exists (select 1 from public.shared_lessons l where l.deleted_at is null and l.status in ('planlandi', 'tamamlandi')
                    and l.starts_at = o.s and lower(l.course_name) = lower(course)
                    and coalesce(lower(l.student_label), '') = coalesce(lower(private.shared_text(rw ->> 'student_label', 80)), '')) then
        skipped := skipped + 1; continue;
      end if;
      insert into public.shared_lessons (course_name, student_label, instructor_name, room, title, is_group, starts_at, ends_at, series_id, request_id)
      values (course, private.shared_text(rw ->> 'student_label', 80), inst, room, private.shared_text(rw ->> 'title', 120),
              coalesce((rw ->> 'is_group')::boolean, false), o.s, o.e, series, case when first_id is null then p_request_id end)
      returning id into nid;
      first_id := coalesce(first_id, nid);
      created := created + 1;
    end loop;
  end loop;
  if created > 0 then perform private.shared_log(first_id, 'ice_aktarildi', jsonb_build_object('created', created, 'skipped', skipped), k); end if;
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;

revoke execute on function public.shared_complete, public.shared_update, public.shared_delete_series, public.shared_undelete_many,
  public.shared_check_import, public.shared_import from public;
grant execute on function public.shared_complete, public.shared_update, public.shared_delete_series, public.shared_undelete_many,
  public.shared_check_import, public.shared_import to anon, authenticated;
