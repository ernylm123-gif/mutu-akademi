-- =============================================================================
-- MUTU AKADEMİ – Öğrenci detayı: toplam ders saati odaklı görünüm
-- Geriye dönük uyumlu: yalnızca ws_student_stats çıktısına alan EKLENİR (first, upcoming, recent).
-- Ders hakkı/paket kayıtları silinmez; arayüz artık hak sınırı uygulamaz (zaten hiçbir ders işlemi hak kontrol etmez).
-- =============================================================================

create or replace function public.ws_student_stats(p_sid uuid, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare mon date := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/Istanbul')::date))::date;
  wk timestamptz := date_trunc('week', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
begin
  if not exists (select 1 from public.ws_students where id = p_sid) then raise exception 'Öğrenci bulunamadı.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'month_start', mon,
    'month', private.ws_student_period(p_sid, private.ist_month(mon)),
    'this_month', private.ws_student_period(p_sid, private.ist_month((now() at time zone 'Europe/Istanbul')::date)),
    'week', private.ws_student_period(p_sid, tstzrange(wk, wk + interval '7 days')),
    'total', private.ws_student_period(p_sid, tstzrange(null, null)),
    'credits', private.ws_credit(p_sid),
    'first', (select min(l.starts_at) from public.shared_lessons l
              where l.deleted_at is null and p_sid = any (l.ws_student_ids) and l.status in ('planlandi', 'tamamlandi')),
    'next', (select jsonb_build_object('id', l.id, 'starts_at', l.starts_at, 'ends_at', l.ends_at, 'course_name', l.course_name)
             from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.ws_student_ids) and l.status = 'planlandi' and l.starts_at > now()
             order by l.starts_at limit 1),
    'last', (select jsonb_build_object('id', l.id, 'starts_at', l.starts_at, 'ends_at', l.ends_at, 'course_name', l.course_name, 'attendance', private.ws_att_of(l, p_sid))
             from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.ws_student_ids) and l.status = 'tamamlandi'
             order by l.starts_at desc limit 1),
    'upcoming', coalesce((select jsonb_agg(private.shared_row(x) || jsonb_build_object('my_att', null) order by x.starts_at)
             from (select * from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.ws_student_ids)
                     and l.status = 'planlandi' and l.ends_at >= now() order by l.starts_at limit 30) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(private.shared_row(x) || jsonb_build_object('my_att', private.ws_att_of(x, p_sid)) order by x.starts_at desc)
             from (select * from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.ws_student_ids)
                     and (l.status <> 'planlandi' or l.ends_at < now()) order by l.starts_at desc limit 30) x), '[]'::jsonb),
    'by_course', coalesce((select jsonb_agg(jsonb_build_object('course', c.course_name, 'attended', c.n, 'attended_min', c.m) order by c.m desc)
             from (select l.course_name, count(*) n, sum(private.minutes(l)) m from public.shared_lessons l
                   where l.deleted_at is null and p_sid = any (l.ws_student_ids) and l.status = 'tamamlandi'
                     and private.ws_att_of(l, p_sid) in ('katildi', 'gec_geldi', 'erken_ayrildi') group by l.course_name) c), '[]'::jsonb),
    'history', (select jsonb_agg(jsonb_build_object('month', g.m) || private.ws_student_period(p_sid, private.ist_month(g.m)) order by g.m)
                from (select (mon - (i || ' months')::interval)::date m from generate_series(0, 5) i) g),
    'lessons', coalesce((select jsonb_agg(private.shared_row(l) || jsonb_build_object('my_att', private.ws_att_of(l, p_sid)) order by l.starts_at)
             from public.shared_lessons l where l.deleted_at is null and p_sid = any (l.ws_student_ids) and private.ist_month(mon) @> l.starts_at), '[]'::jsonb));
end $$;
