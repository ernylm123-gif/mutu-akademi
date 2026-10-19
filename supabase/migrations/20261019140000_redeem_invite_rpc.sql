-- MUTU AKADEMİ – Edge Function gerektirmeyen cihaz eşleştirme
-- Cihaz Supabase anonim oturumuyla (şifresiz) açılır. Anonim oturum tek başına HİÇBİR veriye erişemez
-- (profil onaysızdır, RLS reddeder). Cihaz, yöneticiden aldığı tek kullanımlık kodu bu fonksiyona
-- gönderir; kod doğruysa profil rol ve izinleriyle onaylanır.

create extension if not exists pgcrypto with schema extensions;

create table if not exists private.pair_attempts (
  user_id uuid primary key,
  failures int not null default 0,
  last_at timestamptz not null default now()
);

create or replace function public.redeem_device_invite(p_code text, p_name text default null)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  code text;
  inv public.device_invites;
  fails int;
  label text;
  p public.profiles;
begin
  if uid is null then
    raise exception 'Oturum bulunamadı.' using errcode = '42501';
  end if;

  select failures into fails from private.pair_attempts where user_id = uid;
  if coalesce(fails, 0) >= 10 then
    raise exception 'Çok fazla hatalı deneme. Yöneticinizden yeni kod isteyin ve uygulamayı yeniden açın.' using errcode = 'P0001';
  end if;

  code := translate(regexp_replace(upper(coalesce(p_code, '')), '[^0-9A-Z]', '', 'g'), 'OIL', '011');

  update public.device_invites
  set used_at = now(), used_by = uid
  where code_hash = encode(extensions.digest(code, 'sha256'), 'hex')
    and used_at is null and expires_at > now()
  returning * into inv;

  if inv.id is null then
    insert into private.pair_attempts (user_id, failures) values (uid, 1)
    on conflict (user_id) do update set failures = private.pair_attempts.failures + 1, last_at = now();
    perform pg_sleep(0.5);
    raise exception 'Davet kodu geçersiz, süresi dolmuş veya daha önce kullanılmış.' using errcode = 'P0001';
  end if;

  label := left(coalesce(nullif(trim(p_name), ''), 'Cihaz'), 60);
  perform set_config('mutu.trusted', 'on', true);
  update public.profiles
  set role = inv.role,
      approved = true,
      is_active = true,
      is_device = true,
      permissions = case when inv.role = 'personel' then inv.permissions else permissions end,
      full_name = left(inv.label || ' · ' || label, 120)
  where id = uid
  returning * into p;

  if inv.instructor_id is not null and inv.role = 'egitmen' then
    update public.instructors set profile_id = uid where id = inv.instructor_id;
  end if;

  perform set_config('mutu.trusted', 'off', true);
  delete from private.pair_attempts where user_id = uid;
  return p;
end $$;

revoke execute on function public.redeem_device_invite from public, anon;
grant execute on function public.redeem_device_invite to authenticated;

-- Profil koruması: yönetici olmayanlar rol/onay/izin alanlarını değiştiremez.
-- Yalnızca güvenli sunucu fonksiyonları, işlem içi 'mutu.trusted' bayrağıyla bu kontrolü aşabilir
-- (bu bayrak PostgREST üzerinden istemci tarafından ayarlanamaz).
create or replace function private.guard_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(current_setting('mutu.trusted', true), '') <> 'on'
     and not public.is_admin() then
    if new.role is distinct from old.role or new.approved is distinct from old.approved
       or new.is_active is distinct from old.is_active or new.permissions is distinct from old.permissions
       or new.email is distinct from old.email or new.id is distinct from old.id
       or new.is_device is distinct from old.is_device then
      raise exception 'Bu alanları değiştirme yetkiniz yok.' using errcode = '42501';
    end if;
  end if;
  if old.role = 'admin' and old.is_active and old.approved
     and (new.role <> 'admin' or not new.is_active or not new.approved)
     and not exists (select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.is_active and p.approved) then
    raise exception 'Sistemde en az bir aktif yönetici kalmalıdır.' using errcode = 'P0001';
  end if;
  return new;
end $$;
