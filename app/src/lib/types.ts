export type Series = 'bbc' | 'curious' | 'thinking'

export interface SeriesInfo {
  key: Series
  name: string
  /** 分段控件上的短名 */
  tab: string
  /** 列表、封面缺图时的短标签 */
  short: string
  desc: string
}

/** 节目顺序即难度梯度：BBC 短、对话、语速接近六级听力；两档长线是单人讲解、慢一档 */
export const SERIES: SeriesInfo[] = [
  { key: 'bbc', name: 'BBC 6 Minute English', tab: '6 Minute', short: 'BBC', desc: 'BBC · 双人对话 · 每期 6 分钟' },
  { key: 'curious', name: 'Curious Minds', tab: 'Curious Minds', short: 'CM', desc: '历史科学人物故事 · 约 22 分钟' },
  { key: 'thinking', name: 'Thinking in English', tab: 'Thinking', short: 'TiE', desc: '时事社会文化 · 约 25 分钟' },
]

export const seriesInfo = (key: Series): SeriesInfo => SERIES.find(s => s.key === key) ?? SERIES[0]

export interface ManifestItem {
  slug: string
  title: string
  speaker: string
  category: Series
  /** 发布日期 YYYY-MM-DD */
  date: string
  duration: number
  cover: string
  audioUrls: Record<AudioQuality, string>
  /** 中文一律是机器翻译（Gemini，少数几期由 Claude 补翻，每期用的模型记在数据的 zhModel 字段），界面需如实标注 */
  zhSource: 'mt'
  /** 本集出现的六级词（去重）数 */
  cet6: number
  /** 本集超纲词（去重）数：不在中高考/四六级词表且词频 5000 名以后 */
  hard: number
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

/** 节目官方给出的重点词（BBC Vocabulary / Thinking in English Vocabulary） */
export interface Keyword {
  term: string
  def: string
}

export interface TalkData extends ManifestItem {
  sentences: Sentence[]
  wSource?: 'asr'
  sourceUrl?: string
  keywords: Keyword[]
  /** 本集出现的六级词：小写表面形式 -> 词表原形 */
  lemmas: Record<string, string>
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
  /** 每天新学的六级词个数 */
  dailyNew: number
  /** FSRS 目标记忆率：越高复习越频繁 */
  retention: number
  /** 字幕里标出六级词（在学/未学） */
  markWords: boolean
  /** 播放页停在"播放"（封面 + 大按钮）还是"文稿"（双语字幕） */
  playerView: 'play' | 'text'
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
  dailyNew: 15,
  retention: 0.9,
  markWords: true,
  playerView: 'play',
}
