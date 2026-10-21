// Özel bağlantıyla açılan sayfa için PWA manifest'i: iPhone'da "Ana Ekrana Ekle" yapıldığında
// ana ekran uygulaması da aynı tek kullanımlık anahtarla açılır (Safari ile depolama paylaşılmaz).
// Anahtar yalnızca bir kez kullanılabilir; kullanıldıktan sonra bu başlangıç adresi zararsızdır.
export default function handler(req: { query?: Record<string, string | string[]> }, res: {
  setHeader: (k: string, v: string) => void
  status: (n: number) => { json: (b: unknown) => void }
}) {
  const raw = String(req.query?.k ?? '')
  const k = /^[0-9A-Z]{10,40}$/.test(raw) ? raw : ''
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.status(200).json({
    id: '/',
    name: 'MUTU AKADEMİ',
    short_name: 'Mutu Akademi',
    description: 'Mutu Akademi öğrenci ve ders takip uygulaması',
    lang: 'tr',
    dir: 'ltr',
    start_url: k ? `/?k=${k}` : '/?kaynak=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  })
}
