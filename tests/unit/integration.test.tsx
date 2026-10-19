// Entegrasyon testleri: API katmanı + hata eşleme + form bileşenleri (Supabase istemcisi taklit edilir)
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const state = vi.hoisted(() => ({ updateResult: { data: null as unknown, error: null as unknown }, signIn: vi.fn() }))

vi.mock('@/lib/supabase', () => {
  const chain = {
    update: () => chain,
    eq: () => chain,
    select: () => chain,
    maybeSingle: () => Promise.resolve(state.updateResult),
  }
  return {
    supabaseConfigured: true,
    supabase: {
      from: () => chain,
      auth: { signInWithPassword: state.signIn },
    },
  }
})
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ refreshProfile: vi.fn(), profile: null, signOut: vi.fn() }) }))

import { updateVersioned } from '@/lib/api'
import { ConflictError } from '@/lib/errors'
import { LoginPage } from '@/pages/Auth'

describe('optimistic locking', () => {
  beforeEach(() => { state.updateResult = { data: null, error: null } })
  it('sürüm eşleşmezse (satır dönmezse) ConflictError fırlatır', async () => {
    await expect(updateVersioned('students', 'id', 3, { full_name: 'X' })).rejects.toBeInstanceOf(ConflictError)
  })
  it('başarılı güncellemede yeni satırı döndürür', async () => {
    state.updateResult = { data: { id: 'id', version: 4 }, error: null }
    await expect(updateVersioned('students', 'id', 3, { full_name: 'X' })).resolves.toEqual({ id: 'id', version: 4 })
  })
  it('sunucu hatasını yutmaz', async () => {
    state.updateResult = { data: null, error: { code: '42501', message: 'rls' } }
    await expect(updateVersioned('students', 'id', 3, {})).rejects.toMatchObject({ code: '42501' })
  })
})

describe('giriş formu', () => {
  it('geçersiz e-postada istek göndermez', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText('E-posta'), 'yanlis')
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
    expect(await screen.findByText('Geçerli bir e-posta girin')).toBeInTheDocument()
    expect(state.signIn).not.toHaveBeenCalled()
  })
  it('hatalı şifrede Türkçe hata gösterir, başarı göstermez', async () => {
    state.signIn.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText('E-posta'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Şifre'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('E-posta veya şifre hatalı.'))
  })
})
