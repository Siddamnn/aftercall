// Notification toasts (`toast.notify`, lib/toast.ts) kept in the bell for this visit, in memory,
// under "Earlier this session". Indicator toasts never come here. Never sent anywhere.
// - Timed out on its own (you didn't see it through): flies to the bell, kept **unread**.
// - Dismissed by you: Sonner's usual fade, kept **read**.
export interface LocalNote { id: string; title: string; body: string | null; kind: 'info' | 'success' | 'error' | 'warning'; concern: 'runs' | 'team' | 'billing' | 'alerts' | 'general'; at: string; read: boolean }

let notes: LocalNote[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function rememberToast(n: Omit<LocalNote, 'id' | 'at'>) {
  notes = [{ ...n, id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString() }, ...notes].slice(0, 30)
  emit()
}
/** Marks some read, or all with no ids. */
export function markLocalRead(ids?: string[]) {
  notes = notes.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n))
  emit()
}
export const localNotes = () => notes
export const onLocalNotes = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
