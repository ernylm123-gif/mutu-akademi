import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// Tek arayüz – öğrenci/eğitmen yönetimi, bağlı ders, yoklama, toplam ders saati, 180 dk ders, tarih aralığı raporu (PDF/Excel) (gerçek arayüz, iki istemci).
// Ortak alana yazar: yalnızca E2E_SHARED_WRITE=1 ile çalışır. Test kayıtları "Testoğlu/Testçi" adlıdır ve sonradan temizlenir.
test.skip(!process.env.E2E_SHARED_WRITE, 'Ortak alana yazan test yalnızca E2E_SHARED_WRITE=1 ile çalışır')
test.describe.configure({ mode: 'serial' })

const stamp = Date.now().toString(36).slice(-5)
const studentName = `Ezgi Testoğlu${stamp}`
const instrName = `Ahmet Testçi${stamp}`
const course = `E2E Kurs ${stamp} (silinecek)`

const dlg = (page: Page, name: string) => page.getByRole('dialog').last().getByRole('button', { name, exact: true })
const toast = (page: Page, re: RegExp) => page.getByRole('status').filter({ hasText: re }).first()
const tile = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..')

async function open(page: Page, baseURL: string | undefined) {
  await page.addInitScript(() => { try { localStorage.setItem('mutu-notif-prompt-later', String(Date.now())) } catch { /* yoksay */ } })
  await page.goto(`${baseURL}/`)
  await expect(page.getByText('Aktif öğrenci')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Canlı', { exact: true })).toBeVisible({ timeout: 30_000 })
}

test('tek arayüz: öğrenci, eğitmen, bağlı ders, yoklama, aylık süre, kalan hak – iki istemcide canlı', async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== 'masaustu', 'Yalnızca bir projede çalışır')
  test.setTimeout(240_000)
  const mk = async () => (await browser.newContext({ locale: 'tr-TR', timezoneId: 'Europe/Istanbul', viewport: { width: 420, height: 900 } })).newPage()
  const a = await mk()
  const b = await mk()
  await open(a, baseURL)
  await open(b, baseURL)

  // Menü: işlevsel gezinme, yetki/eşleştirme metni yok
  await a.getByRole('button', { name: 'Menü', exact: true }).click()
  for (const m of ['Ana Sayfa', 'Takvim', 'Dersler', 'Öğrenciler', 'Eğitmenler', 'Yoklama', 'Raporlar', 'Bildirimler', 'Ayarlar']) {
    await expect(a.getByRole('main').getByRole('button', { name: m, exact: true })).toBeVisible()
  }
  await expect(a.locator('body')).not.toContainText(/yetkili cihaz|yetkilendir|bağlantıyı isteyin/i)

  // Eğitmen ekle
  await a.getByRole('main').getByRole('button', { name: 'Eğitmenler', exact: true }).click()
  await a.getByRole('button', { name: 'Eğitmen Ekle' }).first().click()
  await a.getByLabel('Eğitmen adı *').fill(instrName)
  await a.getByLabel('Branş / Uzmanlık').fill('Piyano')
  await dlg(a, 'Kaydet').click()
  await expect(toast(a, /Eğitmen eklendi/)).toBeVisible({ timeout: 15_000 })
  await expect(a.getByRole('heading', { name: instrName })).toBeVisible({ timeout: 15_000 })

  // Öğrenci ekle (alt menüden, ders hakkı/paket alanı olmadan, eğitmen seçili)
  await a.getByRole('navigation').getByRole('button', { name: 'Öğrenciler', exact: true }).click()
  await a.getByRole('button', { name: 'Öğrenci Ekle' }).first().click()
  await a.getByLabel('Öğrenci adı *').fill(studentName)
  await expect(a.getByRole('dialog').last().getByText(/ders hakkı|Ders paketi/i)).toHaveCount(0)
  await a.getByRole('dialog').last().getByRole('button', { name: instrName }).click()
  await dlg(a, 'Kaydet').click()
  await expect(toast(a, /Öğrenci eklendi/)).toBeVisible({ timeout: 15_000 })
  await expect(a.getByRole('heading', { name: studentName })).toBeVisible({ timeout: 15_000 })

  // İkinci telefon: yenilemeden öğrenci listesinde görünür; profili açık bırakılır
  await b.getByRole('navigation').getByRole('button', { name: 'Öğrenciler', exact: true }).click()
  await b.getByTestId('ogrenci-kart').filter({ hasText: studentName }).click({ timeout: 20_000 })
  await expect(b.getByTestId('toplam-ders-saati')).toContainText('0 dk', { timeout: 15_000 })
  await expect(b.getByRole('main')).not.toContainText(/Kalan ders hakkı|Ders Hakları/)

  // Profilden ders ekle: geçmiş saatte 180 dk (tamamlanabilsin)
  const serverNow = new Date((await a.request.get('https://cukaxlujyfbmnedagqev.supabase.co/auth/v1/health')).headers()['date'])
  const ist = (d: Date) => ({ date: d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }), hm: d.toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) })
  const s0 = new Date(Math.floor((serverNow.getTime() - 240 * 60000) / 300000) * 300000)
  const st = ist(s0), en = ist(new Date(s0.getTime() + 180 * 60000))
  test.skip(st.date !== en.date || st.date !== ist(serverNow).date, 'Gece yarısına yakın saatte çalıştırılmamalı')
  await a.getByRole('button', { name: 'Bu öğrenciye ders ekle' }).click()
  await expect(a.getByRole('dialog').last().getByText(studentName)).toBeVisible()
  await a.getByLabel('Ders / kurs adı *').fill(course)
  await a.getByRole('dialog').last().getByLabel('Eğitmen', { exact: true }).selectOption({ label: instrName })
  await a.getByLabel('Tarih').fill(st.date)
  await a.getByLabel('Başlangıç').fill(st.hm)
  await a.getByRole('dialog').last().getByRole('button', { name: '180 dk', exact: true }).click()
  await expect(a.getByLabel('Bitiş')).toHaveValue(en.hm)
  await dlg(a, 'Dersi ekle').click()
  await expect(toast(a, /Ders eklendi/)).toBeVisible({ timeout: 15_000 })

  // Dersi aç → öğrenci bazında yoklama → tamamla
  await a.getByRole('navigation').getByRole('button', { name: 'Ana Sayfa', exact: true }).click()
  await a.getByTestId('ders-kart').filter({ hasText: course }).first().click()
  await dlg(a, 'Tamamlandı').click()
  await a.getByRole('button', { name: `${studentName}: Katıldı` }).click()
  await dlg(a, 'Kaydet').click()
  await expect(toast(a, /tamamlandı olarak kaydedildi/)).toBeVisible({ timeout: 15_000 })

  // İkinci telefon yenilemeden: toplam ders saati 3 sa (180 dk), 1 tamamlanan ders
  await expect(b.getByTestId('toplam-ders-saati')).toContainText('3 sa', { timeout: 20_000 })
  await expect(b.getByTestId('toplam-ders-saati')).toContainText('180 dakika')
  await expect(tile(b, 'Tamamlanan ders')).toContainText('1')
  await b.getByRole('button', { name: 'Tarih aralığı' }).click()
  await expect(tile(b, 'Ders saati')).toContainText('3 sa', { timeout: 15_000 })
  await b.getByRole('button', { name: 'Dersler', exact: true }).first().click()

  // Eğitmen profili: verilen eğitim 1 sa
  await a.getByRole('navigation').getByRole('button', { name: 'Menü', exact: true }).click()
  await a.getByRole('main').getByRole('button', { name: 'Eğitmenler', exact: true }).click()
  await a.getByTestId('egitmen-kart').filter({ hasText: instrName }).click()
  await a.getByRole('button', { name: 'İstatistikler' }).click()
  await expect(tile(a, 'Toplam eğitim süresi')).toContainText('3 sa', { timeout: 15_000 })

  // Yoklama ve Raporlar
  await a.getByRole('navigation').getByRole('button', { name: 'Menü', exact: true }).click()
  await a.getByRole('main').getByRole('button', { name: 'Yoklama', exact: true }).click()
  await expect(a.getByRole('main').getByText(course).first()).toBeVisible({ timeout: 15_000 })
  await a.getByRole('navigation').getByRole('button', { name: 'Menü', exact: true }).click()
  await a.getByRole('main').getByRole('button', { name: 'Raporlar', exact: true }).click()
  await expect(a.getByRole('heading', { name: 'Ders Raporları' })).toBeVisible()
  await a.getByRole('button', { name: 'Son 3 ay', exact: true }).click()
  await a.getByLabel('Öğrenci', { exact: true }).selectOption({ label: studentName })
  await expect(a.getByTestId('rapor-tablo').getByRole('cell', { name: studentName })).toBeVisible({ timeout: 15_000 })
  await expect(a.getByTestId('rapor-ozet')).toContainText('180 dakika')
  await expect(a.getByTestId('rapor-tablo')).toContainText('180 dk')
  for (const [btn, ext] of [['PDF', '.pdf'], ['Excel', '.xlsx']] as const) {
    const dl = a.waitForEvent('download', { timeout: 30_000 })
    await a.getByRole('button', { name: btn, exact: true }).click()
    const d = await dl
    expect(d.suggestedFilename().endsWith(ext)).toBe(true)
    const p = await d.path()
    expect(statSync(p).size).toBeGreaterThan(2000)
  }

  // Temizlik: test dersini sil (öğrenci/eğitmen kayıtları sonradan veritabanından temizlenir)
  await a.getByRole('navigation').getByRole('button', { name: 'Ana Sayfa', exact: true }).click()
  await a.getByTestId('ders-kart').filter({ hasText: course }).first().click()
  await dlg(a, 'Tamamlamayı geri al').click()
  await expect(toast(a, /Tamamlama geri alındı/)).toBeVisible({ timeout: 15_000 })
  await dlg(a, 'Sil').click()
  await dlg(a, 'Sil').click()
  await expect(a.getByTestId('ders-kart').filter({ hasText: course })).toHaveCount(0, { timeout: 20_000 })
})
