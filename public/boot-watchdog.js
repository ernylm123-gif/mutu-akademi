// MUTU AKADEMİ – açılış güvencesi (React'tan bağımsız, eski Safari dahil her tarayıcıda çalışan ES5)
// - Uygulama kodu yüklenemez veya başlatılırken hata verirse logo ekranında takılı kalmak yerine
//   hatayı ve kurtarma seçeneklerini gösterir.
// - "Başarılı açılış" yalnızca React ilk ekranı gerçekten çizdikten sonra işaretlenir (window.__mutuMounted).
// - Kurtarma oturumu, cihaz yetkisini ve kayıtlı verileri (localStorage) SİLMEZ; yalnızca uygulama dosyası
//   önbelleğini ve Service Worker'ı temizler.
(function () {
  var shown = false
  var errors = []
  var LIMIT = 12000

  function note(msg) {
    if (!msg) return
    msg = String(msg).slice(0, 240)
    if (errors.indexOf(msg) === -1) errors.push(msg)
  }

  // Açılış sırasında oluşan hataları topla (betik yükleme hataları dahil)
  window.addEventListener('error', function (e) {
    if (window.__mutuMounted) return
    var t = e && e.target
    if (t && t !== window && (t.src || t.href)) note('Dosya yüklenemedi: ' + (t.src || t.href).replace(location.origin, ''))
    else note(e && (e.message || (e.error && e.error.message)))
    schedule(1500)
  }, true)
  window.addEventListener('unhandledrejection', function (e) {
    if (window.__mutuMounted) return
    note(e && e.reason && (e.reason.message || e.reason))
    schedule(1500)
  })

  // Safari (WebKit) bir kez yüklenemeyen JS dosyasını sayfa yenilense bile tekrar istemez ve uygulama
  // açılmaz. Bu yüzden yeniden denemeden önce uygulama dosyaları önbelleği atlanarak yeniden indirilir.
  function refetchAndReload() {
    var urls = []
    var nodes = document.querySelectorAll('script[src],link[rel="modulepreload"][href],link[rel="stylesheet"][href]')
    for (var i = 0; i < nodes.length; i++) urls.push(nodes[i].src || nodes[i].href)
    // Açılıştan sonra tembel yüklenen sayfa parçaları (başarısız olanlar dahil)
    try {
      var rs = performance.getEntriesByType('resource')
      for (var r = 0; r < rs.length; r++) if (/\/assets\/.+\.(js|css)$/.test(rs[r].name) && urls.indexOf(rs[r].name) === -1) urls.push(rs[r].name)
    } catch (e) { /* yoksay */ }
    var jobs = []
    if (window.fetch) {
      for (var j = 0; j < urls.length; j++) jobs.push(fetch(urls[j], { cache: 'reload' }).catch(function () { return null }))
    }
    var done = false
    function go() { if (!done) { done = true; location.reload() } }
    Promise.all(jobs).then(go, go)
    setTimeout(go, 8000)
  }

  function storageGet(k) { try { return sessionStorage.getItem(k) } catch (e) { return null } }
  function storageSet(k, v) { try { sessionStorage.setItem(k, v) } catch (e) { /* yoksay */ } }

  var timer = null
  function schedule(ms) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(show, ms)
  }

  function btn(text, primary, onClick) {
    var b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.style.cssText = primary
      ? 'display:block;width:100%;margin-top:16px;height:50px;border:0;border-radius:16px;background:#2563eb;color:#fff;font-weight:600;font-size:16px;-webkit-appearance:none'
      : 'display:block;width:100%;margin-top:8px;height:44px;border:0;background:transparent;color:#64748b;font-size:14px;-webkit-appearance:none'
    b.onclick = onClick
    return b
  }

  function clearAppCache() {
    var jobs = []
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister() })) }))
      }
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k) })) }))
      }
    } catch (e) { /* yoksay */ }
    Promise.all(jobs).catch(function () {}).then(function () {
      refetchAndReload()
    })
  }

  function show() {
    if (shown || window.__mutuMounted) return
    // İlk açılış hatasında kullanıcıya sormadan bir kez otomatik onar (oturum başına bir kez; döngü yok)
    if (errors.length && navigator.onLine !== false && !storageGet('mutu-boot-retry')) {
      storageSet('mutu-boot-retry', String(Date.now()))
      shown = true
      refetchAndReload()
      return
    }
    var el = document.getElementById('boot-splash')
    if (!el) return
    shown = true
    var box = document.createElement('div')
    box.setAttribute('role', 'alert')
    box.style.cssText = 'margin-top:20px;width:100%;max-width:320px;padding:0 24px;box-sizing:border-box;text-align:center;color:#475569;font-size:14px;line-height:1.5'
    var title = document.createElement('div')
    title.style.cssText = 'font-weight:700;font-size:17px;color:#172033'
    title.textContent = navigator.onLine === false ? 'İnternet bağlantısı yok' : 'Uygulama açılamadı'
    var text = document.createElement('div')
    text.style.cssText = 'margin-top:6px'
    text.textContent = navigator.onLine === false
      ? 'Bağlantı gelince yeniden deneyin. Verileriniz ve cihaz yetkiniz korunuyor.'
      : 'Yeniden deneyin. Sorun sürerse "Uygulamayı yenile"ye dokunun; verileriniz ve cihaz yetkiniz korunur.'
    box.appendChild(title)
    box.appendChild(text)
    if (errors.length) {
      var detail = document.createElement('div')
      detail.style.cssText = 'margin-top:12px;padding:8px;border-radius:12px;background:#f1f5f9;font:12px ui-monospace,Menlo,monospace;color:#64748b;word-break:break-word'
      detail.textContent = errors.slice(0, 3).join(' · ')
      box.appendChild(detail)
    }
    box.appendChild(btn('Yeniden dene', true, function () { this.disabled = true; this.textContent = 'Yükleniyor…'; refetchAndReload() }))
    box.appendChild(btn('Uygulamayı yenile (önbelleği temizle)', false, clearAppCache))
    el.appendChild(box)
    // Bağlantı geri gelince kendiliğinden yeniden dene
    window.addEventListener('online', function () { if (!window.__mutuMounted) location.reload() })
  }

  schedule(LIMIT)
  window.__mutuRefetchReload = refetchAndReload
  window.__mutuBootFail = function (msg) { note(msg); schedule(0) }
})()
