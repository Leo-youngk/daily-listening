import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../src/lib/db'
import {
  addToReview, dueCards, introducedToday, isMastered, LEARN_AHEAD_MS, markKnown, previewDue, rate, Rating,
} from '../src/lib/srs'
import { exportBackup, importBackup } from '../src/lib/backup'

const context = (i: number) => ({ slug: 'bbc6min_260924', i, en: `Sentence ${i} about an itch.`, start: i * 5, end: i * 5 + 4, w: 3 })
const WORD = { term: 'itch', kind: 'word' as const, inBook: true, meaning: 'n. 痒', phonetic: 'itʃ' }

beforeEach(async () => {
  localStorage.clear()
  await db.cards.clear()
  await db.reviews.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('加入复习', () => {
  it('新卡立刻到期；同一个词再加只合并语境', async () => {
    expect(await addToReview({ ...WORD, context: context(1) })).toBe('added')
    expect(await addToReview({ ...WORD, context: context(2) })).toBe('merged')
    expect(await addToReview({ ...WORD, context: context(1) })).toBe('merged')
    const card = (await db.cards.get('itch'))!
    expect(card.status).toBe('learning')
    expect(card.contexts.map(c => c.i)).toEqual([1, 2])
    expect((await dueCards()).map(c => c.term)).toEqual(['itch'])
  })

  it('标熟后不再到期；又被加入复习说明没记住，恢复为学习中', async () => {
    await markKnown(WORD)
    expect((await db.cards.get('itch'))!.status).toBe('known')
    expect(await dueCards()).toHaveLength(0)
    expect(await addToReview({ ...WORD, context: context(3) })).toBe('added')
    expect((await db.cards.get('itch'))!.status).toBe('learning')
  })

  it('今日新词额度只算今天开始学的六级词', async () => {
    await addToReview(WORD)
    await addToReview({ ...WORD, term: 'play out', kind: 'phrase', inBook: false })
    await markKnown({ ...WORD, term: 'scratch' })
    expect(await introducedToday()).toBe(1)
  })
})

describe('FSRS 调度', () => {
  it('四个评分的下次到期时间单调递增', async () => {
    await addToReview(WORD)
    const due = previewDue((await db.cards.get('itch'))!)
    expect(due[Rating.Again]).toBeLessThanOrEqual(due[Rating.Hard])
    expect(due[Rating.Hard]).toBeLessThanOrEqual(due[Rating.Good])
    expect(due[Rating.Good]).toBeLessThan(due[Rating.Easy])
  })

  it('新卡答"记得"进入学习步长，留在本轮；答"简单"排到几天后', async () => {
    await addToReview(WORD)
    const now = new Date()
    const good = await rate('itch', Rating.Good, now)
    expect(good.due - now.getTime()).toBeLessThan(LEARN_AHEAD_MS)
    await addToReview({ ...WORD, term: 'scratch' })
    const easy = await rate('scratch', Rating.Easy, now)
    expect(easy.due - now.getTime()).toBeGreaterThan(86_400_000)
    expect(await db.reviews.count()).toBe(2)
  })

  it('间隔达到 21 天算已掌握；标熟也算', async () => {
    await addToReview(WORD)
    const card = (await db.cards.get('itch'))!
    expect(isMastered(card)).toBe(false)
    expect(isMastered({ ...card, state: 2, scheduled_days: 30 })).toBe(true)
    expect(isMastered({ ...card, status: 'known' })).toBe(true)
  })
})

describe('学习记录备份', () => {
  it('导出再导入不丢卡片和复习日志，也不重复记日志', async () => {
    await addToReview({ ...WORD, context: context(1) })
    await rate('itch', Rating.Good)
    localStorage.setItem('dtl.settings', JSON.stringify({ dailyNew: 20 }))
    const text = await (await exportBackup()).text()

    await db.cards.clear()
    await db.reviews.clear()
    localStorage.clear()
    const first = await importBackup(text)
    expect(first).toEqual({ cards: 1, reviews: 1 })
    expect((await db.cards.get('itch'))!.contexts[0].i).toBe(1)
    expect(JSON.parse(localStorage.getItem('dtl.settings')!).dailyNew).toBe(20)

    const again = await importBackup(text)
    expect(again.reviews).toBe(0)
    expect(await db.reviews.count()).toBe(1)
  })

  it('拒绝不是本应用导出的文件', async () => {
    await expect(importBackup('{"hello":1}')).rejects.toThrow('备份文件')
  })
})
