import { test, expect, type Browser } from '@playwright/test'

// Canlı ortamda (localhost dışı) hesap/oturum oluşturan veya şifre deneyen testler çalıştırılmaz.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL || 'http://localhost')
const SUPABASE_URL = process.env.E2E_SUPABASE_URL
const SUPABASE_KEY = process.env.E2E_SUPABASE_KEY // herkese açık (publishable) anahtar

test.describe('herkese açık sayfalar', () => {
  test('ana adres girişsiz olarak doğrudan ortak ders programını açar', async ({ page }) => {
    const t0 = Date.now()
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Ders Programı' })).toBeVisible({ timeout: 10_000 })
    expect(Date.now() - t0).toBeLessThan(10_000)
    await expect(page.locator('input')).toHaveCount(0)
    await expect(page.getByText(/Program alınamadı/)).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText('Canlı', { exact: true })).toBeVisible({ timeout: 15_000 })
  })

  test('yönetim alanı yetkisiz cihaza veri göstermez', async ({ page }) => {
    await page.goto('/yonetim')
    await expect(page.getByRole('heading', { name: 'Bu cihaz yetkili değil' })).toBeVisible()
    await expect(page.locator('input')).toHaveCount(0)
    await expect(page.getByLabel('Şifre')).toHaveCount(0)
    await expect(page.getByText('MUTU AKADEMİ').first()).toBeVisible()
  })

  test('süresi dolmuş/geçersiz oturumla açılış takılmaz', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mutu-akademi-auth', JSON.stringify({
        access_token: 'gecersiz.jwt.token', refresh_token: 'gecersiz-yenileme', token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 60,
        user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      }))
    })
    const t0 = Date.now()
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Ders Programı' })).toBeVisible({ timeout: 10_000 })
    expect(Date.now() - t0).toBeLessThan(20_000)
  })

  test('ortak programda telefon veya ödeme bilgisi bulunmaz', async ({ page }) => {
    await page.goto('/?gorunum=hafta')
    await page.getByRole('button', { name: 'Hafta' }).click()
    await page.waitForTimeout(2000)
    const text = await page.locator('main').innerText()
    expect(text).not.toMatch(/0\s?5\d{2}[\s-]?\d{3}|₺|veli/i)
  })

  test('ders detay bağlantısı (bildirimden) yetkisiz cihazda veri göstermez', async ({ page }) => {
    await page.goto('/ders/00000000-0000-0000-0000-000000000000')
    await expect(page.getByRole('heading', { name: 'Ders Programı' })).toBeVisible()
  })



  test('mobilde yatay taşma yok', async ({ page }) => {
    await page.goto('/')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('PWA: manifest, ikonlar, iOS ayarları ve service worker', async ({ page, request }) => {
    await page.goto('/')
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(manifestHref).toBeTruthy()
    const m = await (await request.get(manifestHref!)).json()
    expect(m.name).toBe('MUTU AKADEMİ')
    expect(m.display).toBe('standalone')
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBeTruthy()
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBeTruthy()
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBeTruthy()
    for (const icon of m.icons as { src: string }[]) expect((await request.get(icon.src)).ok()).toBeTruthy()
    expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBeTruthy()
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
    const splashes = await page.locator('link[rel="apple-touch-startup-image"]').evaluateAll((ls) => ls.map((l) => (l as HTMLLinkElement).href))
    expect(splashes.length).toBeGreaterThanOrEqual(10)
    for (const s of splashes) expect((await request.get(s)).ok()).toBeTruthy()
    const sw = await (await request.get('/sw.js')).text()
    expect(sw).toContain('push')
    expect(sw).toContain('notificationclick')
  })

  test('service worker kaydolur ve veri isteklerini önbelleğe almaz', async ({ page }) => {
    await page.goto('/')
    const ok = await page.evaluate(async () => {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15000))])
      return !!reg
    })
    expect(ok).toBeTruthy()
    const cached = await page.evaluate(async () => {
      const urls: string[] = []
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(r.url)
      return urls
    })
    expect(cached.some((u) => u.includes('supabase.co'))).toBeFalsy()
  })
})

