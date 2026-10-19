-- MUTU AKADEMİ – Web Push, ders hatırlatmaları, akıllı bildirim kuralları, canlı aktiviteler
--
-- Mimari:
--   pg_cron (her dakika) → private.push_tick()
--     1) Ders hatırlatmalarını (60 / isteğe bağlı 15 dk) push_deliveries tablosuna kuyruklar
--     2) Bekleyen gönderim varsa pg_net ile Vercel gönderim fonksiyonunu uyandırır
--   Vercel /api/push-dispatch → claim_push_batch(secret) → web-push ile gönderir → report_push_results(secret)
--   Gizli anahtarın yalnızca SHA-256 özeti veritabanında saklanır; VAPID özel anahtarı yalnızca Vercel'dedir.

-- pg_cron / pg_net Supabase'de mevcuttur (yerel test motorunda yoksa atlanır)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Ayarlar
-- ---------------------------------------------------------------------------
create table if not exists private.config (
  key text primary key,
  value text not null
);

-- Audit: kimliği UUID olmayan tablolar (ör. app_settings id=1) için güvenli dönüşüm
create or replace function private.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rid uuid; raw text;
begin
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'last_seen_at' - 'updated_at') = (to_jsonb(old) - 'last_seen_at' - 'updated_at') then
    return new;
  end if;
  raw := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'));
  rid := case when raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raw::uuid end;
  insert into public.audit_logs (table_name, record_id, action, actor_id, old_data, new_data)
  values (tg_table_name, rid, lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'code_hash' end,
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'code_hash' end);
  return coalesce(new, old);
end $$;

alter table public.app_settings
  add column if not exists notify_rules jsonb not null default '{
    "lesson_60": true, "lesson_15": false, "ders_iptal": true, "ders_degisiklik": true,
    "yeni_ogrenci": true, "dusuk_ders_hakki": true, "devamsizlik": true,
    "yaklasan_odeme": true, "gecikmis_odeme": true, "yeni_tahsilat": true
  }'::jsonb;
update public.app_settings set low_credit_threshold = 3 where id = 1 and low_credit_threshold = 2;

alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{
    "lesson_60": true, "lesson_15": true, "ders_iptal": true, "ders_degisiklik": true,
    "yeni_ogrenci": true, "dusuk_ders_hakki": true, "devamsizlik": true,
    "yaklasan_odeme": true, "gecikmis_odeme": true, "yeni_tahsilat": true,
    "quiet_enabled": false, "quiet_start": "22:00", "quiet_end": "08:00"
  }'::jsonb;

-- Dersi başlatma (durum "planlandi" kalır, çakışma kuralları değişmez)
alter table public.lessons add column if not exists started_at timestamptz;

-- ---------------------------------------------------------------------------
-- Push abonelikleri ve gönderim kayıtları
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count int not null default 0
);
create index on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "push_sub_select_own" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_member()));
create policy "push_sub_insert_own" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_member()));
create policy "push_sub_delete_own" on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke all on public.push_subscriptions from anon;
revoke update on public.push_subscriptions from authenticated;

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,                       -- lesson_60 | lesson_15 | notification
  lesson_id uuid references public.lessons (id) on delete cascade,
  lesson_starts_at timestamptz,             -- planlandığı andaki ders saati (saat değişirse yeni kayıt)
  notification_id uuid references public.notifications (id) on delete cascade,
  title text not null,
  body text not null,
  url text not null default '/',
  status text not null default 'pending' check (status in ('pending', 'claimed', 'sent', 'failed', 'skipped', 'expired')),
  attempts int not null default 0,
  next_try_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
-- Her ders + cihaz + hatırlatma türü + ders saati için tek kayıt (çift bildirim olmaz)
create unique index push_deliveries_lesson_uniq on public.push_deliveries (lesson_id, subscription_id, kind, lesson_starts_at)
  where lesson_id is not null;
create unique index push_deliveries_notif_uniq on public.push_deliveries (notification_id, subscription_id)
  where notification_id is not null;
