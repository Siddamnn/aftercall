// Files the user downloads: CSV built in the browser, PNG snapshots of a chart or page.

export type Cell = string | number | boolean | null | undefined

/** RFC 4180: quote a cell when it holds a comma, quote or newline. A BOM makes Excel read UTF-8. */
export function toCsv(rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

export function saveBlob(blob: Blob, filename: string) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000) // Safari needs the URL alive a moment after click()
}

export const saveCsv = (rows: Cell[][], filename: string) => saveBlob(new Blob([toCsv(rows)], { type: 'text/csv' }), filename)

/** A file name from a title: "Call outcome by channel" → "call-outcome-by-channel". */
export const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'aftercall'

/** A 2x PNG of a DOM node, on the card colour. Anything marked data-export-ignore is left out. */
export async function savePng(node: HTMLElement, filename: string) {
  const { toPng } = await import('html-to-image')
  const bg = getComputedStyle(node).backgroundColor
  const url = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : getComputedStyle(document.body).backgroundColor,
    filter: (el) => !(el instanceof HTMLElement && el.dataset.exportIgnore !== undefined),
  })
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
}
