import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// Yetkili cihaz – öğrenci/eğitmen yönetimi gerçek arayüzle uçtan uca.
// Tek kullanımlık test cihaz bağlantısı gerekir: E2E_STAFF_KEY. Test kayıtları "E2E" adlıdır ve sonradan temizlenir.
test.skip(!process.env.E2E_STAFF_KEY, 'Yetkili cihaz testi yalnızca E2E_STAFF_KEY ile çalışır')
test.describe.configure({ mode: 'serial' })

const stamp = Date.now().toString(36).slice(-5)
const studentName = `Ezgi Testoğlu${stamp}`
const instrName = `Ahmet Testçi${stamp}`
const course = `E2E Kurs ${stamp} (silinecek)`

const dlg = (page: Page, name: string) => page.getByRole('dialog').last().getByRole('button', { name, exact: true })
const toast = (page: Page, re: RegExp) => page.getByRole('status').filter({ hasText: re }).first()

test('yetkili cihaz: öğrenci, eğitmen, bağlı ders, yoklama, aylık süre ve kalan hak – iki istemcide', async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== 'masaustu', 'Yalnızca bir projede çalışır')
  test.setTimeout(240_000)
  // Eşleşmiş oturum dosyası varsa yeniden kullanılır (bağlantı tek kullanımlıktır)
  const statePath = process.env.E2E_STAFF_STATE
  const saved = statePath && existsSync(statePath) ? statePath : undefined
  const ctx = await browser.newContext({ locale: 'tr-TR', timezoneId: 'Europe/Istanbul', viewport: { width: 420, height: 900 }, storageState: saved })
  await ctx.addInitScript(() => { try { localStorage.setItem('mutu-notif-prompt-later', String(Date.now())) } catch { /* yoksay */ } })
  const a = await ctx.newPage()
  await a.goto(saved ? `${baseURL}/` : `${baseURL}/#k=${process.env.E2E_STAFF_KEY}`)
  await expect(a.getByText('Aktif öğrenci')).toBeVisible({ timeout: 40_000 })
  if (statePath && !saved) await ctx.storageState({ path: statePath })

  // Menü: yalnızca işlevsel bağlantılar
  await a.getByRole('button', { name: 'Menü', exact: true }).click()
  for (const m of ['Öğrenciler', 'Eğitmenler', 'Ders Programı', 'Ders Geçmişi', 'Yoklama', 'Raporlar', 'Bildirimler', 'Ayarlar']) {
    await expect(a.getByRole('main').getByRole('button', { name: m })).toBeVisible()
  }
  await expect(a.getByText('Ortak ders alanı hakkında')).toHaveCount(0)

  // Eğitmen ekle
  await a.getByRole('main').getByRole('button', { name: 'Eğitmenler' }).click()
  await a.getByRole('button', { name: 'Eğitmen Ekle' }).first().click()
  await a.getByLabel('Ad Soyad *').fill(instrName)
  await a.getByLabel('Branş / Uzmanlık').fill('Piyano')
  await dlg(a, 'Kaydet').click()
  await expect(toast(a, /Eğitmen eklendi/)).toBeVisible({ timeout: 15_000 })
  await expect(a.getByRole('heading', { name: instrName })).toBeVisible({ timeout: 15_000 })

  // Öğrenci ekle (10 ders hakkı)
  await a.getByRole('button', { name: 'Menü', exact: true }).click()
  await a.getByRole('main').getByRole('button', { name: 'Öğrenciler' }).click()
  await a.getByRole('button', { name: 'Öğrenci Ekle' }).first().click()
  await a.getByLabel('Ad Soyad *').fill(studentName)
  await a.getByLabel('Toplam ders hakkı').fill('10')
  await a.getByRole('dialog').last().getByRole('button', { name: instrName }).click()
  await dlg(a, 'Kaydet').click()
  await expect(toast(a, /Öğrenci eklendi/)).toBeVisible({ timeout: 15_000 })
  await expect(a.getByRole('heading', { name: studentName })).toBeVisible({ timeout: 15_000 })

  // İkinci istemci: aynı öğrencinin profili açık (canlı güncelleme beklenir)
  const a2 = await ctx.newPage()
  await a2.goto(`${baseURL}/`)
  await expect(a2.getByText('Aktif öğrenci')).toBeVisible({ timeout: 40_000 })
  await a2.getByRole('button', { name: 'Menü', exact: true }).click()
  await a2.getByRole('main').getByRole('button', { name: 'Öğrenciler' }).click()
  await a2.getByTestId('ogrenci-kart').filter({ hasText: studentName }).click()
  await a2.getByRole('button', { name: 'Ders Hakları' }).click()
  await expect(a2.getByText('Kalan', { exact: true }).locator('..')).toContainText('10', { timeout: 15_000 })

  // Üçüncü istemci: girişsiz herkese açık program (kişisel veri görünmemeli)
  const pubCtx = await browser.newContext({ locale: 'tr-TR', timezoneId: 'Europe/Istanbul' })
  await pubCtx.addInitScript(() => { try { localStorage.setItem('mutu-notif-prompt-later', String(Date.now())) } catch { /* yoksay */ } })
  const pub = await pubCtx.newPage()
  await pub.goto(`${baseURL}/`)
  await expect(pub.getByText('Canlı', { exact: true })).toBeVisible({ timeout: 30_000 })

  // Profilden ders ekle: geçmiş saatte 60 dk (tamamlanabilsin)
  const serverNow = new Date((await a.request.get('https://cukaxlujyfbmnedagqev.supabase.co/auth/v1/health')).headers()['date'])
  const ist = (d: Date) => ({ date: d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }), hm: d.toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) })
  const s0 = new Date(Math.floor((serverNow.getTime() - 120 * 60000) / 300000) * 300000)
  const st = ist(s0), en = ist(new Date(s0.getTime() + 60 * 60000))
  test.skip(st.date !== en.date || st.date !== ist(serverNow).date, 'Gece yarısına yakın saatte çalıştırılmamalı')
  await a.getByRole('button', { name: 'Genel' }).click()
  await a.getByRole('button', { name: 'Bu öğrenciye ders ekle' }).click()
  await expect(a.getByRole('dialog').last().getByText(studentName)).toBeVisible()
  await a.getByLabel('Ders / kurs adı *').fill(course)
  await a.getByRole('dialog').last().getByLabel('Eğitmen', { exact: true }).selectOption({ label: instrName })
  await a.getByLabel('Tarih').fill(st.date)
  await a.getByLabel('Başlangıç').fill(st.hm)
  await a.getByLabel('Bitiş').fill(en.hm)
  await dlg(a, 'Dersi ekle').click()
  await expect(toast(a, /Ders eklendi/)).toBeVisible({ timeout: 15_000 })

  // Herkese açık istemci: ders görünür, yalnızca kısa ad var
  const pubCard = pub.getByTestId('ders-kart').filter({ hasText: course })
  await expect(pubCard).toBeVisible({ timeout: 20_000 })
  await expect(pubCard).toContainText('Ezgi T.')
  await expect(pub.locator('body')).not.toContainText(`Testoğlu${stamp}`)

  // Yetkili istemci: dersi aç → öğrenci bazında yoklama → tamamla
  await a.getByRole('button', { name: 'Ana Sayfa', exact: true }).click()
  await a.getByTestId('ders-kart').filter({ hasText: course }).first().click()
  await dlg(a, 'Tamamlandı').click()
  await a.getByRole('button', { name: `${studentName}: Katıldı` }).click()
  await dlg(a, 'Kaydet').click()
  await expect(toast(a, /tamamlandı olarak kaydedildi/)).toBeVisible({ timeout: 15_000 })

  // İkinci istemci yenilemeden: kalan hak 9
  await expect(a2.getByText('Kalan', { exact: true }).locator('..')).toContainText('9', { timeout: 20_000 })
  await expect(a2.getByText('Kullanılan', { exact: true }).locator('..')).toContainText('1')
  // Aylık istatistik: 60 dk eğitim, 1 katıldığı ders
  await a2.getByRole('button', { name: 'İstatistikler' }).click()
  await expect(a2.getByText('Aldığı eğitim', { exact: true }).locator('..')).toContainText('1 sa', { timeout: 15_000 })
  await expect(a2.getByText('Katıldığı ders', { exact: true }).locator('..')).toContainText('1')
  await expect(a2.getByText('Kalan ders hakkı', { exact: true }).locator('..')).toContainText('9')

  // Eğitmen profili: verilen eğitim 1 sa
  await a.keyboard.press('Escape').catch(() => undefined)
  await a.getByRole('button', { name: 'Menü', exact: true }).click()
  await a.getByRole('main').getByRole('button', { name: 'Eğitmenler' }).click()
  await a.getByTestId('egitmen-kart').filter({ hasText: instrName }).click()
  await a.getByRole('button', { name: 'İstatistikler' }).click()
  await expect(a.getByText('Toplam eğitim süresi', { exact: true }).locator('..')).toContainText('1 sa', { timeout: 15_000 })

  // Yoklama ekranı: alınan yoklama listede
  await a.getByRole('button', { name: 'Menü', exact: true }).click()
  await a.getByRole('main').getByRole('button', { name: 'Yoklama' }).click()
  await expect(a.getByRole('main').getByText(course).first()).toBeVisible({ timeout: 15_000 })

  // Rapor: öğrenci bazında satır
  await a.getByRole('button', { name: 'Menü', exact: true }).click()
  await a.getByRole('main').getByRole('button', { name: 'Raporlar' }).click()
  await expect(a.getByRole('main').getByRole('cell', { name: studentName })).toBeVisible({ timeout: 15_000 })

  // Temizlik: test dersini sil (öğrenci/eğitmen kayıtları test sonrası veritabanından temizlenir)
  await a.getByRole('button', { name: 'Ana Sayfa', exact: true }).click()
  await a.getByTestId('ders-kart').filter({ hasText: course }).first().click()
  await dlg(a, 'Tamamlamayı geri al').click()
  await expect(toast(a, /Tamamlama geri alındı/)).toBeVisible({ timeout: 15_000 })
  await dlg(a, 'Sil').click()
  await dlg(a, 'Sil').click()
  await expect(pubCard).toHaveCount(0, { timeout: 20_000 })
})
