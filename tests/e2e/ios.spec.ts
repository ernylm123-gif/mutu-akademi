import { expect, test, type Page } from '@playwright/test'

// iPhone açılış senaryoları (Playwright WebKit). Gerçek iPhone testinin yerini tamamen tutmaz.

const SCHEDULE = /Ders Programı/

async function opened(page: Page) {
  await expect(page.getByRole('heading', { name: SCHEDULE })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#boot-splash')).toHaveCount(0)
}

test('ilk açılış: logo ekranında kalmadan ortak program görünür', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await opened(page)
  expect(errors).toEqual([])
})

test("iOS 18.4 öncesi Safari API'leri yokken de açılır", async ({ page }) => {
  await page.addInitScript(() => {
    const g = globalThis as Record<string, unknown>
    delete (Promise as unknown as Record<string, unknown>).withResolvers
    delete (Object as unknown as Record<string, unknown>).groupBy
    delete (Map as unknown as Record<string, unknown>).groupBy
    delete (AbortSignal as unknown as Record<string, unknown>).any
    delete (URL as unknown as Record<string, unknown>).parse
    delete (URL as unknown as Record<string, unknown>).canParse
    try { delete g.Iterator } catch { /* yoksay */ }
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await opened(page)
  expect(errors).toEqual([])
})

test('JavaScript yüklenemezse kurtarma ekranı çıkar (sonsuz logo yok)', async ({ page }) => {
  await page.route(/\/assets\/index-.*\.js$/, (r) => r.fulfill({ status: 404, body: '' }))
  await page.goto('/')
  await expect(page.getByText('Uygulama açılamadı')).toBeVisible({ timeout: 12_000 })
  await expect(page.getByRole('button', { name: 'Yeniden dene' })).toBeVisible()
  await expect(page.getByRole('button', { name: /önbelleği temizle/ })).toBeVisible()
})

test('JavaScript başlatma hatası: kurtarma ekranı ve hata ayrıntısı', async ({ page }) => {
  await page.route(/\/assets\/react-.*\.js$/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'throw new Error("deneme başlatma hatası")' }))
  await page.goto('/')
  await expect(page.getByText('Uygulama açılamadı')).toBeVisible({ timeout: 12_000 })
})

test('Supabase yanıt vermezse sonsuza kadar beklemez', async ({ page }) => {
  await page.route(/supabase\.co/, () => { /* yanıt verme */ })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: SCHEDULE })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Program alınamadı/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Yeniden dene' })).toBeVisible()
})

test('internet kesilip geri gelince bağlantı durumu güncellenir', async ({ page, context }) => {
  await page.goto('/')
  await opened(page)
  await expect(page.getByText('Canlı', { exact: true })).toBeVisible({ timeout: 15_000 })
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByText('Çevrimdışı', { exact: true })).toBeVisible()
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Canlı', { exact: true })).toBeVisible({ timeout: 15_000 })
})

test('Service Worker ile kapatıp yeniden açma: döngü yok, program açılır', async ({ context }) => {
  const page = await context.newPage()
  let navigations = 0
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++ })
  await page.goto('/')
  await opened(page)
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true), null, { timeout: 15_000 })
  await page.waitForTimeout(7_000) // sürüm kontrolü + olası tek yenileme süresi
  expect(navigations).toBeLessThanOrEqual(2)
  await page.close()
  const again = await context.newPage()
  await again.goto('/')
  await opened(again)
  expect(await again.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
})

test('sunucuda eski sürüm dosyası kalmışsa (chunk bulunamadı) kurtarma çalışır', async ({ page }) => {
  await page.route(/\/assets\/supabase-.*\.js$/, (r) => r.fulfill({ status: 404, body: '', headers: { 'cache-control': 'no-store' } }))
  await page.goto('/')
  await expect(page.getByText('Uygulama açılamadı')).toBeVisible({ timeout: 12_000 })
  await page.unroute(/\/assets\/supabase-.*\.js$/)
  await page.getByRole('button', { name: /önbelleği temizle/ }).click()
  await opened(page)
})
