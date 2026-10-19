// MUTU AKADEMİ – yönetici kullanıcı işlemleri
// Service role anahtarı yalnızca bu sunucu tarafı fonksiyonda (Supabase ortam değişkeni) kullanılır,
// asla istemciye gönderilmez. Her çağrıda arayan kişinin aktif ve onaylı bir yönetici olduğu doğrulanır.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim())

function cors(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  const allow = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin) ? origin || '*' : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

const ROLES = ['admin', 'egitmen', 'personel'] as const
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Yöntem desteklenmiyor' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Oturum gerekli' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Arayanı doğrula
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return json({ error: 'Geçersiz oturum' }, 401)
  const callerId = userData.user.id
  const { data: caller } = await admin.from('profiles').select('role, is_active, approved').eq('id', callerId).maybeSingle()
  if (!caller || caller.role !== 'admin' || !caller.is_active || !caller.approved) {
    return json({ error: 'Bu işlem yalnızca yöneticiler içindir.' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Geçersiz istek' }, 400)
  }
  const action = String(body.action ?? '')

  try {
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const full_name = String(body.full_name ?? '').trim().slice(0, 120)
      const role = String(body.role ?? 'personel')
      if (!EMAIL_RE.test(email)) return json({ error: 'Geçerli bir e-posta girin' }, 400)
      if (password.length < 8 || password.length > 72) return json({ error: 'Şifre 8-72 karakter olmalı' }, 400)
      if (full_name.length < 2) return json({ error: 'Ad soyad girin' }, 400)
      if (!ROLES.includes(role as (typeof ROLES)[number])) return json({ error: 'Geçersiz rol' }, 400)

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
        app_metadata: { role, approved: true },
      })
      if (error) {
        const msg = /already|registered|exists/i.test(error.message) ? 'Bu e-posta ile zaten bir hesap var.' : error.message
        return json({ error: msg }, 400)
      }
      // Profil tetikleyici ile oluşturulur; rol ve onayı garanti altına al
      await admin.from('profiles').update({ role, approved: true, is_active: true, full_name }).eq('id', data.user.id)
      return json({ ok: true, user_id: data.user.id })
    }

    if (action === 'set_password') {
      const userId = String(body.user_id ?? '')
      const password = String(body.password ?? '')
      if (password.length < 8 || password.length > 72) return json({ error: 'Şifre 8-72 karakter olmalı' }, 400)
      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) return json({ error: error.message }, 400)
      await admin.from('audit_logs').insert({ table_name: 'auth.users', record_id: userId, action: 'update', actor_id: callerId, new_data: { password: 'değiştirildi' } })
      return json({ ok: true })
    }

    if (action === 'delete') {
      const userId = String(body.user_id ?? '')
      if (userId === callerId) return json({ error: 'Kendi hesabınızı silemezsiniz.' }, 400)
      const { data: target } = await admin.from('profiles').select('role, is_active, approved').eq('id', userId).maybeSingle()
      if (target?.role === 'admin' && target.is_active && target.approved) {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true).eq('approved', true)
        if ((count ?? 0) <= 1) return json({ error: 'Sistemde en az bir aktif yönetici kalmalıdır.' }, 400)
      }
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) return json({ error: error.message }, 400)
      await admin.from('audit_logs').insert({ table_name: 'auth.users', record_id: userId, action: 'delete', actor_id: callerId })
      return json({ ok: true })
    }

    return json({ error: 'Bilinmeyen işlem' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Sunucu hatası' }, 500)
  }
})