create index on public.push_deliveries (status, next_try_at);
create index on public.push_deliveries (user_id, created_at desc);
create index on public.push_deliveries (subscription_id);
create index on public.push_deliveries (lesson_id);

alter table public.push_deliveries enable row level security;
create policy "push_del_select" on public.push_deliveries for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke all on public.push_deliveries from anon;
revoke insert, update, delete on public.push_deliveries from authenticated;

-- ---------------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------------
create or replace function private.in_quiet_hours(prefs jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare t time; s time; e time;
begin
  if not coalesce((prefs ->> 'quiet_enabled')::boolean, false) then return false; end if;
  t := (now() at time zone 'Europe/Istanbul')::time;
  s := coalesce(prefs ->> 'quiet_start', '22:00')::time;
  e := coalesce(prefs ->> 'quiet_end', '08:00')::time;
  if s <= e then return t >= s and t < e; end if;
  return t >= s or t < e;  -- gece yarısını aşan aralık
end $$;

create or replace function private.rule_on(kind text, prefs jsonb)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select (s.notify_rules ->> kind)::boolean from public.app_settings s where s.id = 1), true)
     and coalesce((prefs ->> kind)::boolean, true)
$$;

-- Önemli bildirimler sessiz saatlerde de gönderilir
create or replace function private.is_important(kind text)
returns boolean language sql immutable set search_path = '' as $$
  select kind in ('ders_iptal', 'ders_degisiklik', 'gecikmis_odeme')
$$;

create or replace function private.lesson_reminder_text(l public.lessons, minutes int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', 'MUTU AKADEMİ – Ders Hatırlatması',
    'body', coalesce(s.full_name, 'Öğrenci') || coalesce(' • ' || c.name, '') || E'\n'
            || 'Ders saati: ' || to_char(l.starts_at at time zone 'Europe/Istanbul', 'HH24.MI') || '–'
            || to_char(l.ends_at at time zone 'Europe/Istanbul', 'HH24.MI') || E'\n'
            || 'Dersin başlamasına ' || case when minutes = 60 then '1 saat' else minutes || ' dakika' end || ' kaldı.',
    'url', '/ders/' || l.id)
  from (select 1) x
  left join public.students s on s.id = l.student_id
  left join public.courses c on c.id = l.course_id
$$;

-- ---------------------------------------------------------------------------
-- Ders hatırlatmalarını kuyruğa al (her dakika)
-- ---------------------------------------------------------------------------
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
      where p.is_active and p.approved
        and (p.role = 'admin'
             or (p.role = 'personel' and coalesce((p.permissions ->> 'lessons')::boolean, false))
             or p.id = (select i.profile_id from public.instructors i where i.id = l.instructor_id))
        and private.rule_on(k.kind, p.notification_prefs)
        and not private.in_quiet_hours(p.notification_prefs)
      on conflict do nothing;
      get diagnostics c = row_count;
      n := n + c;
    end loop;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Uygulama içi bildirim oluşunca ilgili cihazların push kuyruğuna ekle
-- ---------------------------------------------------------------------------
create or replace function private.on_notification_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare push_body text;
begin
  -- Ödeme bildirimlerinde tutar gösterilmez
  push_body := case
    when new.type in ('yaklasan_odeme', 'gecikmis_odeme', 'yeni_tahsilat')
      then split_part(coalesce(new.body, ''), ':', 1) || ' – ' || lower(new.title)
    else coalesce(new.body, '') end;
  insert into public.push_deliveries (subscription_id, user_id, kind, notification_id, title, body, url)
  select ps.id, new.user_id, 'notification', new.id, 'MUTU AKADEMİ – ' || new.title, push_body, coalesce(new.link, '/bildirimler')
  from public.push_subscriptions ps
  join public.profiles p on p.id = ps.user_id
  where ps.user_id = new.user_id and p.is_active and p.approved
    and private.rule_on(new.type, p.notification_prefs)
    and (private.is_important(new.type) or not private.in_quiet_hours(p.notification_prefs))
  on conflict do nothing;
  return null;
