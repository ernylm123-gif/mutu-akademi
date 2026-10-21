-- MUTU AKADEMİ – herkese açık güvenli aktiviteler, duyurular, ders değişikliği bildirimleri, test bildirimi
-- Herkese açık alana/cihazlara hiçbir kişisel veri (öğrenci adı, telefon, ödeme) gönderilmez.

-- 1) Herkese açık canlı aktiviteler: yalnızca ders olayları, kurs adı ve saat
create or replace function public.get_public_activities(p_limit int default 20)
returns table (id bigint, created_at timestamptz, kind text, course_name text, starts_at timestamptz, old_starts_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.created_at,
    case
      when a.table_name = 'lessons' and a.action = 'insert' then 'olusturuldu'
      when a.table_name = 'lessons' and a.action = 'delete' then 'kaldirildi'
      when a.table_name = 'lessons' and (a.new_data ->> 'status') is distinct from (a.old_data ->> 'status') then
        case a.new_data ->> 'status' when 'tamamlandi' then 'tamamlandi' when 'iptal' then 'iptal' when 'ertelendi' then 'ertelendi' else 'guncellendi' end
      when a.table_name = 'lessons' and (a.new_data ->> 'starts_at') is distinct from (a.old_data ->> 'starts_at') then 'saat'
      when a.table_name = 'lessons' and (a.new_data ->> 'started_at') is not null and (a.old_data ->> 'started_at') is null then 'basladi'
      when a.table_name = 'weekly_schedules' then 'program'
      else 'guncellendi'
    end,
    c.name,
    (coalesce(a.new_data, a.old_data) ->> 'starts_at')::timestamptz,
    case when (a.new_data ->> 'starts_at') is distinct from (a.old_data ->> 'starts_at') then (a.old_data ->> 'starts_at')::timestamptz end
  from public.audit_logs a
  left join public.courses c on c.id = (coalesce(a.new_data, a.old_data) ->> 'course_id')::uuid
  where a.table_name in ('lessons', 'weekly_schedules')
    and a.created_at > now() - interval '14 days'
    and not (a.table_name = 'lessons' and a.action = 'update'
             and (a.new_data ->> 'status') is not distinct from (a.old_data ->> 'status')
             and (a.new_data ->> 'starts_at') is not distinct from (a.old_data ->> 'starts_at')
             and (a.new_data ->> 'started_at') is not distinct from (a.old_data ->> 'started_at'))
  order by a.id desc
  limit greatest(1, least(p_limit, 50))
$$;
revoke execute on function public.get_public_activities from public;
grant execute on function public.get_public_activities to anon, authenticated;

-- 2) Herkese açık hatırlatma metni: yalnızca kurs ve saat
--    "Python Eğitimi saat 14.00'te başlayacak. Dersin başlamasına 1 saat kaldı."
create or replace function private.public_lesson_text(l public.lessons)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select c.name from public.courses c where c.id = l.course_id), 'Ders')
         || ' saat ' || to_char(l.starts_at at time zone 'Europe/Istanbul', 'HH24.MI') || '''te başlayacak.'
$$;

create or replace function private.enqueue_lesson_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; k record; l public.lessons; txt jsonb; c int;
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

-- 3) Herkese açık abonelere ders değişikliği bildirimleri (yakın tarihli dersler için, isim yok, tekrar yok)
create or replace function private.on_lesson_public_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare kind text; title text; body text; ref timestamptz;
begin
  ref := coalesce(new.starts_at, old.starts_at);
  -- yalnızca önümüzdeki 7 gün içindeki dersler (toplu program yüklemelerinde bildirim yağmuru olmaz)
  if ref < now() or ref > now() + interval '7 days' then return null; end if;
  if tg_op = 'INSERT' and new.status = 'planlandi' and new.rescheduled_from is null then
    kind := 'pub_new'; title := 'Yeni ders oluşturuldu';
    body := private.public_lesson_text(new) || ' (' || to_char(new.starts_at at time zone 'Europe/Istanbul', 'DD.MM') || ')';
  elsif tg_op = 'INSERT' and new.rescheduled_from is not null then
    kind := 'pub_time'; title := 'Ders ertelendi';
    body := 'Yeni saat: ' || private.public_lesson_text(new) || ' (' || to_char(new.starts_at at time zone 'Europe/Istanbul', 'DD.MM') || ')';
  elsif tg_op = 'UPDATE' and new.status = 'iptal' and old.status <> 'iptal' then
    kind := 'pub_cancel'; title := 'Ders iptal edildi';
    body := coalesce((select c.name from public.courses c where c.id = new.course_id), 'Ders') || ' – '
            || to_char(new.starts_at at time zone 'Europe/Istanbul', 'DD.MM HH24.MI') || ' dersi iptal edildi.';
  elsif tg_op = 'UPDATE' and new.status = 'planlandi' and new.starts_at <> old.starts_at then
    kind := 'pub_time'; title := 'Ders saati değiştirildi';
    body := private.public_lesson_text(new) || ' (' || to_char(new.starts_at at time zone 'Europe/Istanbul', 'DD.MM') || ')';
  else
    return null;
  end if;
  insert into public.push_deliveries (subscription_id, user_id, kind, lesson_id, lesson_starts_at, title, body, url)
  select ps.id, null, kind, new.id, new.starts_at, 'MUTU AKADEMİ – ' || title, body, '/'
  from public.push_subscriptions ps
  where ps.is_public
  on conflict do nothing;
  return null;
end $$;
create trigger trg_lesson_public_push after insert or update on public.lessons
  for each row execute function private.on_lesson_public_push();

-- claim_push_batch iptal/değişiklik kontrolü yalnızca hatırlatmalar için geçerli olsun
create or replace function public.claim_push_batch(p_secret text, p_limit int default 200)
returns table (delivery_id uuid, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.dispatcher_ok(p_secret) then
    perform pg_sleep(0.3);
    raise exception 'yetkisiz' using errcode = '42501';
  end if;

  update public.push_deliveries d set status = 'skipped', last_error = 'ders değişti/iptal'
  from public.lessons l
  where d.lesson_id = l.id and d.status in ('pending', 'failed') and d.kind in ('lesson_60', 'lesson_15')
    and (l.status <> 'planlandi' or l.started_at is not null or l.starts_at <> d.lesson_starts_at or l.starts_at < now());
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
         coalesce(upd.lesson_id::text || ':' || upd.kind, upd.notification_id::text, upd.id::text)
  from upd join public.push_subscriptions s on s.id = upd.subscription_id;
end $$;

-- 4) Duyurular (yalnızca yönetici): yetkili cihazlara uygulama içi + push, herkese açık abonelere push
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 80),
  body text not null check (length(trim(body)) between 2 and 500),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
create policy "announcements_select" on public.announcements for select to authenticated using ((select public.is_member()));
revoke all on public.announcements from anon;
create index if not exists announcements_created_by_idx on public.announcements (created_by);

create or replace function public.send_announcement(p_title text, p_body text)
returns int language plpgsql security definer set search_path = '' as $$
declare a public.announcements; n int;
begin
  if not public.is_admin() then raise exception 'Yalnızca yönetici duyuru gönderebilir.' using errcode = '42501'; end if;
  if (select count(*) from public.announcements where created_at > now() - interval '1 minute') >= 3 then
    raise exception 'Çok sık duyuru gönderildi. Bir dakika bekleyin.' using errcode = 'P0001';
  end if;
  insert into public.announcements (title, body) values (btrim(p_title), btrim(p_body)) returning * into a;
  insert into public.notifications (user_id, type, title, body, link, dedupe_key)
  select p.id, 'duyuru', a.title, a.body, '/bildirimler', 'ann:' || a.id
  from public.profiles p where p.is_active and p.approved
  on conflict (user_id, dedupe_key) do nothing;
  insert into public.push_deliveries (subscription_id, user_id, kind, title, body, url)
  select ps.id, null, 'duyuru', 'MUTU AKADEMİ – ' || a.title, a.body, '/'
  from public.push_subscriptions ps where ps.is_public;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.send_announcement from public, anon;
grant execute on function public.send_announcement to authenticated;

-- Herkese açık son duyurular (yalnızca başlık/metin; gönderen bilgisi yok)
create or replace function public.get_public_announcements(p_limit int default 3)
returns table (id uuid, title text, body text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.title, a.body, a.created_at from public.announcements a
  where a.created_at > now() - interval '30 days'
  order by a.created_at desc limit greatest(1, least(p_limit, 10))
$$;
revoke execute on function public.get_public_announcements from public;
grant execute on function public.get_public_announcements to anon, authenticated;

create trigger trg_announcement_broadcast after insert on public.announcements
  for each statement execute function private.broadcast_schedule_change();

-- 5) Herkese açık cihaz için test bildirimi (gerçek cihazda uçtan uca doğrulama)
create or replace function public.send_public_test_push(p_endpoint text)
returns int language plpgsql security definer set search_path = '' as $$
declare sub uuid;
begin
  select id into sub from public.push_subscriptions where endpoint = p_endpoint and is_public;
  if sub is null then raise exception 'Bu cihaz için bildirim aboneliği bulunamadı.' using errcode = 'P0002'; end if;
  if (select count(*) from public.push_deliveries where subscription_id = sub and kind = 'test' and created_at > now() - interval '1 minute') >= 2 then
    raise exception 'Çok sık test bildirimi gönderildi. Bir dakika bekleyin.' using errcode = 'P0001';
  end if;
  insert into public.push_deliveries (subscription_id, user_id, kind, title, body, url)
  values (sub, null, 'test', 'MUTU AKADEMİ – Test bildirimi', 'Bildirimler bu cihazda çalışıyor.', '/');
  return 1;
end $$;
revoke execute on function public.send_public_test_push from public;
grant execute on function public.send_public_test_push to anon, authenticated;

-- Duyuru bildirimleri için kural anahtarı
update public.app_settings set notify_rules = notify_rules || '{"duyuru": true}'::jsonb where id = 1;