test.describe('veritabanı güvenliği (herkese açık anahtarla, oturumsuz)', () => {
  test.skip(!SUPABASE_URL || !SUPABASE_KEY, 'E2E_SUPABASE_URL / E2E_SUPABASE_KEY tanımlı değil')
  const h = () => ({ apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' })

  for (const table of ['students', 'lessons', 'attendance', 'payments', 'profiles', 'device_invites', 'push_subscriptions', 'push_deliveries', 'audit_logs']) {
    test(`oturumsuz istek ${table} tablosunu okuyamaz`, async ({ request }) => {
      const r = await request.get(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, { headers: h() })
      expect(r.status()).toBeGreaterThanOrEqual(400)
    })
  }

  test('push gönderim kuyruğu yanlış anahtarla alınamaz', async ({ request }) => {
    const r = await request.post(`${SUPABASE_URL}/rest/v1/rpc/claim_push_batch`, { headers: h(), data: { p_secret: 'x'.repeat(64) } })
    expect(r.status()).toBeGreaterThanOrEqual(400)
  })

  test('ortak program fonksiyonu girişsiz çalışır ve kişisel veri döndürmez', async ({ request }) => {
    const from = new Date(Date.now() - 86400000).toISOString()
    const to = new Date(Date.now() + 14 * 86400000).toISOString()
    const r = await request.post(`${SUPABASE_URL}/rest/v1/rpc/get_public_schedule`, { headers: h(), data: { p_from: from, p_to: to } })
    expect(r.status()).toBe(200)
    const body = await r.text()
    expect(body).not.toMatch(/phone|guardian|notes|amount|0\s?5\d{2}/i)
  })

  test('aktiviteler ve cihaz eşleştirme oturumsuz çağrılamaz', async ({ request }) => {
    expect((await request.post(`${SUPABASE_URL}/rest/v1/rpc/get_activities`, { headers: h(), data: {} })).status()).toBeGreaterThanOrEqual(400)
    expect((await request.post(`${SUPABASE_URL}/rest/v1/rpc/redeem_device_invite`, { headers: h(), data: { p_code: 'AAAAABBBBB' } })).status()).toBeGreaterThanOrEqual(400)
  })
})

test.describe('yalnızca yerel ortam', () => {
  test.skip(!isLocal, 'Canlı ortamda hesap/oturum oluşturan testler çalıştırılmaz')

  test('yanlış şifre başarı olarak gösterilmez', async ({ page }) => {
    await page.goto('/giris')
    await page.getByLabel('E-posta').fill('olmayan-kullanici@example.com')
    await page.getByLabel('Şifre').fill('yanlis-sifre-123')
    await page.getByRole('button', { name: 'Giriş yap' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/giris$/)
  })
})

// İki cihaz senaryosu: E2E_EMAIL / E2E_PASSWORD ile (yalnızca yerel/test ortamı için)
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

async function login(browser: Browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/giris')
  await page.getByLabel('E-posta').fill(email!)
  await page.getByLabel('Şifre').fill(password!)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
  await expect(page.getByText('Bugünkü dersler')).toBeVisible({ timeout: 20_000 })
  return { ctx, page }
}

test.describe('giriş yapmış iki cihaz', () => {
  test.skip(!email || !password || !isLocal, 'Yalnızca yerel ortamda test hesabıyla çalışır')

  test('birinde eklenen öğrenci diğerinde yenilemeden görünür', async ({ browser }) => {
    const a = await login(browser)
    const b = await login(browser)
    await b.page.goto('/ogrenciler')
    await expect(b.page.getByText('Canlı')).toBeVisible({ timeout: 15_000 })
    const name = `E2E Öğrenci ${Date.now()}`
    await a.page.goto('/ogrenciler?yeni=1')
    await a.page.getByLabel('Ad soyad *').fill(name)
    await a.page.getByRole('button', { name: 'Kaydet' }).click()
    await expect(a.page.getByText('Öğrenci eklendi')).toBeVisible()
    await expect(b.page.getByText(name)).toBeVisible({ timeout: 15_000 })
    await a.ctx.close()
    await b.ctx.close()
  })
})
