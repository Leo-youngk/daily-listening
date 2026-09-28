/**
 * localStorage 里只放小而有界的数据：收听进度、收藏、打卡、设置。
 * 背词卡片与复习日志在 IndexedDB（lib/db.ts）。
 */
import type { ProgressMap, Settings } from './types'
import { DEFAULT_SETTINGS } from './types'
import { localDateKey } from './date'

const K = {
  progress: 'dtl.progress',
  favorites: 'dtl.favorites',
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
/** 听到离结尾不足 30 秒算听完 */
export function isFinished(entry?: { pos: number; duration: number }): boolean {
  return !!entry && entry.duration > 0 && entry.pos > entry.duration - 30
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

/** 节目换代后清掉已下架节目的进度与收藏，否则"听完篇数"会把旧节目算进去 */
export function pruneEpisodes(available: Set<string>) {
  const progress = loadProgress()
  const keptProgress = Object.fromEntries(Object.entries(progress).filter(([slug]) => available.has(slug)))
  if (Object.keys(keptProgress).length !== Object.keys(progress).length) write(K.progress, keptProgress)
  const favorites = loadFavorites()
  const keptFavorites = favorites.filter(slug => available.has(slug))
  if (keptFavorites.length !== favorites.length) write(K.favorites, keptFavorites)
}

export interface Stats {
  days: string[] // 打卡日期 yyyy-mm-dd
  seconds: number
}
export function loadStats(): Stats {
  return read<Stats>(K.stats, { days: [], seconds: 0 })
}
function checkIn(stats: Stats) {
  const today = localDateKey()
  if (!stats.days.includes(today)) stats.days.push(today)
}
export function recordListen(seconds: number) {
  const s = loadStats()
  s.seconds += seconds
  checkIn(s)
  write(K.stats, s)
}
/** 背词也算打卡：复习或学新词后调用 */
export function recordStudy() {
  const s = loadStats()
  const before = s.days.length
  checkIn(s)
  if (s.days.length !== before) write(K.stats, s)
}
/** 连续打卡天数（含今天，若今天已打卡） */
export function streakDays(): number {
  const { days } = loadStats()
  const set = new Set(days)
  let streak = 0
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  let d = now.getDate()
  if (!set.has(localDateKey(now))) {
    d -= 1
  }
  while (true) {
    const key = localDateKey(new Date(y, m, d))
    if (!set.has(key)) break
    streak++
    d -= 1
  }
  return streak
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}) }
}
export function saveSettings(patch: Partial<Settings>): boolean {
  return write(K.settings, { ...loadSettings(), ...patch })
}
