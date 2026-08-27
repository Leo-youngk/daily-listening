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
  audioUrl: string
  zhSource: 'official' | 'mt'
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
  theme: 'auto' | 'light' | 'dark'
}

export const DEFAULT_SETTINGS: Settings = {
  rate: 1,
  fontScale: 1,
  hideZh: false,
  autoScroll: true,
  theme: 'auto',
}
