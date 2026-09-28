/**
 * 一次性导入旧版生词本（localStorage 的 dtl.vocab）到 IndexedDB 卡片，导完删掉旧 key。
 * 旧生词的出处多是已下架的 TED/毕业演讲，原句保留为纯文字语境（没有原声、不能跳回）。
 */
import { createEmptyCard } from 'ts-fsrs'
import { db, notifyCards } from './db'
import type { CardRecord } from './db'
import { normalizeTerm } from './lookup'
import { loadWordbookMap } from './wordbook'

const LEGACY_KEYS = ['dtl.vocab', 'dtl.homeRotation']

interface LegacyVocab {
  term?: string
  word?: string
  lemma?: string
  phonetic?: string
  contextMeaning?: string
  meaning?: string
  sentenceEn?: string
  sentenceZh?: string
  addedAt?: number
  mastered?: boolean
}

export async function importLegacyVocab(): Promise<number> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem('dtl.vocab')
  } catch {
    return 0
  }
  if (!raw) {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
    return 0
  }
  const items = JSON.parse(raw) as LegacyVocab[]
  const book = await loadWordbookMap()
  let imported = 0
  for (const item of items) {
    const surface = normalizeTerm(item.term ?? item.word ?? '')
    if (!surface) continue
    const lemma = normalizeTerm(item.lemma ?? surface)
    const term = surface.includes(' ') ? surface : (book.has(lemma) ? lemma : surface)
    if (await db.cards.get(term)) continue
    const now = Date.now()
    const empty = createEmptyCard(new Date(now))
    const record: CardRecord = {
      term,
      kind: term.includes(' ') ? 'phrase' : 'word',
      inBook: book.has(term),
      status: item.mastered ? 'known' : 'learning',
      due: empty.due.getTime(),
      stability: empty.stability,
      difficulty: empty.difficulty,
      elapsed_days: empty.elapsed_days,
      scheduled_days: empty.scheduled_days,
      learning_steps: empty.learning_steps,
      reps: empty.reps,
      lapses: empty.lapses,
      state: empty.state,
      meaning: item.contextMeaning || item.meaning || book.get(term)?.zh || '',
      phonetic: item.phonetic || book.get(term)?.ph,
      contexts: item.sentenceEn
        ? [{ slug: '', i: -1, en: item.sentenceEn, zh: item.sentenceZh, start: 0, end: 0, meaning: item.contextMeaning }]
        : [],
      addedAt: item.addedAt ?? now,
      updatedAt: now,
    }
    await db.cards.put(record)
    imported++
  }
  for (const key of LEGACY_KEYS) localStorage.removeItem(key)
  if (imported) notifyCards()
  return imported
}
