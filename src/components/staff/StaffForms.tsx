import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Plus, Trash2 } from 'lucide-react'
import { dateKey, WEEKDAYS, WEEKDAYS_SHORT } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { staff, type Availability, type StaffInstructor, type StaffStudent } from '@/lib/staffApi'
import { Button, Field, Input, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])
const splitList = (s: string) => [...new Set(s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 20)

type Slot = { weekday: number; start_time: string; duration_minutes: number; instructor_id: string | null }

/** Öğrenci kaydı (telefon, veli ve notlar korumalıdır; herkese açık programda yalnızca kısa ad görünür) */
export function StudentFormSheet({ open, onClose, student, instructors, courses, onSaved, quick }: {
  open: boolean; onClose: () => void; student?: StaffStudent | null; instructors: StaffInstructor[]; courses: string[]
  onSaved: (s: StaffStudent) => void; quick?: boolean
}) {
  const toast = useToast()
  const [v, setV] = useState(() => blankStudent())
  const [courseText, setCourseText] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null); setDirty(false)
    if (student) {
      setV({
        full_name: student.full_name, public_label: student.public_label, phone: student.phone ?? '', guardian_name: student.guardian_name ?? '',
        guardian_phone: student.guardian_phone ?? '', registered_at: student.registered_at, instructor_ids: student.instructor_ids ?? [],
        package_name: student.package_name ?? '', total_lessons: student.total_lessons, default_duration: student.default_duration,
        notes: student.notes ?? '', is_active: student.is_active,
      })
      setCourseText((student.course_names ?? []).join(', '))
      staff.weekly(student.id).then((w) => setSlots(w.map((x) => ({ weekday: x.weekday, start_time: x.start_time.slice(0, 5), duration_minutes: x.duration_minutes, instructor_id: x.instructor_id })))).catch(() => setSlots([]))
    } else { setV(blankStudent()); setCourseText(''); setSlots([]) }
  }, [open, student])

  const set = (p: Partial<typeof v>) => { setV((x) => ({ ...x, ...p })); setDirty(true); setError(null) }
  const invalid = v.full_name.trim().length < 2 ? 'Ad soyad yazın.' : v.total_lessons < 0 ? 'Ders hakkı negatif olamaz.' : null

  const save = async () => {
    if (invalid || busy) return
    setBusy(true); setError(null)
    try {
      const row: Partial<StaffStudent> = {
        full_name: v.full_name.trim(), public_label: v.public_label.trim() || null as unknown as string, phone: v.phone.trim() || null,
        guardian_name: v.guardian_name.trim() || null, guardian_phone: v.guardian_phone.trim() || null, registered_at: v.registered_at || dateKey(),
        course_names: splitList(courseText), instructor_ids: v.instructor_ids, package_name: v.package_name.trim() || null,
        total_lessons: Math.round(Number(v.total_lessons) || 0), default_duration: Math.round(Number(v.default_duration) || 60),
        notes: v.notes.trim() || null, is_active: v.is_active,
      }
      const s = await staff.saveStudent(row, student)
      if (!quick) await staff.setWeekly(s.id, slots.filter((x) => /^\d\d:\d\d$/.test(x.start_time)))
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
        <Field label="Ad Soyad *"><Input autoComplete="off" value={v.full_name} maxLength={120} onChange={(e) => set({ full_name: e.target.value })} /></Field>
        <Field label="Programda görünen kısa ad" hint="Boş bırakılırsa otomatik: Ezgi Kaya → Ezgi K.">
          <Input value={v.public_label} maxLength={40} onChange={(e) => set({ public_label: e.target.value })} placeholder="Ör. Ezgi K." />
        </Field>
        <Field label="Telefon"><Input type="tel" inputMode="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="05xx xxx xx xx" /></Field>
        <Field label="Kayıt tarihi"><Input type="date" value={v.registered_at} onChange={(e) => set({ registered_at: e.target.value })} /></Field>
        <Field label="Kurs / Eğitim" hint="Birden fazla kursu virgülle ayırın." className="sm:col-span-2">
          <Input list="dl-kurslar" value={courseText} onChange={(e) => { setCourseText(e.target.value); setDirty(true) }} placeholder="Ör. Piyano, Solfej" />
          <datalist id="dl-kurslar">{courses.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-semibold">Eğitmen</p>
          {instructors.length === 0 ? <p className="text-sm text-slate-500">Henüz eğitmen yok. Eğitmenler bölümünden ekleyebilirsiniz.</p> : (
            <div className="flex flex-wrap gap-2">
              {instructors.filter((i) => i.is_active || v.instructor_ids.includes(i.id)).map((i) => (
                <button type="button" key={i.id} onClick={() => set({ instructor_ids: toggle(v.instructor_ids, i.id) })}
                  className={clsx('min-h-10 rounded-full px-3.5 text-sm font-semibold', v.instructor_ids.includes(i.id) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700')}>
                  {i.full_name}
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="Ders paketi"><Input value={v.package_name} maxLength={80} onChange={(e) => set({ package_name: e.target.value })} placeholder="Ör. 8 derslik paket" /></Field>
        <Field label="Toplam ders hakkı" hint={student ? 'Değişiklik ders hakları geçmişine düzeltme olarak eklenir.' : 'Başlangıç paketi olarak kaydedilir.'}>
          <Input type="number" inputMode="numeric" min={0} value={v.total_lessons} onChange={(e) => set({ total_lessons: Number(e.target.value) })} />
        </Field>
        <Field label="Varsayılan ders süresi (dk)">
          <Select value={v.default_duration} onChange={(e) => set({ default_duration: Number(e.target.value) })}>
            {[30, 40, 45, 50, 60, 75, 90, 120].map((d) => <option key={d} value={d}>{d} dakika</option>)}
          </Select>
        </Field>
        {!quick && (
          <>
            <Field label="Veli adı"><Input value={v.guardian_name} onChange={(e) => set({ guardian_name: e.target.value })} /></Field>
            <Field label="Veli telefonu"><Input type="tel" inputMode="tel" value={v.guardian_phone} onChange={(e) => set({ guardian_phone: e.target.value })} /></Field>
            <div className="sm:col-span-2">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-sm font-semibold">Haftalık program</p>
                <Button size="sm" variant="secondary" icon={<Plus className="size-4" />}
                  onClick={() => { setSlots((s) => [...s, { weekday: 1, start_time: '16:00', duration_minutes: v.default_duration, instructor_id: v.instructor_ids[0] ?? null }]); setDirty(true) }}>Gün ekle</Button>
              </div>
              {slots.length === 0 ? <p className="text-sm text-slate-500">Düzenli haftalık ders günü eklenmedi.</p> : (
                <div className="grid gap-2">
                  {slots.map((s, i) => (
                    <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] items-center gap-2">
                      <Select aria-label="Gün" value={s.weekday} onChange={(e) => { const n = [...slots]; n[i] = { ...s, weekday: Number(e.target.value) }; setSlots(n); setDirty(true) }}>
                        {WEEKDAYS.map((w, d) => <option key={w} value={d + 1}>{w}</option>)}
                      </Select>
                      <Input aria-label="Saat" type="time" step={300} value={s.start_time} onChange={(e) => { const n = [...slots]; n[i] = { ...s, start_time: e.target.value }; setSlots(n); setDirty(true) }} />
                      <Select aria-label="Süre" value={s.duration_minutes} onChange={(e) => { const n = [...slots]; n[i] = { ...s, duration_minutes: Number(e.target.value) }; setSlots(n); setDirty(true) }}>
                        {[30, 40, 45, 50, 60, 75, 90, 120].map((d) => <option key={d} value={d}>{d} dk</option>)}
                      </Select>
                      <button type="button" aria-label="Günü kaldır" className="grid size-11 place-items-center text-slate-400" onClick={() => { setSlots(slots.filter((_, j) => j !== i)); setDirty(true) }}><Trash2 className="size-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Field label="Notlar" className="sm:col-span-2"><Textarea rows={3} value={v.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Toggle checked={v.is_active} onChange={(a) => set({ is_active: a })} label="Aktif öğrenci" description="Pasif öğrenciler listede ayrı filtrelenir; geçmiş kayıtları korunur." /></div>
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}

function blankStudent() {
  return {
    full_name: '', public_label: '', phone: '', guardian_name: '', guardian_phone: '', registered_at: dateKey(), instructor_ids: [] as string[],
    package_name: '', total_lessons: 8, default_duration: 60, notes: '', is_active: true,
  }
}

/** Eğitmen kaydı: çalışma günleri/saatleri ders eklenirken sunucuda doğrulanır */
export function InstructorFormSheet({ open, onClose, instructor, courses, onSaved, quick }: {
  open: boolean; onClose: () => void; instructor?: StaffInstructor | null; courses: string[]; onSaved: (i: StaffInstructor) => void; quick?: boolean
}) {
  const toast = useToast()
  const [v, setV] = useState({ full_name: '', public_label: '', phone: '', specialty: '', courses: '', notes: '', is_active: true })
  const [days, setDays] = useState<number[]>([])
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('18:00')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null); setDirty(false)
    if (instructor) {
      setV({ full_name: instructor.full_name, public_label: instructor.public_label, phone: instructor.phone ?? '', specialty: instructor.specialty ?? '',
        courses: (instructor.course_names ?? []).join(', '), notes: instructor.notes ?? '', is_active: instructor.is_active })
      staff.availability(instructor.id).then((a: Availability[]) => {
        setDays([...new Set(a.map((x) => x.weekday))])
        if (a[0]) { setStart(a[0].start_time.slice(0, 5)); setEnd(a[0].end_time.slice(0, 5)) }
      }).catch(() => undefined)
    } else { setV({ full_name: '', public_label: '', phone: '', specialty: '', courses: '', notes: '', is_active: true }); setDays([]); setStart('09:00'); setEnd('18:00') }
  }, [open, instructor])

  const set = (p: Partial<typeof v>) => { setV((x) => ({ ...x, ...p })); setDirty(true); setError(null) }
  const invalid = v.full_name.trim().length < 2 ? 'Ad soyad yazın.' : days.length > 0 && end <= start ? 'Müsaitlik bitişi başlangıçtan sonra olmalı.' : null

  const save = async () => {
    if (invalid || busy) return
    setBusy(true); setError(null)
    try {
      const i = await staff.saveInstructor({
        full_name: v.full_name.trim(), public_label: v.public_label.trim() || null as unknown as string, phone: v.phone.trim() || null,
        specialty: v.specialty.trim() || null, course_names: splitList(v.courses), notes: v.notes.trim() || null, is_active: v.is_active,
      }, instructor)
      if (!quick || days.length) await staff.setAvailability(i.id, days, days.length ? start : null, days.length ? end : null)
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
        <Field label="Ad Soyad *"><Input autoComplete="off" value={v.full_name} maxLength={120} onChange={(e) => set({ full_name: e.target.value })} /></Field>
        <Field label="Programda görünen ad" hint="Boş bırakılırsa otomatik: Ahmet Yılmaz → Ahmet Y.">
          <Input value={v.public_label} maxLength={40} onChange={(e) => set({ public_label: e.target.value })} placeholder="Ör. Ahmet Hoca" />
        </Field>
        <Field label="Telefon"><Input type="tel" inputMode="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="Branş / Uzmanlık"><Input value={v.specialty} maxLength={120} onChange={(e) => set({ specialty: e.target.value })} placeholder="Ör. Piyano" /></Field>
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
            <Field label="Müsaitlik başlangıcı"><Input type="time" step={300} value={start} onChange={(e) => { setStart(e.target.value); setDirty(true) }} /></Field>
            <Field label="Müsaitlik bitişi"><Input type="time" step={300} value={end} onChange={(e) => { setEnd(e.target.value); setDirty(true) }} /></Field>
          </>
        )}
        {!quick && (
          <>
            <Field label="Notlar" className="sm:col-span-2"><Textarea rows={3} value={v.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Toggle checked={v.is_active} onChange={(a) => set({ is_active: a })} label="Aktif eğitmen" /></div>
          </>
        )}
        {invalid && dirty && <p className="text-xs text-slate-500 sm:col-span-2">{invalid}</p>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}
