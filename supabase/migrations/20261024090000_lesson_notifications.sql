-- =============================================================================
-- MUTU AKADEMİ – Ders yaşam döngüsü bildirimleri
-- 1 saat önce, 15 dk önce, ders başladığında, bitişe 15 dk kala, bitiş saatinde ve ders tamamlandığında.
-- Ders hiçbir zaman otomatik tamamlanmaz; hak düşümü yalnızca yetkili kullanıcı işlemiyle olur.
-- Geriye uyumludur: yalnızca fonksiyon ve tetikleyici değiştirir/ekler.
-- =============================================================================

-- "Python Eğitimi'nin" gibi Türkçe tamlayan eki
create or replace function private.tr_genitive(w text)
returns text language plpgsql immutable set search_path = '' as $$
declare s text := btrim(coalesce(w, 'Ders')); v text; last_ch text := lower(right(btrim(coalesce(w, 'Ders')), 1)); suf text;
begin
  v := substring(lower(s) from '([aeıioöuü])[^aeıioöuü]*$');
  suf := case v when 'a' then 'ın' when 'ı' then 'ın' when 'e' then 'in' when 'i' then 'in'
                when 'o' then 'un' when 'u' then 'un' when 'ö' then 'ün' when 'ü' then 'ün' else 'in' end;
  if last_ch ~ '[aeıioöuü]' then suf := 'n' || suf; end if;
  return s || '''' || suf;
end $$;

-- Hatırlatma türüne göre başlık ve metin (yetkili cihazlar: öğrenci adı eklenir)
create or replace function private.lesson_reminder_text(l public.lessons, minutes int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return private.lesson_event_text(l, case minutes when 60 then 'lesson_60' else 'lesson_15' end);
end $$;

create or replace function private.lesson_event_text(l public.lessons, kind text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c text := private.course_label(l); title text; body text;
begin
  case kind
    when 'lesson_60' then title := 'Ders Hatırlatması';
      body := c || ' saat ' || private.tr_saat(l.starts_at, 'loc') || ' başlayacak. Dersin başlamasına 1 saat kaldı.';
    when 'lesson_15' then title := 'Ders Başlamak Üzere';
      body := c || ' 15 dakika sonra başlayacak. Ders saati: ' || private.tr_saat(l.starts_at) || '.';
    when 'lesson_start' then title := 'Ders Saati Geldi';
      body := c || ' başladı. Yoklama alabilir ve dersi devam ediyor olarak işaretleyebilirsiniz.';
    when 'lesson_end15' then title := 'Dersin Bitmesine Az Kaldı';
      body := private.tr_genitive(c) || ' bitmesine 15 dakika kaldı. Planlanan bitiş: ' || private.tr_saat(l.ends_at) || '.';
    else title := 'Ders Süresi Doldu';
      body := private.tr_genitive(c) || ' planlanan süresi doldu. Dersi tamamlandı olarak işaretleyebilirsiniz.';
  end case;
  return jsonb_build_object('title', 'MUTU AKADEMİ – ' || title,
    'body', body || coalesce(E'\n' || case when l.group_id is null then 'Öğrenci: ' else 'Grup: ' end || private.group_label(l), ''),
    'url', '/ders/' || l.id);
end $$;

-- Her dakika çalışır (pg_cron → push_tick). Pencereler 2 dakikalıktır; aynı ders+cihaz+tür+saat için tek kayıt.
create or replace function private.enqueue_lesson_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; k record; l public.lessons; txt jsonb; c int;
begin
  for k in select * from (values
      ('lesson_60', 'starts_at', 60), ('lesson_15', 'starts_at', 15), ('lesson_start', 'starts_at', 0),
      ('lesson_end15', 'ends_at', 15), ('lesson_end', 'ends_at', 0)) v(kind, col, minutes)
  loop
    for l in
      select * from public.lessons x
      where x.status = 'planlandi'
        and private.is_group_lead(x)
        and case k.col when 'starts_at' then x.starts_at else x.ends_at end > now() + make_interval(mins => k.minutes - 2)
        and case k.col when 'starts_at' then x.starts_at else x.ends_at end <= now() + make_interval(mins => k.minutes)
        -- başlamadan önceki hatırlatmalar ve "ders saati geldi" yalnızca henüz başlatılmamış derslere
        and (k.kind not in ('lesson_60', 'lesson_15', 'lesson_start') or x.started_at is null)
    loop
      txt := private.lesson_event_text(l, k.kind);
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

      -- Girişsiz ortak program abonelerine yalnızca 1 saat önce, isimsiz
      if k.kind = 'lesson_60' and private.rule_on('lesson_60', '{}'::jsonb) then
        insert into public.push_deliveries (subscription_id, user_id, kind, lesson_id, lesson_starts_at, title, body, url)
        select ps.id, null, k.kind, l.id, l.starts_at, 'MUTU AKADEMİ – Ders Hatırlatması',
               private.public_lesson_text(l) || ' Dersin başlamasına 1 saat kaldı.', '/'
        from public.push_subscriptions ps where ps.is_public
        on conflict do nothing;
        get diagnostics c = row_count;
        n := n + c;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- Gönderim anında son kontrol: iptal/ertelenen/tamamlanan/saati değişen derse eski hatırlatma GİTMEZ.
-- "grupla" tercihi açıksa aynı türdeki bildirimler kilit ekranında tek bildirimde birleşir (tag).
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
         case when coalesce((pr.notification_prefs ->> 'grupla')::boolean, false) then 'mutu-' || upd.kind
              else coalesce(upd.lesson_id::text || ':' || upd.kind, upd.notification_id::text, upd.id::text) end
  from upd join public.push_subscriptions s on s.id = upd.subscription_id
  left join public.profiles pr on pr.id = s.user_id;
end $$;

-- Ders tamamlandığında yetkili cihazlara tek bildirim (grup dersinde bir kez; aynı olay için tekrar yok)
create or replace function private.on_lesson_completed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'tamamlandi' and old.status = 'planlandi' and private.is_group_lead(new) then
    perform private.notify(array['admin', 'personel']::public.app_role[], new.instructor_id, 'ders_tamamlandi', 'Ders Tamamlandı',
      private.course_label(new) || ' tamamlandı olarak kaydedildi.' || coalesce(' (' || private.group_label(new) || ', ' || private.tr_tarih(new.starts_at) || ' ' || private.tr_saat(new.starts_at) || ')', ''),
      '/ders/' || new.id, 'done:' || coalesce(new.group_id, new.id));
  end if;
  return null;
end $$;
drop trigger if exists trg_lesson_completed on public.lessons;
create trigger trg_lesson_completed after update of status on public.lessons
  for each row execute function private.on_lesson_completed();

-- İptal bildirimi: "Planlanan Python Eğitimi iptal edildi." (+ yetkili cihazlarda neden)
create or replace function private.on_lesson_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text; link text;
begin
  if tg_op <> 'UPDATE' or private.bulk_on() or not private.is_group_lead(new) then return new; end if;
  who := private.group_label(new);
  link := '/ders/' || new.id;
  if new.status = 'iptal' and old.status <> 'iptal' then
    perform private.notify(array['admin', 'personel']::public.app_role[], new.instructor_id,
      'ders_iptal', 'Ders İptal Edildi',
      'Planlanan ' || private.course_label(new) || ' iptal edildi. (' || coalesce(who, 'Öğrenci') || ', ' || private.tr_tarih(new.starts_at) || ' '
        || private.tr_saat(new.starts_at) || ')' || coalesce(' Neden: ' || new.status_reason, ''), link);
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

-- Ortak program abonelerine iptal metni (isimsiz)
create or replace function private.on_lesson_public_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare kind text; title text; body text; ref timestamptz; cname text;
begin
  if private.bulk_on() then return null; end if;
  ref := coalesce(new.starts_at, old.starts_at);
  if ref < now() or ref > now() + interval '7 days' then return null; end if;
  if new.group_id is not null then
    if tg_op = 'INSERT' and exists (select 1 from public.lessons x where x.group_id = new.group_id and x.id <> new.id) then return null; end if;
    if tg_op = 'UPDATE' and not private.is_group_lead(new) then return null; end if;
  end if;
  cname := coalesce((select c.name from public.courses c where c.id = new.course_id), 'Ders');
  if tg_op = 'INSERT' and new.status = 'planlandi' and new.rescheduled_from is null then
    kind := 'pub_new'; title := 'Yeni ders oluşturuldu';
    body := private.public_lesson_text(new) || ' (' || private.tr_tarih(new.starts_at) || ')';
  elsif tg_op = 'UPDATE' and new.status = 'iptal' and old.status <> 'iptal' then
    kind := 'pub_cancel'; title := 'Ders İptal Edildi';
    body := 'Planlanan ' || cname || ' iptal edildi. (' || private.tr_tarih(new.starts_at) || ' ' || private.tr_saat(new.starts_at) || ')';
  elsif tg_op = 'UPDATE' and new.status = 'planlandi' and new.starts_at <> old.starts_at then
    kind := 'pub_time'; title := 'Ders saati değiştirildi';
    body := 'Ders programı güncellendi. ' || cname || ' ' || private.tr_saat(old.starts_at) || ' yerine ' || private.tr_saat(new.starts_at, 'dat') || ' alındı.';
  else
    return null;
  end if;
  perform private.public_push(kind, title, body, new.id, new.starts_at);
  return null;
end $$;

-- Grup dersinde "Dersi başlat" tüm öğrencilere uygulanır
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
  if l.status <> 'planlandi' then raise exception 'Yalnızca planlanmış ders başlatılabilir.' using errcode = 'P0001'; end if;
  if l.starts_at > now() + interval '1 hour' then
    raise exception 'Ders saatinden 1 saatten daha erken başlatılamaz.' using errcode = 'P0001';
  end if;
  update public.lessons set started_at = coalesce(started_at, now())
  where coalesce(group_id, id) = coalesce(l.group_id, l.id) and status = 'planlandi';
  select * into l from public.lessons where id = p_lesson_id;
  return l;
end $$;

-- Varsayılanlar: tüm ders bildirimleri açık
update public.app_settings
set notify_rules = coalesce(notify_rules, '{}'::jsonb)
  || '{"lesson_60": true, "lesson_15": true, "lesson_start": true, "lesson_end15": true, "lesson_end": true, "ders_tamamlandi": true}'::jsonb
where id = 1;
