// PDF dışa aktarma – pdfmake (Roboto fontu Türkçe karakterleri destekler). Yalnızca ihtiyaç olduğunda yüklenir.
export interface PdfTable { title?: string; headers: string[]; rows: (string | number)[][] }

interface PdfMakeLike {
  vfs?: Record<string, string>
  addVirtualFileSystem?: (v: unknown) => void
  createPdf: (d: unknown) => { download: (n: string) => void }
}

export async function downloadPdf(fileName: string, title: string, subtitle: string, tables: PdfTable[]) {
  const [pdfModule, fontsModule] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  const pm = ((pdfModule as { default?: unknown }).default ?? pdfModule) as PdfMakeLike
  const fonts = ((fontsModule as { default?: unknown }).default ?? fontsModule) as Record<string, unknown>
  const vfs = ((fonts.pdfMake as { vfs?: unknown } | undefined)?.vfs ?? fonts.vfs ?? fonts) as Record<string, string>
  if (pm.addVirtualFileSystem) pm.addVirtualFileSystem(vfs)
  else pm.vfs = vfs

  const content: unknown[] = [
    { text: 'MUTU AKADEMİ', style: 'brand' },
    { text: title, style: 'title' },
    { text: subtitle, style: 'sub' },
  ]
  for (const t of tables) {
    if (t.title) content.push({ text: t.title, style: 'section' })
    content.push({
      table: {
        headerRows: 1,
        widths: t.headers.map(() => '*'),
        body: [t.headers.map((h) => ({ text: h, style: 'th' })), ...t.rows.map((r) => r.map((c) => String(c)))],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 4, 0, 12],
    })
  }
  pm.createPdf({
    pageSize: 'A4',
    pageMargins: [32, 36, 32, 36],
    content,
    defaultStyle: { fontSize: 9 },
    styles: {
      brand: { fontSize: 10, bold: true, color: '#1689bf', characterSpacing: 2 },
      title: { fontSize: 16, bold: true, margin: [0, 4, 0, 2] },
      sub: { fontSize: 9, color: '#64748b', margin: [0, 0, 0, 12] },
      section: { fontSize: 11, bold: true, margin: [0, 6, 0, 2] },
      th: { bold: true, color: '#0f1115' },
    },
    footer: (page: number, count: number) => ({
      text: `${page} / ${count}`, alignment: 'right', margin: [0, 8, 32, 0], fontSize: 8, color: '#94a3b8',
    }),
  }).download(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`)
}
