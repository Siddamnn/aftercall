/** Motion presets, from the web-ui tokens: opens 250ms, closes 150ms, smooth-out curve. */
export const ease = [0.22, 1, 0.36, 1] as const
export const rise = {
  initial: { opacity: 0, y: 6, filter: 'blur(2px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.25, ease },
}
