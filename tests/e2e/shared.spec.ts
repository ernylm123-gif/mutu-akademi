import { expect, test, devices, type Page } from '@playwright/test'

// Girişsiz ORTAK ders alanı – gerçek arayüzle uçtan uca (iki bağımsız telefon oturumu).
// Test kayıtları "(silinecek)" etiketlidir ve test sonunda silinir.
// Ortak veritabanına yazar: yalnızca açıkça E2E_SHARED_WRITE=1 verildiğinde çalışır.
test.skip(!process.env.E2E_SHARED_WRITE, 'Ortak alana yazan test yalnızca E2E_SHARED_WRITE=1 ile çalışır')
test.describe.configure({ mode: 'serial' })

const stamp = Date.now().toString(36).slice(-5)
const course = `E2E Ders ${stamp} (silinecek)`

async function openApp(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem('mutu-notif-prompt-later', String(Date.now())) } catch { /* yoksay */ } })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Ders Programı/ })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Canlı', { exact: true })).toBeVisible({ timeout: 20_000 })
}

const dlg = (page: Page, name: string) => page.getByRole('dialog').last().getByRole('button', { name, exact: true })
const toast = (page: Page, re: RegExp) => page.getByRole('status').filter({ hasText: re }).first()
// Açık ders kartı/sayfası varsa kapat (kaydet sonrası sayfa açık kalır)
async function closeSheets(page: Page) {
  for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
}
const card = (page: Page, text: string) => page.getByTestId('ders-kart').filter({ hasText: text }).first()

