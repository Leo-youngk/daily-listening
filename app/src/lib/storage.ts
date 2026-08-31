import type { ProgressMap, Settings, VocabItem } from './types'
import { DEFAULT_SETTINGS } from './types'
import { localDateKey } from './date'
import { senseId } from './lookup'

const K = {
  progress: 'dtl.progress',
  favorites: 'dtl.favorites',
  vocab: 'dtl.vocab',
  stats: 'dtl.stats',
  settings: 'dtl.settings',
}

export const STORAGE_ERROR_EVENT = 'dtl-storage-error'

function reportStorageError(key: string, error: unknown) {
  const quota = error instanceof DOMException
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  const message = quota
    ? '本地存储已满，数据没有保存成功'
    : '本地存储不可用（可能处于无痕模式），数据没有保存成功'
  console.error('localStorage write failed', { key, error })
  window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: message }))
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, val: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(val))
    window.dispatchEvent(new CustomEvent('dtl-storage', { detail: key }))
    return true
  } catch (error) {
    reportStorageError(key, error)
    return false
  }
}

export function loadProgress(): ProgressMap {
  return read<ProgressMap>(K.progress, {})
}
export function saveProgress(slug: string, pos: number, duration: number): boolean {
  const all = loadProgress()
  all[slug] = { pos, duration, updatedAt: Date.now() }
  return write(K.progress, all)
}

export function loadFavorites(): string[] {
  return read<string[]>(K.favorites, [])
}
export function toggleFavorite(slug: string): boolean {
  const fav = loadFavorites()
  const idx = fav.indexOf(slug)
  if (idx >= 0) fav.splice(idx, 1)
  else fav.unshift(slug)
  write(K.favorites, fav)
  return idx < 0
}
export function isFavorite(slug: string) {
  return loadFavorites().includes(slug)
}

/** 旧版按 word 存的生词补齐新字段，避免升级后丢失用户已收藏的词 */
function normalizeVocab(raw: Partial<VocabItem> & { meaning?: string; source?: string }): VocabItem | null {
  const term = raw.term ?? raw.word
  if (!term) return null
  const contextMeaning = raw.contextMeaning ?? raw.meaning ?? ''
  const lemma = raw.lemma ?? term
  return {
    id: raw.id ?? senseId(term, lemma, contextMeaning),
    term,
    word: raw.word ?? term,
    lemma,
    phonetic: raw.phonetic,
    partOfSpeech: raw.partOfSpeech,
    contextMeaning,
    explanation: raw.explanation,
    otherMeanings: raw.otherMeanings ?? [],
    sentenceEn: raw.sentenceEn ?? raw.source ?? '',
    sentenceZh: raw.sentenceZh,
    slug: raw.slug,
    sentenceIdx: raw.sentenceIdx,
    startTime: raw.startTime,
    addedAt: raw.addedAt ?? Date.now(),
    mastered: raw.mastered ?? false,
  }
}

export function loadVocab(): VocabItem[] {
  return read<VocabItem[]>(K.vocab, [])
    .map(normalizeVocab)
    .filter((v): v is VocabItem => v !== null)
}

export type AddVocabResult = 'added' | 'exists' | 'failed'

export function addVocab(item: Omit<VocabItem, 'id' | 'addedAt' | 'mastered'>): AddVocabResult {
  const all = loadVocab()
  const id = senseId(item.term, item.lemma, item.contextMeaning)
  if (all.some(v => v.id === id)) return 'exists'
  all.unshift({ ...item, id, addedAt: Date.now(), mastered: false })
  return write(K.vocab, all) ? 'added' : 'failed'
}

export function updateVocab(id: string, patch: Partial<VocabItem>): boolean {
  return write(K.vocab, loadVocab().map(v => (v.id === id ? { ...v, ...patch } : v)))
}

export function removeVocab(id: string): boolean {
  return write(K.vocab, loadVocab().filter(v => v.id !== id))
}

export interface Stats {
  days: string[] // 打卡日期 yyyy-mm-dd
  seconds: number
}
export function loadStats(): Stats {
  return read<Stats>(K.stats, { days: [], seconds: 0 })
}
export function recordListen(seconds: number) {
  const s = loadStats()
  s.seconds += seconds
  const today = localDateKey()
  if (!s.days.includes(today)) s.days.push(today)
  write(K.stats, s)
}
/** 连续打卡天数（含今天，若今天已打卡） */
export function streakDays(): number {
  const { days } = loadStats()
  const set = new Set(days)
  let streak = 0
  const d = new Date()
  // 今天没打卡则从昨天算起
  if (!set.has(localDateKey(d))) d.setDate(d.getDate() - 1)
  while (set.has(localDateKey(d))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}) }
}
export function saveSettings(patch: Partial<Settings>): boolean {
  return write(K.settings, { ...loadSettings(), ...patch })
}
