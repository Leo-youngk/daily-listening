/**
 * 学习记录备份：卡片、复习日志（IndexedDB）+ 进度、收藏、打卡、设置（localStorage）。
 * 导出成一个 JSON 文件；导入时按主键合并（同一个词以导入文件为准），不会清空现有数据。
 */
import { db, notifyCards } from './db'
import type { CardRecord, ReviewRecord } from './db'

const LOCAL_KEYS = ['dtl.progress', 'dtl.favorites', 'dtl.stats', 'dtl.settings']
const FORMAT = 'daily-listening-backup'

interface BackupFile {
  format: typeof FORMAT
  version: 1
  exportedAt: string
  cards: CardRecord[]
  reviews: ReviewRecord[]
  local: Record<string, string>
}

export async function exportBackup(): Promise<Blob> {
  const [cards, reviews] = await Promise.all([db.cards.toArray(), db.reviews.toArray()])
  const local: Record<string, string> = {}
  for (const key of LOCAL_KEYS) {
    const value = localStorage.getItem(key)
    if (value !== null) local[key] = value
  }
  const file: BackupFile = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), cards, reviews, local }
  return new Blob([JSON.stringify(file)], { type: 'application/json' })
}

export async function importBackup(text: string): Promise<{ cards: number; reviews: number }> {
  const file = JSON.parse(text) as Partial<BackupFile>
  if (file.format !== FORMAT || !Array.isArray(file.cards) || !Array.isArray(file.reviews)) {
    throw new Error('不是本应用导出的备份文件')
  }
  const existing = new Set((await db.reviews.toArray()).map(r => `${r.term}|${r.at}`))
  const reviews = file.reviews
    .filter(r => !existing.has(`${r.term}|${r.at}`))
    .map(({ id: _id, ...rest }) => rest)
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.cards.bulkPut(file.cards!)
    await db.reviews.bulkAdd(reviews)
  })
  for (const [key, value] of Object.entries(file.local ?? {})) {
    if (LOCAL_KEYS.includes(key)) localStorage.setItem(key, value)
  }
  window.dispatchEvent(new CustomEvent('dtl-storage', { detail: 'import' }))
  notifyCards()
  return { cards: file.cards.length, reviews: reviews.length }
}
