import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Play, CheckCheck, CalendarClock, Ban, Undo2, Pencil, Trash2, Users, User, GraduationCap, DoorOpen, History, RotateCcw } from 'lucide-react'
import { dateKey, formatDayLong, formatDayShort, fromIstanbul, relativeTime, timeHM } from '@/lib/time'
import { ATTENDANCE_ORDER, ATTENDANCE_STATUS, POSTPONE_REASON, displayStatus, TONE_COLOR } from '@/lib/format'
import { errorMessage } from '@/lib/errors'
import { shared, ACTION_TEXT, type SharedAttendance, type SharedDetail, type SharedLesson } from '@/lib/sharedApi'
import { Badge, Button, Field, Input, Select, Sheet, Textarea } from '@/components/ui'
import { useToast } from '@/components/ui/Toast'

type Mode = 'view' | 'complete' | 'postpone' | 'cancel' | 'delete'

export const sharedStatus = (l: SharedLesson) =>
  displayStatus({ status: l.status, starts_at: l.starts_at, ends_at: l.ends_at, started_at: l.started_at, attendance: l.attendance ? { status: l.attendance } : null })

/** Ortak ders detayı ve işlemleri. Her işlem sunucuda doğrulanır; başarısızsa gerçek nedeni gösterilir. */
export function SharedLessonSheet({ lesson, onClose, onEdit, onChanged, onDeleted, onOpen }: {
  lesson: SharedLesson | null
  onClose: () => void
  onEdit: (l: SharedLesson) => void
  onChanged: () => void
  onDeleted: (l: SharedLesson) => void
  onOpen: (id: string) => void
}) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('view')
  const [detail, setDetail] = useState<SharedDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [att, setAtt] = useState<SharedAttendance>('katildi')
  const [date, setDate] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('ogrenci')
  const [text, setText] = useState('')

  useEffect(() => {
    if (!lesson) return
    setMode('view'); setError(null); setText(''); setReason('ogrenci')
    setAtt(lesson.attendance ?? 'katildi')
    setDate(dateKey(lesson.starts_at)); setStart(timeHM(lesson.starts_at)); setEnd(timeHM(lesson.ends_at))
  }, [lesson?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lesson) { setDetail(null); return }
    let alive = true
    shared.get(lesson.id).then((d) => alive && setDetail(d)).catch(() => undefined)
    return () => { alive = false }
  }, [lesson?.id, lesson?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!lesson) return null
  const l = lesson
  const st = sharedStatus(l)
  const notYet = new Date(l.starts_at).getTime() > Date.now() + 3600_000
  const run = async (fn: () => Promise<unknown>, ok: string, close = true) => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await fn()
      toast.success(ok)
      onChanged()
      if (close) onClose(); else setMode('view')
    } catch (e) {
      setError(errorMessage(e))
      onChanged() // sürüm çakışmasında güncel hali yükle
    } finally {
      setBusy(false)
    }
  }
  const timeBad = !/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end) || end <= start
  const back = <Button variant="secondary" block onClick={() => { setMode('view'); setError(null) }}>Geri</Button>
  const titles: Record<Mode, string> = { view: 'Ders', complete: 'Tamamla ve yoklama al', postpone: 'Dersi ertele', cancel: 'Dersi iptal et', delete: 'Dersi sil' }

  return (
    <Sheet open onClose={onClose} title={titles[mode]} dirty={mode !== 'view' && mode !== 'delete' && !!text}>
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">İşlem yapılamadı: {error}</p>}

      {mode === 'view' && (
        <div className="space-y-4">
          <div className="rounded-2xl p-4 text-white" style={{ background: `linear-gradient(135deg, ${TONE_COLOR[st.tone]}, #1e293b)` }}>
            <p className="text-sm opacity-90">{formatDayLong(dateKey(l.starts_at))}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{timeHM(l.starts_at)} – {timeHM(l.ends_at)}</p>
            <p className="mt-2 text-lg font-semibold">{l.course_name}{l.title ? ` · ${l.title}` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            {l.attendance && l.status === 'tamamlandi' && <Badge tone={ATTENDANCE_STATUS[l.attendance].tone}>Yoklama: {ATTENDANCE_STATUS[l.attendance].label}</Badge>}
            {l.series_id && <Badge tone="brand">Haftalık tekrar</Badge>}
          </div>
          <div className="grid gap-2 text-sm">
            {l.student_label && <p className="flex items-center gap-2">{l.is_group ? <Users className="size-4 text-slate-400" /> : <User className="size-4 text-slate-400" />}{l.student_label}</p>}
            {l.instructor_name && <p className="flex items-center gap-2"><GraduationCap className="size-4 text-slate-400" />{l.instructor_name}</p>}
            {l.room && <p className="flex items-center gap-2"><DoorOpen className="size-4 text-slate-400" />{l.room}</p>}
            {l.note && <p className="rounded-xl bg-slate-50 px-3 py-2 text-slate-600">{l.note}</p>}
            {l.status_reason && <p className="rounded-xl bg-slate-50 px-3 py-2 text-slate-600">{l.status === 'ertelendi' ? 'Erteleme nedeni' : 'İptal nedeni'}: {l.status_reason}</p>}
            {detail?.moved_to && <button onClick={() => onOpen(detail.moved_to!.id)} className="min-h-11 text-left font-semibold text-brand-600">Yeni tarih: {formatDayLong(dateKey(detail.moved_to.starts_at))} {timeHM(detail.moved_to.starts_at)} →</button>}
            {l.rescheduled_from && <button onClick={() => onOpen(l.rescheduled_from!)} className="min-h-11 text-left font-semibold text-brand-600">← Ertelenen eski ders kaydı</button>}
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
            {l.status === 'planlandi' && !l.started_at && (
              <Button size="lg" className="bg-cyan-600 hover:bg-cyan-700" icon={<Play className="size-4" />} disabled={notYet} loading={busy}
                onClick={() => void run(() => shared.start(l), 'Ders başladı (devam ediyor)', false)}>Dersi başlat</Button>
            )}
            {l.status === 'planlandi' && (
              <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700" icon={<CheckCheck className="size-4" />} disabled={notYet} onClick={() => setMode('complete')}>Tamamlandı</Button>
            )}
            {l.status === 'tamamlandi' && (
              <>
                <Button size="lg" variant="secondary" icon={<CheckCheck className="size-4" />} onClick={() => setMode('complete')}>Yoklamayı değiştir</Button>
                <Button size="lg" variant="ghost" icon={<RotateCcw className="size-4" />} loading={busy} onClick={() => void run(() => shared.reopen(l), 'Tamamlama geri alındı', false)}>Tamamlamayı geri al</Button>
              </>
            )}
            {l.status === 'planlandi' && (
              <>
                <Button size="lg" variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setMode('postpone')}>Ertele</Button>
                <Button size="lg" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => onEdit(l)}>Düzenle</Button>
                <Button size="lg" variant="secondary" className="text-red-600" icon={<Ban className="size-4" />} onClick={() => setMode('cancel')}>İptal et</Button>
              </>
            )}
            {l.status === 'iptal' && (
              <Button size="lg" variant="secondary" icon={<Undo2 className="size-4" />} loading={busy} onClick={() => void run(() => shared.restore(l), 'İptal geri alındı', false)}>İptali geri al</Button>
            )}
            <Button size="lg" variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={() => setMode('delete')}>Sil</Button>
          </div>
          {notYet && l.status === 'planlandi' && <p className="text-xs text-slate-400">Başlatma ve tamamlama, derse 1 saatten az kalınca açılır.</p>}

          {(detail?.history.length ?? 0) > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-500"><History className="size-4" />İşlem geçmişi</p>
              <ul className="space-y-1 text-sm">
                {detail!.history.map((h, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{ACTION_TEXT[h.action] ?? h.action}{h.detail?.old_starts_at && h.detail?.starts_at ? `: ${formatDayShort(dateKey(h.detail.old_starts_at))} ${timeHM(h.detail.old_starts_at)} → ${formatDayShort(dateKey(h.detail.starts_at))} ${timeHM(h.detail.starts_at)}` : ''}{h.detail?.attendance ? ` (${ATTENDANCE_STATUS[h.detail.attendance as SharedAttendance]?.label ?? ''})` : ''}{h.detail?.reason ? ` – ${h.detail.reason}` : ''}</span>
                    <span className="shrink-0 text-xs text-slate-400">{relativeTime(h.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {mode === 'complete' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Ders saati dolsa bile otomatik tamamlanmaz. Yoklama sonucunu seçip onaylayın; aynı işlem iki kez kaydedilmez.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ATTENDANCE_ORDER.map((s) => (
              <button key={s} type="button" aria-pressed={att === s} onClick={() => setAtt(s)}
                className={clsx('h-12 rounded-xl text-sm font-semibold', att === s ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700')}>
                {s === 'katilmadi' ? 'Öğrenci gelmedi' : ATTENDANCE_STATUS[s].label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">{back}<Button block loading={busy} onClick={() => void run(() => shared.complete(l, att), 'Ders tamamlandı olarak kaydedildi')}>Kaydet</Button></div>
        </div>
      )}

      {mode === 'postpone' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Eski ders "Ertelendi" olarak geçmişte kalır, yeni tarih programa eklenir. Eski hatırlatmalar iptal edilir.</p>
          <Field label="Erteleme nedeni">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(POSTPONE_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Yeni tarih"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Yeni başlangıç"><Input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Yeni bitiş"><Input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <Field label="Açıklama"><Textarea rows={2} maxLength={250} value={text} onChange={(e) => setText(e.target.value)} placeholder="İsteğe bağlı (kişisel bilgi yazmayın)" /></Field>
          {timeBad && <p className="text-sm text-red-600">Bitiş saati başlangıçtan sonra olmalı.</p>}
          {!timeBad && fromIstanbul(date, start).getTime() < Date.now() && <p className="text-sm text-amber-700">Uyarı: yeni tarih geçmişte.</p>}
          <div className="flex gap-2">{back}<Button block disabled={timeBad} loading={busy} onClick={() => void run(() => shared.postpone(l, date, start, end, reason, text), 'Ders ertelendi; yeni tarih programa eklendi')}>Ertele</Button></div>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">İptal edilen ders programda "İptal edildi" olarak kalır ve hatırlatma gönderilmez. Yanlışlıkla iptal edilirse geri alınabilir.</p>
          <Field label="İptal nedeni"><Textarea rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <div className="flex gap-2">{back}<Button variant="danger" block loading={busy} onClick={() => void run(() => shared.cancel(l, text), 'Ders iptal edildi')}>İptal et</Button></div>
        </div>
      )}

      {mode === 'delete' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600"><b>{l.course_name}</b> – {formatDayLong(dateKey(l.starts_at))} {timeHM(l.starts_at)} programdan kaldırılsın mı?</p>
          <p className="text-sm text-slate-500">Silinen ders işlem geçmişinde kalır ve hemen ardından "Geri al" ile geri getirilebilir. Ders yapılmayacaksa "İptal et" daha uygundur.</p>
          <div className="flex gap-2">{back}<Button variant="danger" block loading={busy} onClick={() => void (async () => {
            if (busy) return
            setBusy(true); setError(null)
            try { await shared.remove(l); onDeleted(l); onChanged(); onClose() } catch (e) { setError(errorMessage(e)); onChanged() } finally { setBusy(false) }
          })()}>Sil</Button></div>
        </div>
      )}
    </Sheet>
  )
}
