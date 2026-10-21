// Mutu Akademi yalnızca açık tema kullanır. Koyu tema bilinçli olarak devre dışıdır.
export function applyTheme() {
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = 'light'
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', '#ffffff'))
  try { localStorage.removeItem('mutu-theme') } catch { /* yoksay */ }
}
