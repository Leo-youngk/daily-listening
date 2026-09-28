/**
 * 间隔重复：ts-fsrs（FSRS-6，Anki 同款算法）+ IndexedDB 卡片。
 *
 * 卡片身份 = 词表原形或词组。同一个词不管是从六级词表学的、查词加的、还是本集清点加的，
 * 都合并成一张卡，语境（contexts）累加。
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs'
import type { Card, Grade } from 'ts-fsrs'
import { db, notifyCards } from './db'
import type { CardContext, CardRecord } from './db'
import { loadSettings } from './storage'

export { Rating, State }
export type { Grade }

/** 复习间隔达到这么多天，算"已掌握" */
export const MASTERED_DAYS = 21
/** 同一轮学习里，这么快就要再见的卡片（学习步长）留在本轮队列 */
export const LEARN_AHEAD_MS = 20 * 60 * 1000
/** 一个词最多留几条亲历语境 */
const MAX_CONTEXTS = 5

function scheduler() {
  return fsrs(generatorParameters({ request_retention: loadSettings().retention, enable_fuzz: true }))
}

export function toFsrs(r: CardRecord): Card {
  return {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
  }
}

function fromFsrs(card: Card) {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number,
    last_review: card.last_review ? card.last_review.getTime() : undefined,
  }
}

export function isMastered(r: CardRecord): boolean {
  return r.status === 'known' || (r.state === State.Review && r.scheduled_days >= MASTERED_DAYS)
}

export function startOfToday(now = Date.now()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function mergeContexts(existing: CardContext[], incoming?: CardContext): CardContext[] {
  if (!incoming) return existing
  const rest = existing.filter(c => !(c.slug === incoming.slug && c.i === incoming.i))
  return [incoming, ...rest].slice(0, MAX_CONTEXTS)
}

export interface CardInput {
  term: string
  kind: 'word' | 'phrase'
  inBook: boolean
  meaning: string
  phonetic?: string
  context?: CardContext
}

/**
 * 加入复习：已有卡片只合并语境；标熟过的词被重新加入说明其实没记住，恢复为学习中。
 * 新卡片立刻到期，下一轮学习就会出现。
 */
export async function addToReview(input: CardInput): Promise<'added' | 'merged'> {
  const now = Date.now()
  const existing = await db.cards.get(input.term)
  if (existing) {
    const reopened = existing.status === 'known'
    await db.cards.put({
      ...existing,
      ...(reopened ? { ...fromFsrs(createEmptyCard(new Date(now))), status: 'learning' as const, addedAt: now } : {}),
      meaning: input.context?.meaning || existing.meaning || input.meaning,
      phonetic: existing.phonetic || input.phonetic,
      contexts: mergeContexts(existing.contexts, input.context),
      updatedAt: now,
    })
    notifyCards()
    return reopened ? 'added' : 'merged'
  }
  await db.cards.put({
    term: input.term,
    kind: input.kind,
    inBook: input.inBook,
    status: 'learning',
    ...fromFsrs(createEmptyCard(new Date(now))),
    meaning: input.context?.meaning || input.meaning,
    phonetic: input.phonetic,
    contexts: input.context ? [input.context] : [],
    addedAt: now,
    updatedAt: now,
  })
  notifyCards()
  return 'added'
}

/** 标熟：已经认识的词不再安排复习（可在单词详情里撤销） */
export async function markKnown(input: CardInput): Promise<void> {
  const now = Date.now()
  const existing = await db.cards.get(input.term)
  await db.cards.put({
    ...(existing ?? {
      term: input.term,
      kind: input.kind,
      inBook: input.inBook,
      ...fromFsrs(createEmptyCard(new Date(now))),
      meaning: input.meaning,
      phonetic: input.phonetic,
      contexts: [],
      addedAt: now,
    }),
    status: 'known',
    updatedAt: now,
  })
  notifyCards()
}

/** 重新学：清空调度记录，立刻到期 */
export async function relearn(term: string): Promise<void> {
  const existing = await db.cards.get(term)
  if (!existing) return
  const now = Date.now()
  await db.cards.put({ ...existing, ...fromFsrs(createEmptyCard(new Date(now))), status: 'learning', updatedAt: now })
  notifyCards()
}

export async function removeCard(term: string): Promise<void> {
  await db.cards.delete(term)
  notifyCards()
}

/** 评分并写复习日志；返回更新后的卡片 */
export async function rate(term: string, grade: Grade, now = new Date()): Promise<CardRecord> {
  const record = await db.cards.get(term)
  if (!record) throw new Error(`卡片不存在：${term}`)
  const { card, log } = scheduler().next(toFsrs(record), now, grade)
  const updated: CardRecord = { ...record, ...fromFsrs(card), updatedAt: now.getTime() }
  await db.transaction('rw', db.cards, db.reviews, async () => {
    await db.cards.put(updated)
    await db.reviews.add({
      term,
      rating: grade,
      at: now.getTime(),
      state: log.state as number,
      due: log.due.getTime(),
      stability: log.stability,
      difficulty: log.difficulty,
      elapsed_days: log.elapsed_days,
      scheduled_days: log.scheduled_days,
    })
  })
  notifyCards()
  return updated
}

export function formatInterval(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}小时`
  const days = Math.round(hours / 24)
  if (days < 31) return `${days}天`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}个月`
  return `${(days / 365).toFixed(1)}年`
}

export const GRADES = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]

/** 四个评分各自的下次到期时间（毫秒）。同步计算：点评分按钮时要当场决定是否留在本轮 */
export function previewDue(record: CardRecord, now = new Date()): Record<Grade, number> {
  const preview = scheduler().repeat(toFsrs(record), now)
  const out = {} as Record<Grade, number>
  for (const grade of GRADES) out[grade] = preview[grade].card.due.getTime()
  return out
}

export async function dueCards(now = Date.now()): Promise<CardRecord[]> {
  return db.cards.where('due').belowOrEqual(now).and(c => c.status === 'learning').sortBy('due')
}

/** 今天已经开始学的六级新词数（占用每日新词额度） */
export async function introducedToday(now = Date.now()): Promise<number> {
  return db.cards.where('addedAt').aboveOrEqual(startOfToday(now))
    .and(c => c.inBook && c.status === 'learning')
    .count()
}

export async function allCards(): Promise<CardRecord[]> {
  return db.cards.toArray()
}

export interface ReviewStats {
  learning: number
  mastered: number
  known: number
  due: number
  reviewsToday: number
  /** 近 30 天复习里答对（非"忘了"）的比例 */
  retention: number | null
}

export async function reviewStats(now = Date.now()): Promise<ReviewStats> {
  const cards = await db.cards.toArray()
  const monthAgo = now - 30 * 86_400_000
  const recent = await db.reviews.where('at').aboveOrEqual(monthAgo).toArray()
  const graded = recent.filter(r => r.state === State.Review)
  return {
    learning: cards.filter(c => c.status === 'learning' && !isMastered(c)).length,
    mastered: cards.filter(c => c.status === 'learning' && isMastered(c)).length,
    known: cards.filter(c => c.status === 'known').length,
    due: cards.filter(c => c.status === 'learning' && c.due <= now).length,
    reviewsToday: recent.filter(r => r.at >= startOfToday(now)).length,
    retention: graded.length >= 20 ? graded.filter(r => r.rating !== Rating.Again).length / graded.length : null,
  }
}
