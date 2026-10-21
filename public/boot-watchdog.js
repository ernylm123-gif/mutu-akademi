// MUTU AKADEMİ – açılış güvencesi
// Uygulama kodu 15 sn içinde başlayamazsa (ör. eski önbellek, ağ hatası) logo ekranında takılı kalmak yerine
// kurtarma seçenekleri gösterir. Oturum ve cihaz yetkisi (localStorage) silinmez.
(function () {
  setTimeout(function () {
    if (window.__mutuMounted) return
    var el = document.getElementById('boot-splash')
    if (!el) return
    var box = document.createElement('div')
    box.style.cssText = 'margin-top:20px;max-width:320px;text-align:center;color:#475569;font-size:14px;line-height:1.5'
    box.textContent = 'Uygulama açılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.'
    var retry = document.createElement('button')
    retry.textContent = 'Yeniden dene'
    retry.style.cssText = 'display:block;width:100%;margin-top:16px;height:48px;border:0;border-radius:16px;background:#1689bf;color:#fff;font-weight:600;font-size:16px'
    retry.onclick = function () { location.reload() }
    var hard = document.createElement('button')
    hard.textContent = 'Uygulamayı yenile (önbelleği temizle)'
    hard.style.cssText = 'display:block;width:100%;margin-top:8px;height:44px;border:0;background:transparent;color:#64748b;font-size:14px'
    hard.onclick = function () {
      var jobs = []
      if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister() })) }))
      if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k) })) }))
      Promise.all(jobs).catch(function () {}).then(function () { location.reload() })
    }
    box.appendChild(retry)
    box.appendChild(hard)
    el.appendChild(box)
  }, 15000)
})()
