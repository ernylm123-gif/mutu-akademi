import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? new Date().toISOString().slice(0, 19)

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    {
      // Sunucudaki güncel sürüm: kurulu uygulamalar bunu önbelleksiz okuyup güncellenir
      name: 'mutu-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) })
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['logo.png', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'MUTU AKADEMİ',
        short_name: 'Mutu Akademi',
        description: 'Mutu Akademi öğrenci ve ders takip uygulaması',
        lang: 'tr',
        dir: 'ltr',
        start_url: '/?kaynak=pwa',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone'],
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        categories: ['education', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Bugünkü dersler', short_name: 'Takvim', url: '/takvim', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Öğrenci ekle', short_name: 'Öğrenci', url: '/ogrenciler?yeni=1', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        globIgnores: ['**/icons/splash-*', '**/assets/pdf-*.js', '**/assets/import-*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1800,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfmake')) return 'pdf'
          if (id.includes('pdfjs-dist') || id.includes('read-excel-file')) return 'import'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('react-dom') || id.includes('react-router')) return 'react'
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
})
