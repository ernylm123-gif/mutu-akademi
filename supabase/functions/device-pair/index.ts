// MUTU AKADEMİ – şifresiz cihaz eşleştirme
// Tek kullanımlık davet kodunu doğrular, cihaza özel bir Auth kullanıcısı açar ve
// şifresiz oturum için tek seferlik bir token_hash döndürür. Service role yalnızca burada kullanılır.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Crockford base32 (I, L, O, U yok) – kullanıcı kodu tireli/küçük harfli girebilir
export function normalizeCode(raw: string) {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Yöntem desteklenmiyor' }, 405)

  let body: { code?: string; device_name?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek' }, 400)
  }
  const code = normalizeCode(String(body.code ?? ''))
  const deviceName = String(body.device_name ?? '').trim().slice(0, 60) || 'Cihaz'
  if (code.length !== 10) {
    await sleep(400)
    return json({ error: 'Davet kodu 10 karakter olmalıdır.' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const hash = await sha256Hex(code)

  // Daveti atomik olarak tüket (tek UPDATE: aynı kod iki cihazda kullanılamaz)
  const { data: invite, error: invErr } = await admin
    .from('device_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', hash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id, label, role, permissions, instructor_id')
    .maybeSingle()
  if (invErr) return json({ error: 'Sunucu hatası' }, 500)
  if (!invite) {
    await sleep(800) // kaba kuvvet denemelerini yavaşlat
    return json({ error: 'Davet kodu geçersiz, süresi dolmuş veya daha önce kullanılmış.' }, 400)
  }

  const rollback = () => admin.from('device_invites').update({ used_at: null }).eq('id', invite.id)
  const email = `cihaz-${crypto.randomUUID()}@cihaz.mutuakademi.app`
  const fullName = deviceName === 'Cihaz' ? invite.label : `${invite.label} · ${deviceName}`.slice(0, 120)

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role: invite.role, approved: true, device: true },
  })
  if (createErr || !created.user) {
    await rollback()
    return json({ error: 'Cihaz kaydı oluşturulamadı. Lütfen tekrar deneyin.' }, 500)
  }
  const uid = created.user.id

  await admin.from('profiles')
    .update({ role: invite.role, approved: true, is_active: true, is_device: true, permissions: invite.permissions, full_name: fullName })
    .eq('id', uid)
  if (invite.instructor_id && invite.role === 'egitmen') {
    await admin.from('instructors').update({ profile_id: uid }).eq('id', invite.instructor_id)
  }
  await admin.from('device_invites').update({ used_by: uid }).eq('id', invite.id)

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkErr || !link.properties?.hashed_token) {
    return json({ error: 'Oturum başlatılamadı. Yöneticinizden yeni kod isteyin.' }, 500)
  }
  return json({ token_hash: link.properties.hashed_token, name: fullName, role: invite.role })
})
