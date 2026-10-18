// A file made on one page (e.g. by alteria on the guide) and checked on Analyse calls.
let pending: File | undefined

export const handOffUpload = (f: File) => void (pending = f)

export function takeHandedOffUpload(): File | undefined {
  const f = pending
  pending = undefined
  return f
}
