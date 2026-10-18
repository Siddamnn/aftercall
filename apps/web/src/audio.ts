// Audio recordings go to the same upload endpoint as transcripts. The backend saves the file,
// answers at once, and Gemini transcribes it in the background (the call shows as "transcribing"),
// so the size limit is the host's request-body cap, not the 50 MB of text files.
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'flac']
export const MAX_AUDIO_MB = 30

export const isAudio = (name: string) => AUDIO_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '')

/** Why this file can't be uploaded, or undefined when it can. Only audio is limited here. */
export function audioProblem(file: Pick<File, 'name' | 'size'>): string | undefined {
  if (!isAudio(file.name) || file.size <= MAX_AUDIO_MB * 1024 * 1024) return undefined
  return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. Audio files can be up to ${MAX_AUDIO_MB} MB: trim or compress the recording (an mp3 or m4a is much smaller than wav) and add it again.`
}
