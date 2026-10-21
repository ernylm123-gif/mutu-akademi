-- MUTU AKADEMİ – herkese açık, girişsiz ORTAK DERS PROGRAMI (salt okunur)
--
-- Güvenlik modeli:
--  * Girişsiz ziyaretçi yalnızca get_public_schedule() üzerinden, en fazla 62 günlük aralıkta
--    ders saatlerini, kurs adını ve KISALTILMIŞ isimleri ("Ezgi K.") görür.
--    Telefon, veli, not, ödeme, yoklama ve ders hakkı bilgisi bu fonksiyonla ASLA dönmez.
--  * Tablolara doğrudan anonim erişim yoktur (RLS ve izinler değişmedi). Kayıt ekleme/değiştirme/silme
--    yalnızca yetkili cihazlardan yapılabilir.
--  * Değişiklik yayını (Realtime Broadcast) kişisel veri içermez; yalnızca "program değişti" sinyalidir.
--  * Girişsiz cihazlar ders hatırlatması için push aboneliği bırakabilir; bildirim metninde de kısaltılmış isim kullanılır.

-- "Ezgi Kaya" → "Ezgi K."
create or replace function private.short_name(n text)
returns text language sql immutable set search_path = '' as $$
  select case
    when n is null or btrim(n) = '' then null
    when strpos(btrim(n), ' ') = 0 then btrim(n)
    else split_part(btrim(n), ' ', 1) || ' ' || upper(left(split_part(btrim(n), ' ', array_length(regexp_split_to_array(btrim(n), '\s+'), 1)), 1)) || '.'
  end
$$;

create or replace function public.get_public_schedule(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid, starts_at timestamptz, ends_at timestamptz, status public.lesson_status, started boolean,
  student_label text, course_name text, course_color text, instructor_label text, instructor_color text)
language sql stable security definer set search_path = '' as $$
  select l.id, l.starts_at, l.ends_at, l.status, l.started_at is not null,
         private.short_name(s.full_name), c.name, c.color, private.short_name(i.full_name), i.color
  from public.lessons l
  left join public.students s on s.id = l.student_id
  left join public.courses c on c.id = l.course_id
  left join public.instructors i on i.id = l.instructor_id
  where p_to > p_from and p_to - p_from <= interval '62 days'
    and l.starts_at >= p_from and l.starts_at < p_to
    and l.status <> 'ertelendi'
  order by l.starts_at
  limit 1000
$$;
revoke execute on function public.get_public_schedule from public;
grant execute on function public.get_public_schedule to anon, authenticated;

-- Kişisel veri içermeyen "program değişti" yayını (Supabase Realtime Broadcast)
create or replace function private.broadcast_schedule_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('at', now()), 'changed', 'public-schedule', false);
  exception when others then
    null; -- yayın başarısız olsa bile ders kaydı etkilenmez
  end;
  return null;
end $$;
create trigger trg_public_schedule_broadcast after insert or update or delete on public.lessons
  for each statement execute function private.broadcast_schedule_change();
create trigger trg_public_schedule_broadcast after insert or update or delete on public.students
  for each statement execute function private.broadcast_schedule_change();
create trigger trg_public_schedule_broadcast after insert or update or delete on public.courses
  for each statement execute function private.broadcast_schedule_change();
create trigger trg_public_schedule_broadcast after insert or update or delete on public.instructors
  for each statement execute function private.broadcast_schedule_change();

-- Girişsiz cihazlar için push aboneliği (yalnızca ders hatırlatmaları)
alter table public.push_subscriptions alter column user_id drop not null;
alter table public.push_subscriptions add column if not exists is_public boolean not null default false;
alter table public.push_deliveries alter column user_id drop not null;

create or replace function public.subscribe_public_push(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(coalesce(p_p256dh, '')) not between 40 and 200
     or length(coalesce(p_auth, '')) not between 10 and 100 then
    raise exception 'Geçersiz bildirim aboneliği.' using errcode = '22023';
  end if;
  if (select count(*) from public.push_subscriptions where is_public) >= 1000 then
    raise exception 'Bildirim kapasitesi dolu.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, platform, is_public)
  values (null, p_endpoint, p_p256dh, p_auth, left(p_ua, 300), 'public', true)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth
    where public.push_subscriptions.is_public;
end $$;

create or replace function public.unsubscribe_public_push(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and is_public
$$;

revoke execute on function public.subscribe_public_push, public.unsubscribe_public_push from public;
grant execute on function public.subscribe_public_push, public.unsubscribe_public_push to anon, authenticated;

-- Ders hatırlatmaları: yetkili cihazlara (tam bilgi) + girişsiz abonelere (kısaltılmış isim)
create or replace function private.enqueue_lesson_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; k record; l public.lessons; txt jsonb; pub_body text; c int;
begin
  for k in select * from (values ('lesson_60', 60), ('lesson_15', 15)) v(kind, minutes) loop
    for l in
      select * from public.lessons
      where status = 'planlandi' and started_at is null
        and starts_at > now() + make_interval(mins => k.minutes - 2)
        and starts_at <= now() + make_interval(mins => k.minutes)
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
        select coalesce(private.short_name(s.full_name), 'Ders') || coalesce(' • ' || co.name, '') || E'\n'
               || 'Başlangıç: ' || to_char(l.starts_at at time zone 'Europe/Istanbul', 'HH24.MI') || E'\n'
               || 'Dersin başlamasına 1 saat kaldı.'
          into pub_body
        from (select 1) x
        left join public.students s on s.id = l.student_id
        left join public.courses co on co.id = l.course_id;
        insert into public.push_deliveries (subscription_id, user_id, kind, lesson_id, lesson_starts_at, title, body, url)
        select ps.id, null, k.kind, l.id, l.starts_at, 'MUTU AKADEMİ – Ders Hatırlatması', pub_body, '/'
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
