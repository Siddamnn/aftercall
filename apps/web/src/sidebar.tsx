// The app sidebar's width and collapsed state. Drag its right edge to resize (200 to 360 px); drag it
// narrower than 150 px, double-click the edge, or press ⌘B / Ctrl+B to collapse it to the icon rail.
// The handle is a keyboard separator too: arrows resize, Enter collapses. Remembered per browser.
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from './lib/utils'

const MIN = 200
const MAX = 360
const DEFAULT = 240
const COLLAPSE_BELOW = 150
const KEY = 'sidebar'

const read = (): { width: number; collapsed: boolean } => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v && typeof v.width === 'number') return { width: Math.min(MAX, Math.max(MIN, v.width)), collapsed: !!v.collapsed }
  } catch {
    // The defaults.
  }
  return { width: DEFAULT, collapsed: false }
}

export function useSidebar() {
  const [state, setState] = useState(read)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // This visit only.
    }
  }, [state])
  const toggle = useCallback(() => setState((s) => ({ ...s, collapsed: !s.collapsed })), [])
  const setWidth = useCallback((width: number) => setState({ width: Math.min(MAX, Math.max(MIN, width)), collapsed: false }), [])
  const collapse = useCallback(() => setState((s) => ({ ...s, collapsed: true })), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        const t = e.target as HTMLElement
        if (t.closest('input, textarea, [contenteditable="true"]')) return // ⌘B is bold in an editor
        e.preventDefault()
        toggle()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [toggle])

  return { ...state, dragging, setDragging, toggle, setWidth, collapse }
}

type Sidebar = ReturnType<typeof useSidebar>

/** The grab strip on the sidebar's right edge. Hidden on phones, and where the rail is fixed (Ask). */
export function SidebarHandle({ sidebar, locked }: { sidebar: Sidebar; locked?: boolean }) {
  const start = useRef<{ x: number; w: number } | null>(null)
  if (locked) return null
  const width = sidebar.collapsed ? 64 : sidebar.width

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, w: width }
    sidebar.setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return
    const w = start.current.w + e.clientX - start.current.x
    if (w < COLLAPSE_BELOW) sidebar.collapse()
    else sidebar.setWidth(w)
  }
  const end = () => {
    start.current = null
    sidebar.setDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  return (
    <div
      role="separator" aria-orientation="vertical" aria-label="Resize the sidebar"
      aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={sidebar.collapsed ? 64 : sidebar.width} tabIndex={0}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
      onDoubleClick={sidebar.toggle}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          if (sidebar.collapsed || sidebar.width - 16 < MIN) sidebar.collapse()
          else sidebar.setWidth(sidebar.width - 16)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          sidebar.setWidth(sidebar.collapsed ? sidebar.width : sidebar.width + 16)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          sidebar.toggle()
        }
      }}
      title="Drag to resize · double-click to collapse"
      className={cn(
        'absolute inset-y-0 -right-1.5 z-30 hidden w-3 cursor-col-resize outline-none md:block',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity after:duration-150',
        'hover:after:opacity-60 focus-visible:after:opacity-100',
        sidebar.dragging && 'after:opacity-100',
      )}
    />
  )
}
