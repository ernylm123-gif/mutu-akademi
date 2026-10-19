-- MUTU AKADEMİ – şifresiz cihaz eşleştirme
-- Yönetici tek kullanımlık, süreli bir davet kodu üretir. Kodun yalnızca SHA-256 özeti saklanır.
-- Yeni cihaz kodu "device-pair" Edge Function'ına gönderir; fonksiyon kodu tek seferlik tüketir,
-- cihaza özel bir Supabase Auth kullanıcısı açar ve şifresiz bir oturum başlatır.
-- Oturum cihazda kalıcıdır; yönetici cihazı pasif yaparak veya silerek erişimi anında kaldırabilir.

create table public.device_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'Yeni cihaz' check (length(label) between 1 and 80),
  role public.app_role not null default 'personel',
  permissions jsonb not null default '{"students": true, "lessons": true, "payments": false}'::jsonb,
  instructor_id uuid references public.instructors (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at <= created_at + interval '30 days'),
  used_at timestamptz,
  used_by uuid references public.profiles (id) on delete set null,
  failed_attempts int not null default 0
);
create index on public.device_invites (created_by);
create index on public.device_invites (used_by);
create index on public.device_invites (instructor_id);

alter table public.device_invites enable row level security;

create policy "invites_select_admin" on public.device_invites for select to authenticated using ((select public.is_admin()));
create policy "invites_insert_admin" on public.device_invites for insert to authenticated
  with check ((select public.is_admin()) and used_at is null and used_by is null);
create policy "invites_delete_admin" on public.device_invites for delete to authenticated using ((select public.is_admin()));

revoke all on public.device_invites from anon;
-- Kod özeti istemciye hiçbir zaman geri okunmaz
revoke select on public.device_invites from authenticated;
grant select (id, label, role, permissions, instructor_id, created_by, created_at, expires_at, used_at, used_by) on public.device_invites to authenticated;

create trigger trg_audit after insert or update or delete on public.device_invites for each row execute function private.audit();

-- Profillerde cihaz bilgisi
alter table public.profiles add column if not exists is_device boolean not null default false;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Oturumdaki cihaz kendini "son görülme" olarak işaretler (rol vb. alanlara dokunmaz)
create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now()
  where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')
$$;
revoke execute on function public.touch_last_seen from public, anon;
grant execute on function public.touch_last_seen to authenticated;

-- touch_row last_seen güncellemesinde gereksiz audit oluşturmasın
create or replace function private.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'last_seen_at' - 'updated_at') = (to_jsonb(old) - 'last_seen_at' - 'updated_at') then
    return new;
  end if;
  rid := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'))::uuid;
  insert into public.audit_logs (table_name, record_id, action, actor_id, old_data, new_data)
  values (tg_table_name, rid, lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'code_hash' end,
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'code_hash' end);
  return coalesce(new, old);
end $$;

alter publication supabase_realtime add table public.device_invites;
