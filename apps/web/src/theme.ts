import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const media = matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function read(): Theme {
  try {
    const t = localStorage.getItem('theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

let current = read()

function apply() {
  const root = document.documentElement
  // Colours swap in one frame: without this, every element with a colour transition fades on its own clock.
  root.classList.add('theme-switching')
  root.classList.toggle('dark', current === 'dark' || (current === 'system' && media.matches))
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')))
}

media.addEventListener('change', () => current === 'system' && apply())

export function setTheme(t: Theme) {
  current = t
  try {
    if (t === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', t)
  } catch {
    // Private mode: the choice lasts until reload.
  }
  apply()
  listeners.forEach((l) => l())
}

export function useTheme() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  )
}
