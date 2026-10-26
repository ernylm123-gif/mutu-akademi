import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ShieldAlert, Plus, X } from 'lucide-react'
import { addMonths, dateKey, timeHM } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { shared, requestId, type SeriesScope, type SharedInput, type SharedLesson } from '@/lib/sharedApi'
import { Button, Field, Input, Segmented, Select, Sheet, Textarea, Toggle } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'
import { staff, type StaffInstructor, type StaffStudent } from '@/lib/staffApi'
import { matchesSearch } from '@/lib/format'
import { StudentFormSheet, InstructorFormSheet } from '@/components/staff/StaffForms'

export interface StaffCtx { students: StaffStudent[]; instructors: StaffInstructor[]; reload: () => void }

const DURATIONS = [45, 60, 90, 120]
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const toHM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Ortak ders ekleme / düzenleme. Kişisel bilgi (telefon, veli, ödeme) alanı yoktur. */
export function SharedLessonForm({ open, onClose, editing, defaultDate, suggestions, onSaved, staffCtx, presetStudentId }: {
  open: boolean
  onClose: () => void
  editing?: SharedLesson | null
  defaultDate?: string
  suggestions: { courses: string[]; instructors: string[]; students: string[]; rooms: string[] }
  onSaved: (firstId?: string) => void
  /** Yetkili cihazda: kayıtlı öğrenci/eğitmen seçimi */
  staffCtx?: StaffCtx | null
  presetStudentId?: string | null
}) {
  const toast = useToast()
  const [v, setV] = useState<SharedInput & { repeat: boolean }>(() => blank(defaultDate))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(requestId())
  const [scope, setScope] = useState<SeriesScope>('this')
  const [sids, setSids] = useState<string[]>([])
  const [iid, setIid] = useState('')
  const [sq, setSq] = useState('')
  const [quickStudent, setQuickStudent] = useState(false)
  const [quickInstr, setQuickInstr] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null); setDirty(false); reqId.current = requestId(); setScope('this')
    if (editing) {
      setV({
        course_name: editing.course_name, student_label: editing.student_label ?? '', instructor_name: editing.instructor_name ?? '',
        room: editing.room ?? '', title: editing.title ?? '', note: editing.note ?? '', is_group: editing.is_group,
        date: dateKey(editing.starts_at), start: timeHM(editing.starts_at), end: timeHM(editing.ends_at), repeat: false,
      })
    } else setV(blank(defaultDate))
    setSids([]); setIid(''); setSq('')
    if (staffCtx && editing) {
      staff.links([editing.id]).then((r) => { setSids(r[0]?.student_ids ?? []); setIid(r[0]?.instructor_id ?? '') }).catch(() => undefined)
    } else if (staffCtx && presetStudentId) {
      const st = staffCtx.students.find((x) => x.id === presetStudentId)
      if (st) {
        setSids([st.id]); setIid(st.instructor_ids?.[0] ?? '')
        setV((x) => ({ ...x, course_name: st.course_names?.[0] ?? x.course_name, end: toHM(toMin(x.start) + st.default_duration) }))
      }
    }
  }, [open, editing, defaultDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const addStudent = (st: StaffStudent) => {
    setSq(''); setDirty(true); setError(null)
    if (sids.includes(st.id)) return
    if (sids.length === 0 && !editing) {
      setV((x) => ({ ...x, course_name: x.course_name || st.course_names?.[0] || '', end: toHM(toMin(x.start) + st.default_duration) }))
      if (!iid && st.instructor_ids?.[0]) setIid(st.instructor_ids[0])
    }
    setSids((xs) => (xs.includes(st.id) ? xs : [...xs, st.id]))
  }
  const studentMatches = staffCtx && sq.trim() ? staffCtx.students.filter((x) => x.is_active && !sids.includes(x.id) && matchesSearch([x.full_name, x.public_label], sq)).slice(0, 6) : []
  const allCourses = staffCtx ? [...new Set([...suggestions.courses, ...staffCtx.students.flatMap((x) => x.course_names ?? []), ...staffCtx.instructors.flatMap((x) => x.course_names ?? [])])] : suggestions.courses

  const set = (p: Partial<typeof v>) => { setV((x) => ({ ...x, ...p })); setDirty(true); setError(null) }
  const duration = /^\d\d:\d\d$/.test(v.start) && /^\d\d:\d\d$/.test(v.end) ? toMin(v.end) - toMin(v.start) : 0
  const invalid = !v.course_name.trim() ? 'Ders / kurs adını yazın.' : !v.date ? 'Tarih seçin.' : duration <= 0 ? 'Bitiş saati başlangıçtan sonra olmalı.' : duration > 600 ? 'Ders en fazla 10 saat olabilir.' : null

  const save = async () => {
    if (invalid || busy) return
    setBusy(true); setError(null)
    try {
      const p: SharedInput = {
        course_name: v.course_name, student_label: v.student_label, instructor_name: v.instructor_name, room: v.room,
        title: v.title, note: v.note, is_group: v.is_group, date: v.date, start: v.start, end: v.end,
        ...(v.repeat && !editing ? { repeat_until: v.repeat_until } : {}),
      }
      if (staffCtx) {
        const sp = { ...p, student_ids: sids, instructor_id: iid || null }
        if (editing) {
          const r = await staff.update(editing, sp, scope)
          toast.success(r.updated > 1 ? `${r.updated} ders güncellendi; tüm cihazlarda görünür` : 'Ders güncellendi; tüm cihazlarda görünür')
          onSaved(editing.id)
        } else {
          const r = await staff.create(sp, reqId.current)
          toast.success(r.created > 1 ? `${r.created} ders eklendi` : 'Ders eklendi; tüm cihazlarda görünür')
          onSaved(r.first_id)
        }
      } else if (editing) {
        const r = await shared.update(editing, p, scope)
        toast.success(r.updated > 1 ? `${r.updated} ders güncellendi; tüm telefonlarda görünür` : 'Ders güncellendi; tüm telefonlarda görünür')
        onSaved(editing.id)
      } else {
        const r = await shared.create(p, reqId.current)
        toast.success(r.created > 1 ? `${r.created} ders eklendi` : 'Ders eklendi; tüm telefonlarda görünür')
        onSaved(r.first_id)
      }
      setDirty(false)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Dersi düzenle' : 'Yeni ders'} dirty={dirty && !busy}
      footer={
        <div className="grid gap-2">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Kaydedilemedi: {error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={onClose}>Vazgeç</Button>
            <Button block disabled={!!invalid} loading={busy} onClick={() => void save()}>{editing ? 'Kaydet' : 'Dersi ekle'}</Button>
          </div>
          {invalid && dirty && <p className="text-center text-xs text-slate-500">{invalid}</p>}
        </div>
      }>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save() }} noValidate>
        {editing?.series_id && (
          <div>
            <p className="mb-1.5 text-sm font-semibold">Hangi dersler değişsin?</p>
            <Segmented value={scope} onChange={setScope} options={[{ value: 'this', label: 'Yalnızca bu' }, { value: 'following', label: 'Bu ve sonrakiler' }, { value: 'all', label: 'Tüm seri' }]} />
            {scope !== 'this' && <p className="mt-1.5 text-xs text-slate-500">Saat ve bilgiler serideki planlı derslere uygulanır; tarihler ve geçmiş/tamamlanan dersler değişmez.</p>}
          </div>
        )}
        <Field label="Ders / kurs adı *">
          <Input list="dl-kurs" value={v.course_name} maxLength={80} onChange={(e) => set({ course_name: e.target.value })} placeholder="Ör. Python Eğitimi" autoComplete="off" />
        </Field>
        {staffCtx ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-semibold">Öğrenci</p>
              <button type="button" onClick={() => setQuickStudent(true)} className="flex min-h-10 items-center gap-1 text-sm font-semibold text-brand-700"><Plus className="size-4" />Yeni öğrenci</button>
            </div>
            {sids.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {sids.map((id) => (
                  <span key={id} className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm font-semibold text-brand-800">
                    {staffCtx.students.find((x) => x.id === id)?.full_name ?? 'Öğrenci'}
                    <button type="button" aria-label="Öğrenciyi çıkar" className="grid size-8 place-items-center rounded-full" onClick={() => { setSids(sids.filter((x) => x !== id)); setDirty(true) }}><X className="size-3.5" /></button>
                  </span>
                ))}
              </div>
            )}
            <Input type="search" aria-label="Öğrenci ara" value={sq} onChange={(e) => setSq(e.target.value)} placeholder={sids.length ? 'Gruba öğrenci ekle…' : 'Öğrenci ara…'} autoComplete="off" />
            {studentMatches.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {studentMatches.map((x) => (
                  <button type="button" key={x.id} onClick={() => addStudent(x)} className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm active:bg-slate-50">
                    <span className="font-medium">{x.full_name}</span><span className="text-xs text-slate-500">{(x.course_names ?? []).join(', ')}</span>
                  </button>
                ))}
              </div>
            )}
            {sq.trim() && studentMatches.length === 0 && <p className="mt-1 text-xs text-slate-500">Bulunamadı. <button type="button" className="font-semibold text-brand-700" onClick={() => setQuickStudent(true)}>Yeni öğrenci ekle</button></p>}
            {sids.length === 0 && (
              <Input className="mt-2" list="dl-ogrenci" aria-label="Kayıtsız öğrenci kısa adı" value={v.student_label} maxLength={80} onChange={(e) => set({ student_label: e.target.value })} placeholder="veya kayıtsız kısa ad yazın (ör. Ezgi K.)" autoComplete="off" />
            )}
            <p className="mt-1 text-xs text-slate-500">Herkese açık programda yalnızca öğrencinin kısa adı görünür.</p>
          </div>
        ) : (
          <Field label={v.is_group ? 'Öğrenciler (kısa ad / takma ad)' : 'Öğrenci (kısa ad / takma ad)'} hint="Soyad, telefon veya kişisel bilgi yazmayın; herkes görebilir.">
            <Input list="dl-ogrenci" value={v.student_label} maxLength={80} onChange={(e) => set({ student_label: e.target.value })} placeholder={v.is_group ? 'Ör. Ezgi, Mert, Doğa' : 'Ör. Ezgi K.'} autoComplete="off" />
          </Field>
        )}
        {staffCtx ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-semibold">Eğitmen</p>
              <button type="button" onClick={() => setQuickInstr(true)} className="flex min-h-10 items-center gap-1 text-sm font-semibold text-brand-700"><Plus className="size-4" />Yeni eğitmen</button>
            </div>
            <Select aria-label="Eğitmen" value={iid} onChange={(e) => { setIid(e.target.value); setDirty(true); setError(null) }}>
              <option value="">Kayıtsız (adı yazın)</option>
              {staffCtx.instructors.filter((x) => x.is_active || x.id === iid).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
            </Select>
            {!iid && <Input className="mt-2" list="dl-egitmen" aria-label="Kayıtsız eğitmen adı" value={v.instructor_name} maxLength={80} onChange={(e) => set({ instructor_name: e.target.value })} placeholder="Eğitmen adı (isteğe bağlı)" autoComplete="off" />}
          </div>
        ) : (
          <Field label="Eğitmen" hint="Listede yoksa yeni adı yazmanız yeterli; sonraki derslerde önerilir.">
            <Input list="dl-egitmen" value={v.instructor_name} maxLength={80} onChange={(e) => set({ instructor_name: e.target.value })} placeholder="Ör. Deniz Hoca" autoComplete="off" />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Tarih" className="col-span-2"><Input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Başlangıç"><Input type="time" step={300} value={v.start} onChange={(e) => { const s = e.target.value; set({ start: s, end: /^\d\d:\d\d$/.test(s) && duration > 0 ? toHM(toMin(s) + duration) : v.end }) }} /></Field>
          <Field label="Bitiş"><Input type="time" step={300} value={v.end} onChange={(e) => set({ end: e.target.value })} /></Field>
        </div>
        <div className="-mt-2 flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <button key={d} type="button" onClick={() => set({ end: toHM(toMin(v.start) + d) })}
              className={clsx('h-10 rounded-full px-3.5 text-sm font-semibold', duration === d ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700')}>{d} dk</button>
          ))}
        </div>

        <details className="rounded-2xl border border-slate-200 px-3 [&[open]]:pb-3">
          <summary className="flex min-h-12 cursor-pointer items-center justify-between text-sm font-semibold">
            Gelişmiş ayarlar <span className="text-xs font-normal text-slate-500">Tekrar, grup, konu, not, sınıf</span>
          </summary>
          <div className="grid gap-4 pt-2">
            {!editing && (
              <>
                <Toggle checked={v.repeat} onChange={(r) => set({ repeat: r, repeat_until: v.repeat_until || addMonths(v.date || dateKey(), 1) })}
                  label="Her hafta tekrarla" description="Aynı gün ve saatte, seçilen tarihe kadar (en fazla 26 hafta)." />
                {v.repeat && <Field label="Tekrar bitiş tarihi"><Input type="date" value={v.repeat_until} min={v.date} onChange={(e) => set({ repeat_until: e.target.value })} /></Field>}
              </>
            )}
            <Toggle checked={v.is_group} onChange={(g) => set({ is_group: g })} label="Grup dersi" description="Birden fazla öğrenci; adlarını virgülle yazın." />
            <Field label="Ders konusu"><Input value={v.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="Ör. Döngüler" /></Field>
            <Field label="Sınıf"><Input list="dl-sinif" value={v.room} maxLength={60} onChange={(e) => set({ room: e.target.value })} placeholder="Ör. Bilgisayar Laboratuvarı" /></Field>
            <Field label="Ders notu"><Textarea rows={2} maxLength={500} value={v.note} onChange={(e) => set({ note: e.target.value })} /></Field>
            <p className="flex gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800"><ShieldAlert className="size-4 shrink-0" />Bu alan bağlantıya sahip herkes tarafından görülebilir. Telefon, veli, ödeme veya sağlık bilgisi yazmayın.</p>
          </div>
        </details>
        <button type="submit" hidden />
      </form>
      <datalist id="dl-kurs">{allCourses.map((x) => <option key={x} value={x} />)}</datalist>
      {staffCtx && (
        <>
          <StudentFormSheet open={quickStudent} quick onClose={() => setQuickStudent(false)} instructors={staffCtx.instructors} courses={allCourses}
            onSaved={(st) => { staffCtx.reload(); addStudent(st) }} />
          <InstructorFormSheet open={quickInstr} quick onClose={() => setQuickInstr(false)} courses={allCourses}
            onSaved={(ins) => { staffCtx.reload(); setIid(ins.id); setDirty(true) }} />
        </>
      )}
      <datalist id="dl-egitmen">{suggestions.instructors.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="dl-ogrenci">{suggestions.students.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="dl-sinif">{suggestions.rooms.map((x) => <option key={x} value={x} />)}</datalist>
    </Sheet>
  )
}

function blank(date?: string): SharedInput & { repeat: boolean } {
  const now = new Date()
  const next = toHM(Math.min(23 * 60, (Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) + 1) * 30))
  const isToday = !date || date === dateKey()
  const start = isToday ? next : '10:00'
  return {
    course_name: '', student_label: '', instructor_name: '', room: '', title: '', note: '', is_group: false,
    date: date ?? dateKey(), start, end: toHM(toMin(start) + 60), repeat: false, repeat_until: '',
  }
}
