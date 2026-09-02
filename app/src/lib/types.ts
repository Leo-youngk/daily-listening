export interface ManifestItem {
  slug: string
  title: string
  speaker: string
  category: 'ted' | 'commencement' | 'voa' | 'bbc'
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
  /** 词级时间轴，下标与 tokenizeSentence(en) 一一对应，扁平存 [start,end,start,end,...] */
  w?: number[]
}

export interface TalkData extends ManifestItem {
  sentences: Sentence[]
  /** 词级时间轴来源：yt = YouTube ASR 自带，asr = 本地强制对齐 */
  wSource?: 'yt' | 'asr'
}

export interface VocabItem {
  /** 义项身份：同一个词的不同含义可以同时存在 */
  id: string
  /** 本句识别出的词条，可能是词组，如 "play out" */
  term: string
  /** 点击时的实际词形，如 "played" */
  word: string
  lemma: string
  phonetic?: string
  partOfSpeech?: string
  contextMeaning: string
  explanation?: string
  otherMeanings?: { partOfSpeech: string; zh: string }[]
  sentenceEn: string
  sentenceZh?: string
  slug?: string
  sentenceIdx?: number
  startTime?: number
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
  /** 字幕偏移秒数，正数 = 字幕延后。补偿蓝牙耳机的输出延迟（audio.currentTime 是解码位置，不是出声位置） */
  subtitleOffset: number
}

export type AudioQuality = 'standard' | 'high'

export const DEFAULT_SETTINGS: Settings = {
  rate: 1,
  fontScale: 1,
  hideZh: false,
  autoScroll: true,
  audioQuality: 'standard',
  theme: 'auto',
  subtitleOffset: 0,
}
