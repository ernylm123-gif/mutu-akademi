// CSV dışa aktarma (Excel uyumlu: UTF-8 BOM + noktalı virgül ayırıcı)
type Cell = string | number | null | undefined

export function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    let s = v === null || v === undefined ? '' : String(v)
    // CSV formül enjeksiyonunu önle
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = `'${s}`
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')
}

export function downloadFile(name: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(name: string, headers: string[], rows: Cell[][]) {
  downloadFile(name.endsWith('.csv') ? name : `${name}.csv`, '﻿' + toCsv(headers, rows), 'text/csv;charset=utf-8')
}

/** Telefonda paylaşım menüsü (WhatsApp, Dosyalar, AirDrop…), desteklenmiyorsa indirme */
export async function saveOrShare(blob: Blob, name: string) {
  const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  if (isTouch && typeof navigator !== 'undefined' && 'canShare' in navigator) {
    const file = new File([blob], name, { type: blob.type })
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
  }
  downloadFile(name, blob, blob.type)
}
