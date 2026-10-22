// PDF dışa aktarma – pdfmake (Roboto fontu Türkçe karakterleri destekler). Yalnızca ihtiyaç olduğunda yüklenir.
import { saveOrShare } from '@/lib/csv'

export interface PdfTable { title?: string; headers: string[]; rows: (string | number)[][]; widths?: (string | number)[] }

interface PdfDoc { download: (n: string) => void; getBlob: (cb?: (b: Blob) => void) => Promise<Blob> | void }
interface PdfMakeLike {
  vfs?: Record<string, string>
  addVirtualFileSystem?: (v: unknown) => void
  createPdf: (d: unknown) => PdfDoc
}

async function loadPdfMake(): Promise<PdfMakeLike> {
  const [pdfModule, fontsModule] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
  const pm = ((pdfModule as { default?: unknown }).default ?? pdfModule) as PdfMakeLike
  const fonts = ((fontsModule as { default?: unknown }).default ?? fontsModule) as Record<string, unknown>
  const vfs = ((fonts.pdfMake as { vfs?: unknown } | undefined)?.vfs ?? fonts.vfs ?? fonts) as Record<string, string>
  if (pm.addVirtualFileSystem) pm.addVirtualFileSystem(vfs)
  else pm.vfs = vfs
  return pm
}

/** Mutu Akademi logosu (PDF başlığı için data URL); alınamazsa logo olmadan devam edilir */
async function logoDataUrl(): Promise<string | null> {
  try {
    const blob = await (await fetch('/logo.png')).blob()
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsDataURL(blob) })
  } catch { return null }
}

function blobOf(doc: PdfDoc): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const p = doc.getBlob((b) => resolve(b))
      if (p && typeof (p as Promise<Blob>).then === 'function') (p as Promise<Blob>).then(resolve, reject)
    } catch (e) { reject(e) }
  })
}

export async function downloadPdf(fileName: string, title: string, subtitle: string, tables: PdfTable[], opts: { landscape?: boolean } = {}) {
  const [pm, logo] = await Promise.all([loadPdfMake(), logoDataUrl()])
  const header = {
    columns: [
      ...(logo ? [{ image: logo, width: 36 }] : []),
      { stack: [{ text: 'MUTU AKADEMİ', style: 'brand' }, { text: title, style: 'title' }, { text: subtitle, style: 'sub' }], margin: [logo ? 10 : 0, 0, 0, 0] },
    ],
    margin: [0, 0, 0, 10],
  }
  const content: unknown[] = [header]
  for (const t of tables) {
    if (t.title) content.push({ text: t.title, style: 'section' })
    content.push({
      table: {
        headerRows: 1,
        widths: t.widths ?? t.headers.map(() => '*'),
        body: [t.headers.map((h) => ({ text: h, style: 'th' })), ...t.rows.map((r) => r.map((c) => String(c)))],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    })
  }
  const doc = pm.createPdf({
    pageSize: 'A4',
    pageOrientation: opts.landscape ? 'landscape' : 'portrait',
    pageMargins: [28, 30, 28, 34],
    info: { title: `Mutu Akademi – ${title}` },
    content,
    defaultStyle: { fontSize: 8.5 },
    styles: {
      brand: { fontSize: 9, bold: true, color: '#2563eb', characterSpacing: 2 },
      title: { fontSize: 15, bold: true, margin: [0, 2, 0, 1] },
      sub: { fontSize: 8.5, color: '#64748b' },
      section: { fontSize: 10.5, bold: true, margin: [0, 6, 0, 2] },
      th: { bold: true, color: '#172033', fillColor: '#f1f5f9' },
    },
    footer: (page: number, count: number) => ({
      text: `Mutu Akademi · ${page} / ${count}`, alignment: 'right', margin: [0, 8, 28, 0], fontSize: 7.5, color: '#94a3b8',
    }),
  })
  const name = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`
  try {
    await saveOrShare(await blobOf(doc), name)
  } catch {
    doc.download(name)
  }
}
