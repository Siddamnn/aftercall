// The open project (B37). Every API request is scoped to it, so it's set on the API before
// the first request. Kept in localStorage; switching remounts the page so everything reloads.
import { useSyncExternalStore } from 'react'
import { setProject } from './api'

const KEY = 'project'
const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

let current = read()
/** The project remembered from last time; it may have been deleted since. */
export const remembered = current
/** Bumped when projects are created, renamed or deleted, so lists reload. */
let version = 0
setProject(current)

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function switchProject(id: string) {
  if (id === current) return
  current = id
  setProject(id)
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Not remembered next time; fine.
  }
  emit()
}

export function projectsChanged() {
  version++
  emit()
}

/** The open project's id; null until one is picked (the backend then uses the default one). */
export const useProjectId = () => useSyncExternalStore(subscribe, () => current)
export const useProjectsVersion = () => useSyncExternalStore(subscribe, () => version)