end $$;
create trigger trg_notification_push after insert on public.notifications
  for each row execute function private.on_notification_push();

-- Yeni tahsilat bildirimi
create or replace function private.on_payment_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sname text;
begin
  select full_name into sname from public.students where id = new.student_id;
  perform private.notify(array['admin']::public.app_role[], null, 'yeni_tahsilat', 'Yeni tahsilat',
    coalesce(sname, 'Öğrenci') || ': ' || to_char(new.amount, 'FM999G999G990D00') || ' ₺', '/ogrenciler/' || new.student_id);
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'yeni_tahsilat', 'Yeni tahsilat', coalesce(sname, 'Öğrenci') || ': ' || to_char(new.amount, 'FM999G999G990D00') || ' ₺',
         '/ogrenciler/' || new.student_id
  from public.profiles p
  where p.role = 'personel' and p.is_active and p.approved and p.id is distinct from auth.uid()
    and coalesce((p.permissions ->> 'payments')::boolean, false);
  return null;
end $$;
create trigger trg_payment_notify after insert on public.payments
  for each row execute function private.on_payment_insert();

-- Yönetici kuralı kapalıysa uygulama içi bildirim de oluşturma
create or replace function private.notify(
  p_roles public.app_role[], p_instructor uuid, p_type text, p_title text,
  p_body text, p_link text, p_dedupe text default null, p_include_actor boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select (s.notify_rules ->> p_type)::boolean from public.app_settings s where s.id = 1), true) then
    return;
  end if;
  insert into public.notifications (user_id, type, title, body, link, dedupe_key)
  select distinct p.id, p_type, p_title, p_body, p_link, p_dedupe
  from public.profiles p
  where p.is_active and p.approved
    and (p_include_actor or p.id is distinct from auth.uid())
    and (p.role = any (p_roles)
         or p.id = (select i.profile_id from public.instructors i where i.id = p_instructor))
  on conflict (user_id, dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Gönderici (Vercel) API'si – gizli anahtar özeti ile korunur
-- ---------------------------------------------------------------------------
create or replace function private.dispatcher_ok(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.config
    where key = 'dispatch_secret_sha256'
      and value = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
      and length(coalesce(p_secret, '')) >= 32)
$$;

create or replace function public.claim_push_batch(p_secret text, p_limit int default 200)
returns table (delivery_id uuid, endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.dispatcher_ok(p_secret) then
    perform pg_sleep(0.3);
    raise exception 'yetkisiz' using errcode = '42501';
  end if;

  -- İptal edilen, tamamlanan veya saati değişen derslerin hatırlatmalarını atla
  update public.push_deliveries d set status = 'skipped', last_error = 'ders değişti/iptal'
  from public.lessons l
  where d.lesson_id = l.id and d.status in ('pending', 'failed')
    and (l.status <> 'planlandi' or l.started_at is not null or l.starts_at <> d.lesson_starts_at or l.starts_at < now());
  -- Çok eski bildirimleri gönderme
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
         coalesce(upd.lesson_id::text || ':' || upd.kind, upd.notification_id::text)
  from upd join public.push_subscriptions s on s.id = upd.subscription_id;
end $$;

-- p_results: [{"id": "...", "ok": true} | {"id": "...", "ok": false, "status": 410, "error": "..."}]
create or replace function public.report_push_results(p_secret text, p_results jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0; sub uuid;
begin
  if not private.dispatcher_ok(p_secret) then
    raise exception 'yetkisiz' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    if coalesce((r ->> 'ok')::boolean, false) then
      update public.push_deliveries set status = 'sent', sent_at = now(), last_error = null
      where id = (r ->> 'id')::uuid returning subscription_id into sub;
      update public.push_subscriptions set last_success_at = now(), failure_count = 0 where id = sub;
    elsif (r ->> 'status') in ('404', '410') then
      -- Süresi dolmuş abonelik: temizle
      update public.push_deliveries set status = 'expired', last_error = left(r ->> 'error', 300)
      where id = (r ->> 'id')::uuid returning subscription_id into sub;
      delete from public.push_subscriptions where id = sub;
    else
      update public.push_deliveries d
      set status = 'failed', last_error = left(r ->> 'error', 300),
          next_try_at = now() + make_interval(mins => 2 * d.attempts)
      where id = (r ->> 'id')::uuid returning subscription_id into sub;
      update public.push_subscriptions set failure_count = failure_count + 1 where id = sub;
    end if;
    n := n + 1;
  end loop;
  -- Sürekli başarısız abonelikleri temizle
  delete from public.push_subscriptions where failure_count >= 10;
  return n;
end $$;

revoke execute on function public.claim_push_batch, public.report_push_results from public;
grant execute on function public.claim_push_batch, public.report_push_results to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dakikalık zamanlayıcı
-- ---------------------------------------------------------------------------
create or replace function private.push_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare url text;
begin
  perform private.enqueue_lesson_reminders();
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
  -- Eski kayıtları temizle
  delete from public.push_deliveries where created_at < now() - interval '30 days';
end $$;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mutu-push-tick', '* * * * *', 'select private.push_tick()');
  end if;
end $do$;

-- ---------------------------------------------------------------------------
-- Canlı aktiviteler (audit log'dan, yetkiye göre)
-- ---------------------------------------------------------------------------
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
  where a.table_name in ('students', 'lessons', 'attendance', 'payments', 'installments', 'instructors', 'weekly_schedules', 'courses', 'student_notes')
    and (p_before is null or a.id < p_before)
    and (p_lesson is null or (a.table_name = 'lessons' and a.record_id = p_lesson)
         or (a.table_name = 'attendance' and (coalesce(a.new_data, a.old_data) ->> 'lesson_id')::uuid = p_lesson))
    and (pay or a.table_name not in ('payments', 'installments'))
    and (public.is_staff() or (inst is not null and (
          (a.table_name in ('lessons') and (coalesce(a.new_data, a.old_data) ->> 'instructor_id')::uuid = inst)
          or (a.table_name = 'attendance' and exists (select 1 from public.lessons l where l.id = (coalesce(a.new_data, a.old_data) ->> 'lesson_id')::uuid and l.instructor_id = inst)))))
    -- yalnızca anlamlı ders güncellemeleri (kredi yeniden hesabı gibi teknik güncellemeler gizlenir)
    and not (a.table_name = 'lessons' and a.action = 'update'
             and (a.new_data ->> 'status') is not distinct from (a.old_data ->> 'status')
             and (a.new_data ->> 'starts_at') is not distinct from (a.old_data ->> 'starts_at')
             and (a.new_data ->> 'instructor_id') is not distinct from (a.old_data ->> 'instructor_id')
             and (a.new_data ->> 'started_at') is not distinct from (a.old_data ->> 'started_at'))
    and not (a.table_name = 'students' and a.action = 'update'
             and (a.new_data - 'used_lessons' - 'remaining_lessons' - 'version' - 'updated_at')
                 = (a.old_data - 'used_lessons' - 'remaining_lessons' - 'version' - 'updated_at'))
  order by a.id desc
  limit greatest(1, least(p_limit, 200));
end $$;
revoke execute on function public.get_activities from public, anon;
grant execute on function public.get_activities to authenticated;

-- student_notes audit (yönetici notları aktivitelerde görünsün)
create trigger trg_audit after insert or update or delete on public.student_notes for each row execute function private.audit();

-- Dersi başlatma
create or replace function public.start_lesson(p_lesson_id uuid, p_expected_version int)
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
  if l.status <> 'planlandi' then
    raise exception 'Yalnızca planlanmış ders başlatılabilir.' using errcode = 'P0001';
  end if;
  update public.lessons set started_at = coalesce(started_at, now()) where id = l.id returning * into l;
  return l;
end $$;
revoke execute on function public.start_lesson from public, anon;
grant execute on function public.start_lesson to authenticated;

-- Eğitmenler kendi derslerini başlatabilsin diye guard gerekmiyor (RPC). Realtime yayınına ekle
alter publication supabase_realtime add table public.push_deliveries;