test('ortak alan: ekle, düzenle, başlat, tamamla, ertele, iptal/geri al, sil/geri al – iki telefonda canlı', async ({ browser }) => {
  test.setTimeout(180_000)
  const a = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul' })).newPage()
  const b = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul' })).newPage()
  await openApp(a)
  await openApp(b)

  // 1) Ders ekle (yalnızca temel alanlar)
  await a.getByRole('button', { name: 'Ders ekle', exact: true }).click()
  await expect(a.getByRole('dialog')).toBeVisible()
  await a.getByLabel('Ders / kurs adı *').fill(course)
  await a.getByLabel('Kayıtsız öğrenci kısa adı').fill('Test')
  await a.getByLabel('Kayıtsız eğitmen adı').fill(`E2E Eğitmen ${stamp}`)
  // Saatleri sunucu saatinden al (test bilgisayarının saati kayık olabilir): 10 dk sonra başlayan 1 saatlik ders
  const serverNow = new Date((await a.request.get('https://cukaxlujyfbmnedagqev.supabase.co/auth/v1/health')).headers()['date'])
  const ist = (d: Date) => ({ date: d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }), hm: d.toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) })
  const s0 = new Date(Math.ceil((serverNow.getTime() + 10 * 60000) / 300000) * 300000)
  const startT = ist(s0), endT = ist(new Date(s0.getTime() + 60 * 60000))
  test.skip(startT.date !== endT.date, 'Gece yarısını aşan saatte çalıştırılmamalı')
  await a.getByLabel('Tarih').fill(startT.date)
  await a.getByLabel('Başlangıç').fill(startT.hm)
  await a.getByLabel('Bitiş').fill(endT.hm)
  await dlg(a, 'Dersi ekle').click()
  await expect(toast(a, /Ders eklendi/)).toBeVisible({ timeout: 15_000 })
  await expect(card(a, course)).toBeVisible({ timeout: 15_000 })
  // ikinci telefonda yenilemeden görünür
  await expect(card(b, course)).toBeVisible({ timeout: 15_000 })

  // 2) Düzenle (öğrenci kısa adı)
  await closeSheets(a); await card(a, course).click()
  await dlg(a, 'Düzenle').click()
  await a.getByLabel('Kayıtsız öğrenci kısa adı').fill('Test2')
  await dlg(a, 'Kaydet').click()
  await expect(toast(a, /Ders güncellendi/)).toBeVisible({ timeout: 15_000 })
  await expect(card(b, course)).toContainText('Test2', { timeout: 15_000 })

  // 3) Dersi başlat → B'de "Devam ediyor"
  await closeSheets(a); await card(a, course).click()
  await dlg(a, 'Dersi başlat').click()
  await expect(toast(a, /Ders başladı/)).toBeVisible({ timeout: 15_000 })
  await expect(card(b, course)).toContainText('Devam ediyor', { timeout: 15_000 })

  // 4) Tamamlandı + yoklama "Öğrenci gelmedi" → B'de görünür; sonra geri al
  await dlg(a, 'Tamamlandı').click()
  await dlg(a, 'Öğrenci gelmedi').click()
  await dlg(a, 'Kaydet').click()
  await expect(toast(a, /tamamlandı olarak kaydedildi/)).toBeVisible({ timeout: 15_000 })
  await expect(card(b, course)).toContainText('Öğrenci gelmedi', { timeout: 15_000 })
  await closeSheets(a); await card(a, course).click()
  await dlg(a, 'Tamamlamayı geri al').click()
  await expect(toast(a, /Tamamlama geri alındı/)).toBeVisible({ timeout: 15_000 })

  // 5) Ertele (neden + yeni tarih/saat) → eski kayıt "Ertelendi"
  await closeSheets(a); await card(a, course).click()
  await dlg(a, 'Ertele').click()
  await a.getByLabel('Erteleme nedeni').selectOption('egitmen')
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })
  await a.getByLabel('Yeni tarih').fill(tomorrow)
  await a.getByLabel('Yeni başlangıç').fill('16:00')
  await a.getByLabel('Yeni bitiş').fill('17:00')
  await dlg(a, 'Ertele').click()
  await expect(toast(a, /Ders ertelendi/)).toBeVisible({ timeout: 15_000 })
  await expect(card(b, course)).toContainText('Ertelendi', { timeout: 15_000 })

  // 6) Yeni tarihli dersi aç → iptal et → iptali geri al
  await closeSheets(a); await card(a, course).click()
  await a.getByRole('button', { name: /Yeni tarih:/ }).click()
  await expect(a.getByText('16:00 – 17:00')).toBeVisible({ timeout: 15_000 })
  await dlg(a, 'İptal et').click()
  await a.getByLabel('İptal nedeni').fill('Test iptali')
  await dlg(a, 'İptal et').click()
  await expect(toast(a, /^Ders iptal edildi$/)).toBeVisible({ timeout: 15_000 })
  // B: Dersler sekmesinde yeni tarih "İptal edildi"
  await b.getByRole('button', { name: 'Dersler', exact: true }).click()
  await expect(card(b, course).filter({ hasText: 'İptal edildi' })).toBeVisible({ timeout: 15_000 })
  await closeSheets(a); await a.getByRole('button', { name: 'Dersler', exact: true }).click()
  await closeSheets(a); await card(a, course).filter({ hasText: 'İptal edildi' }).click()
  await dlg(a, 'İptali geri al').click()
  await expect(toast(a, /İptal geri alındı/)).toBeVisible({ timeout: 15_000 })
  await expect(card(b, course).filter({ hasText: 'Planlandı' })).toBeVisible({ timeout: 15_000 })

  // 7) Sil → onay → "Geri al" → tekrar sil (temizlik)
  await closeSheets(a); await card(a, course).filter({ hasText: 'Planlandı' }).click()
  await dlg(a, 'Sil').click()
  await dlg(a, 'Sil').click()
  await expect(toast(a, /silindi\./)).toBeVisible({ timeout: 15_000 })
  await expect(card(b, course).filter({ hasText: 'Planlandı' })).toHaveCount(0, { timeout: 15_000 })
  await a.getByRole('button', { name: 'Geri al', exact: true }).click()
  await expect(toast(a, /Ders geri getirildi/)).toBeVisible({ timeout: 15_000 })
  await expect(card(b, course).filter({ hasText: 'Planlandı' })).toBeVisible({ timeout: 15_000 })
  await closeSheets(a); await card(a, course).filter({ hasText: 'Planlandı' }).click()
  await dlg(a, 'Sil').click()
  await dlg(a, 'Sil').click()
  // eski (ertelenen) kaydı da sil
  await closeSheets(a); await a.getByRole('button', { name: 'Ana Sayfa', exact: true }).click()
  await closeSheets(a); await card(a, course).click()
  await dlg(a, 'Sil').click()
  await dlg(a, 'Sil').click()
  await expect(card(b, course)).toHaveCount(0, { timeout: 15_000 })
})
