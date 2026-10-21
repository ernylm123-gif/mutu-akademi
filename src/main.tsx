import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from '@/hooks/useAuth'
import { ToastProvider } from '@/components/ui/Toast'
import { applyTheme } from '@/hooks/useTheme'
import { readLinkKey } from '@/lib/pairing'
import './index.css'

applyTheme()

// Özel bağlantıyla açıldıysa ana ekrana eklenen uygulama da aynı anahtarla başlasın (iPhone)
{
  const k = readLinkKey()
  const link = document.querySelector('link[rel="manifest"]')
  if (k && link) link.setAttribute('href', `/api/manifest?k=${k}`)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (count, err) => count < 2 && !/JWT|permission|42501/i.test(String((err as Error)?.message)),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { networkMode: 'always', retry: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
