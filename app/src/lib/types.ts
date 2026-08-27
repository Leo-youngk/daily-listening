export interface ManifestItem {
  slug: string
  title: string
  speaker: string
  category: 'ted' | 'commencement'
  school?: string | null
  year?: number | null
  duration: number
  cover: string
  views?: number | null
  audioUrls: Record<AudioQuality, string>
  zhSource: 'official' | 'mt' | 'mixed'
}

export interface Sentence {
  i: number
  start: number
  end: number
  en: string
  zh: string
}

export interface TalkData extends ManifestItem {
  sentences: Sentence[]
}

export interface VocabItem {
  word: string
  phonetic?: string
  meaning?: string
  source?: string
  slug?: string
  addedAt: number
  mastered: boolean
}

export interface ProgressMap {
  [slug: string]: { pos: number; duration: number; updatedAt: number }
}

export interface Settings {
  rate: number
  fontScale: number
  hideZh: boolean
  autoScroll: boolean
  audioQuality: AudioQuality
  theme: 'auto' | 'light' | 'dark'
}

export type AudioQuality = 'standard' | 'high'

export const DEFAULT_SETTINGS: Settings = {
  rate: 1,
  fontScale: 1,
  hideZh: false,
  autoScroll: true,
  audioQuality: 'standard',
  theme: 'auto',
}
