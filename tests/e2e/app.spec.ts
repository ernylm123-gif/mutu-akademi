import { test, expect, type Browser } from '@playwright/test'

test.describe('herkese açık sayfalar', () => {
  test('yetkisiz cihaz şifre değil, cihaz eşleştirme ekranı görür', async ({ page }) => {
    await page.goto('/ogrenciler')
    await expect(page).toHaveURL(/\/eslestir$/)
    await expect(page.getByRole('heading', { name: 'Cihazı bağla' })).toBeVisible()
    await expect(page.getByLabel('Şifre')).toHaveCount(0)
    await expect(page.getByText('MUTU AKADEMİ').first()).toBeVisible()
  })

  test('geçersiz e-posta doğrulaması', async ({ page }) => {
    await page.goto('/giris')
    await page.getByLabel('E-posta').fill('gecersiz')
    await page.getByRole('button', { name: 'Giriş yap' }).click()
    await expect(page.getByText('Geçerli bir e-posta girin')).toBeVisible()
  })

  test('yanlış şifre başarı olarak gösterilmez', async ({ page }) => {
    await page.goto('/giris')
    await page.getByLabel('E-posta').fill('olmayan-kullanici@example.com')
    await page.getByLabel('Şifre').fill('yanlis-sifre-123')
    await page.getByRole('button', { name: 'Giriş yap' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/giris$/)
  })

  test('geçersiz davet kodu reddedilir ve veri gösterilmez', async ({ page }) => {
    await page.goto('/eslestir?kod=AAAAA-BBBBB')
    await expect(page).toHaveURL(/\/eslestir$/) // kod adres çubuğundan silinir
    await page.getByRole('button', { name: 'Cihazı bağla' }).click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/eslestir$/)
  })

  test('PWA manifest ve service worker', async ({ page, request }) => {
    await page.goto('/giris')
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(manifestHref).toBeTruthy()
    const res = await request.get(manifestHref!)
    expect(res.ok()).toBeTruthy()
    const m = await res.json()
    expect(m.name).toBe('MUTU AKADEMİ')
    expect(m.display).toBe('standalone')
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBeTruthy()
    expect((await request.get('/sw.js')).ok()).toBeTruthy()
    expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBeTruthy()
  })
})

// Giriş gerektiren akışlar: E2E_EMAIL / E2E_PASSWORD ile çalışır (test hesabı)
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

async function login(browser: Browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/giris')
  await page.getByLabel('E-posta').fill(email!)
  await page.getByLabel('Şifre').fill(password!)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
  await expect(page.getByText(/Bugün \d+ ders var/)).toBeVisible({ timeout: 20_000 })
  return { ctx, page }
}

test.describe('giriş yapmış akışlar', () => {
  test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')

  test('iki cihaz: birinde eklenen öğrenci diğerinde yenilemeden görünür', async ({ browser }) => {
    const a = await login(browser)
    const b = await login(browser)
    await b.page.goto('/ogrenciler')
    await expect(b.page.getByRole('heading', { name: 'Öğrenciler' })).toBeVisible()
    await expect(b.page.getByText('Canlı')).toBeVisible({ timeout: 15_000 })

    const name = `E2E Öğrenci ${Date.now()}`
    await a.page.goto('/ogrenciler')
    await a.page.getByRole('button', { name: 'Öğrenci ekle' }).first().click()
    await a.page.getByLabel('Ad soyad *').fill(name)
    await a.page.getByRole('button', { name: 'Kaydet' }).click()
    await expect(a.page.getByText('Öğrenci eklendi')).toBeVisible()

    // İkinci cihaz sayfa yenilemeden görür
    await expect(b.page.getByText(name)).toBeVisible({ timeout: 15_000 })
    await a.ctx.close()
    await b.ctx.close()
  })
})
