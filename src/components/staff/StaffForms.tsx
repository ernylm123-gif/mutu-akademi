import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { dateKey, WEEKDAYS, WEEKDAYS_SHORT } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { staff, type StaffInstructor, type StaffStudent, type WeeklyItem } from '@/lib/staffApi'
import { Button, Field, Input, Select, Sheet, Toggle } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])
const splitList = (s: string) => [...new Set(s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 20)
const DURS = [30, 40, 45, 50, 60, 75, 90, 120]

function PrivacyNote() {
  return <p className="flex gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800 sm:col-span-2"><ShieldAlert className="size-4 shrink-0" />Bu bilgiler bağlantıya sahip herkesçe görülebilir. Telefon, veli, ödeme veya sağlık bilgisi yazmayın.</p>
}

/** Öğrenci kaydı – yalnızca hassas olmayan bilgiler (ad, kurs, eğitmen, ders hakkı, haftalık program) */
export function StudentFormSheet({ open, onClose, student, instructors, courses, onSaved, quick, initialName }: {
  open: boolean; onClose: () => void; student?: StaffStudent | null; instructors: StaffInstructor[]; courses: string[]
  onSaved: (s: StaffStudent) => void; quick?: boolean; initialName?: string
}) {
  const toast = useToast()
  const blank = () => ({ name: initialName ?? '', registered_at: dateKey(), instructor_ids: [] as string[], package_name: '', total: 8, duration: 60, is_active: true })
  const [v, setV] = useState(blank)
  const [courseText, setCourseText] = useState('')
  const [slots, setSlots] = useState<WeeklyItem[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null); setDirty(false)
    if (student) {
      setV({ name: student.full_name, registered_at: student.registered_at, instructor_ids: student.instructor_ids ?? [], package_name: student.package_name ?? '',
        total: student.total_lessons, duration: student.default_duration, is_active: student.is_active })
      setCourseText((student.course_names ?? []).join(', '))
      setSlots((student.weekly ?? []).map((w) => ({ ...w })))
    } else { setV(blank()); setCourseText(''); setSlots([]) }
  }, [open, student]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<typeof v>) => { setV((x) => ({ ...x, ...p })); setDirty(true); setError(null) }
  const invalid = v.name.trim().length < 2 ? 'Öğrenci adını yazın.' : v.total < 0 ? 'Ders hakkı negatif olamaz.' : null

  const save = async () => {
    if (invalid || busy) return
    setBusy(true); setError(null)
    try {
      const s = await staff.saveStudent({
        name: v.name.trim(), courses: splitList(courseText), instructor_ids: v.instructor_ids, package_name: v.package_name.trim() || null,
        default_duration: v.duration, registered_at: v.registered_at || dateKey(), weekly: slots.filter((x) => /^\d\d:\d\d$/.test(x.start)),
        is_active: v.is_active, total_credits: Math.round(Number(v.total) || 0),
      }, student)
      toast.success(student ? 'Öğrenci güncellendi' : 'Öğrenci eklendi')
      setDirty(false)
      onSaved(s)
      onClose()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={student ? 'Öğrenciyi düzenle' : quick ? 'Hızlı öğrenci ekle' : 'Öğrenci ekle'} wide dirty={dirty && !busy}
      footer={
        <div className="grid gap-2">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Kaydedilemedi: {error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={onClose}>Vazgeç</Button>
            <Button block disabled={!!invalid} loading={busy} onClick={() => void save()}>Kaydet</Button>
          </div>
        </div>
      }>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save() }} noValidate>
        <Field label="Öğrenci adı *" hint="Ad ve soyadın baş harfi yeterli (ör. Ezgi K.).">
          <Input autoComplete="off" value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Kayıt tarihi"><Input type="date" value={v.registered_at} onChange={(e) => set({ registered_at: e.target.value })} /></Field>
        <Field label="Kurs / Eğitim" hint="Birden fazla kursu virgülle ayırın." className="sm:col-span-2">
          <Input list="dl-kurslar" value={courseText} onChange={(e) => { setCourseText(e.target.value); setDirty(true) }} placeholder="Ör. Piyano, Solfej" />
          <datalist id="dl-kurslar">{courses.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-semibold">Eğitmen</p>
          {instructors.length === 0 ? <p className="text-sm text-slate-500">Henüz eğitmen yok.</p> : (
            <div className="flex flex-wrap gap-2">
              {instructors.filter((i) => i.is_active || v.instructor_ids.includes(i.id)).map((i) => (
                <button type="button" key={i.id} aria-pressed={v.instructor_ids.includes(i.id)} onClick={() => set({ instructor_ids: toggle(v.instructor_ids, i.id) })}
                  className={clsx('min-h-10 rounded-full px-3.5 text-sm font-semibold', v.instructor_ids.includes(i.id) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700')}>
                  {i.full_name}
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="Ders paketi"><Input value={v.package_name} maxLength={80} onChange={(e) => set({ package_name: e.target.value })} placeholder="Ör. 8 derslik paket" /></Field>
        <Field label="Toplam ders hakkı" hint={student ? 'Değişiklik ders hakları geçmişine düzeltme olarak eklenir.' : 'Başlangıç paketi olarak kaydedilir.'}>
          <Input type="number" inputMode="numeric" min={0} value={v.total} onChange={(e) => set({ total: Number(e.target.value) })} />
        </Field>
        <Field label="Varsayılan ders süresi">
          <Select value={v.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>{DURS.map((d) => <option key={d} value={d}>{d} dakika</option>)}</Select>
        </Field>
        {!quick && (
          <>
            <div className="sm:col-span-2">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-sm font-semibold">Haftalık program</p>
                <Button size="sm" variant="secondary" icon={<Plus className="size-4" />}
                  onClick={() => { setSlots((s) => [...s, { weekday: 1, start: '16:00', duration: v.duration }]); setDirty(true) }}>Gün ekle</Button>
              </div>
              {slots.length === 0 ? <p className="text-sm text-slate-500">Düzenli haftalık ders günü eklenmedi.</p> : (
                <div className="grid gap-2">
                  {slots.map((s, i) => (
                    <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] items-center gap-2">
                      <Select aria-label="Gün" value={s.weekday} onChange={(e) => { const n = [...slots]; n[i] = { ...s, weekday: Number(e.target.value) }; setSlots(n); setDirty(true) }}>
                        {WEEKDAYS.map((w, d) => <option key={w} value={d + 1}>{w}</option>)}
                      </Select>
                      <Input aria-label="Saat" type="time" step={300} value={s.start} onChange={(e) => { const n = [...slots]; n[i] = { ...s, start: e.target.value }; setSlots(n); setDirty(true) }} />
                      <Select aria-label="Süre" value={s.duration} onChange={(e) => { const n = [...slots]; n[i] = { ...s, duration: Number(e.target.value) }; setSlots(n); setDirty(true) }}>
                        {DURS.map((d) => <option key={d} value={d}>{d} dk</option>)}
                      </Select>
                      <button type="button" aria-label="Günü kaldır" className="grid size-11 place-items-center text-slate-400" onClick={() => { setSlots(slots.filter((_, j) => j !== i)); setDirty(true) }}><Trash2 className="size-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="sm:col-span-2"><Toggle checked={v.is_active} onChange={(a) => set({ is_active: a })} label="Aktif öğrenci" description="Pasif öğrencilerin geçmiş kayıtları korunur." /></div>
          </>
        )}
        <PrivacyNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}

/** Eğitmen kaydı: çalışma günleri/saatleri ders eklenirken sunucuda doğrulanır */
export function InstructorFormSheet({ open, onClose, instructor, courses, onSaved, quick }: {
  open: boolean; onClose: () => void; instructor?: StaffInstructor | null; courses: string[]; onSaved: (i: StaffInstructor) => void; quick?: boolean
}) {
  const toast = useToast()
  const [v, setV] = useState({ name: '', specialty: '', courses: '', is_active: true })
  const [days, setDays] = useState<number[]>([])
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('20:00')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null); setDirty(false)
    if (instructor) {
      setV({ name: instructor.full_name, specialty: instructor.specialty ?? '', courses: (instructor.course_names ?? []).join(', '), is_active: instructor.is_active })
      setDays(instructor.work_days ?? []); setStart(instructor.work_start ?? '09:00'); setEnd(instructor.work_end ?? '20:00')
    } else { setV({ name: '', specialty: '', courses: '', is_active: true }); setDays([]); setStart('09:00'); setEnd('20:00') }
  }, [open, instructor])

  const set = (p: Partial<typeof v>) => { setV((x) => ({ ...x, ...p })); setDirty(true); setError(null) }
  const invalid = v.name.trim().length < 2 ? 'Eğitmen adını yazın.' : days.length > 0 && end <= start ? 'Çalışma bitişi başlangıçtan sonra olmalı.' : null

  const save = async () => {
    if (invalid || busy) return
    setBusy(true); setError(null)
    try {
      const i = await staff.saveInstructor({
        name: v.name.trim(), specialty: v.specialty.trim() || null, courses: splitList(v.courses), work_days: days,
        work_start: days.length ? start : null, work_end: days.length ? end : null, is_active: v.is_active,
      }, instructor)
      toast.success(instructor ? 'Eğitmen güncellendi' : 'Eğitmen eklendi')
      setDirty(false)
      onSaved(i)
      onClose()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={instructor ? 'Eğitmeni düzenle' : 'Eğitmen ekle'} wide dirty={dirty && !busy}
      footer={
        <div className="grid gap-2">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Kaydedilemedi: {error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={onClose}>Vazgeç</Button>
            <Button block disabled={!!invalid} loading={busy} onClick={() => void save()}>Kaydet</Button>
          </div>
        </div>
      }>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save() }} noValidate>
        <Field label="Eğitmen adı *"><Input autoComplete="off" value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="Ör. Ahmet Hoca" /></Field>
        <Field label="Branş / Uzmanlık"><Input value={v.specialty} maxLength={80} onChange={(e) => set({ specialty: e.target.value })} placeholder="Ör. Piyano" /></Field>
        <Field label="Verdiği kurslar" hint="Virgülle ayırın." className="sm:col-span-2">
          <Input list="dl-ekurslar" value={v.courses} onChange={(e) => set({ courses: e.target.value })} placeholder="Ör. Piyano, Solfej" />
          <datalist id="dl-ekurslar">{courses.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-semibold">Çalışma günleri</p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS_SHORT.map((w, d) => (
              <button type="button" key={w} aria-pressed={days.includes(d + 1)} onClick={() => { setDays(toggle(days, d + 1).sort()); setDirty(true) }}
                className={clsx('h-11 min-w-12 rounded-full px-3 text-sm font-semibold', days.includes(d + 1) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700')}>{w}</button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{days.length ? 'Ders yalnızca bu gün ve saatlerde eklenebilir.' : 'Gün seçilmezse çalışma saati kontrolü yapılmaz.'}</p>
        </div>
        {days.length > 0 && (
          <>
            <Field label="Çalışma başlangıcı"><Input type="time" step={300} value={start} onChange={(e) => { setStart(e.target.value); setDirty(true) }} /></Field>
            <Field label="Çalışma bitişi"><Input type="time" step={300} value={end} onChange={(e) => { setEnd(e.target.value); setDirty(true) }} /></Field>
          </>
        )}
        {!quick && <div className="sm:col-span-2"><Toggle checked={v.is_active} onChange={(a) => set({ is_active: a })} label="Aktif eğitmen" /></div>}
        {invalid && dirty && <p className="text-xs text-slate-500 sm:col-span-2">{invalid}</p>}
        <PrivacyNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}
