import type { ProgressMap, Settings, VocabItem } from './types'
import { DEFAULT_SETTINGS } from './types'
import { localDateKey } from './date'

const K = {
  progress: 'dtl.progress',
  favorites: 'dtl.favorites',
  vocab: 'dtl.vocab',
  stats: 'dtl.stats',
  settings: 'dtl.settings',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
    window.dispatchEvent(new CustomEvent('dtl-storage', { detail: key }))
  } catch { /* ignore */ }
}

export function loadProgress(): ProgressMap {
  return read<ProgressMap>(K.progress, {})
}
export function saveProgress(slug: string, pos: number, duration: number) {
  const all = loadProgress()
  all[slug] = { pos, duration, updatedAt: Date.now() }
  write(K.progress, all)
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

export function loadVocab(): VocabItem[] {
  return read<VocabItem[]>(K.vocab, [])
}
export function addVocab(item: Omit<VocabItem, 'addedAt' | 'mastered'>) {
  const all = loadVocab()
  if (all.some(v => v.word === item.word)) return
  all.unshift({ ...item, addedAt: Date.now(), mastered: false })
  write(K.vocab, all)
}
export function updateVocab(word: string, patch: Partial<VocabItem>) {
  const all = loadVocab().map(v => (v.word === word ? { ...v, ...patch } : v))
  write(K.vocab, all)
}
export function removeVocab(word: string) {
  write(K.vocab, loadVocab().filter(v => v.word !== word))
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
export function saveSettings(patch: Partial<Settings>) {
  write(K.settings, { ...loadSettings(), ...patch })
}
