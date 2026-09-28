/**
 * 背词数据存 IndexedDB（Dexie）。
 *
 * 为什么不放 localStorage：复习日志按每天 100 次算一年 3~4 万条，localStorage 的 5MB
 * 一年左右就顶满；而且 localStorage 每次读写都要整块解析 JSON。
 * 收听进度、收藏、设置这些小而有界的数据仍在 localStorage（lib/storage.ts）。
 */
import Dexie from 'dexie'
import type { EntityTable } from 'dexie'

/** 用户亲自遇到过的语境：查词、本集清点时记下的那一句（复习时优先当例句用） */
export interface CardContext {
  slug: string
  /** 句子下标 */
  i: number
  en: string
  zh?: string
  start: number
  end: number
  /** 目标词在句中的词下标（tokenizeSentence） */
  w?: number
  /** 查词接口给出的本句义 */
  meaning?: string
}

export type CardStatus = 'learning' | 'known'

export interface CardRecord {
  /** 主键：六级词原形，或查词得到的词组（"play out"） */
  term: string
  kind: 'word' | 'phrase'
  /** 在六级词表里 */
  inBook: boolean
  /** learning = FSRS 调度中；known = 标熟，不再安排复习 */
  status: CardStatus
  // —— FSRS 卡片状态（ts-fsrs Card，日期存毫秒数便于建索引）——
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review?: number
  /** 卡片背面主释义：本句义优先，其次词表简明释义 */
  meaning: string
  phonetic?: string
  contexts: CardContext[]
  addedAt: number
  updatedAt: number
}

export interface ReviewRecord {
  id?: number
  term: string
  /** 1 忘了 2 模糊 3 记得 4 简单 */
  rating: number
  at: number
  state: number
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
}

class AppDB extends Dexie {
  cards!: EntityTable<CardRecord, 'term'>
  reviews!: EntityTable<ReviewRecord, 'id'>

  constructor() {
    super('daily-listening')
    this.version(1).stores({
      cards: 'term, status, due, addedAt',
      reviews: '++id, term, at',
    })
  }
}

export const db = new AppDB()

export const CARDS_EVENT = 'dtl-cards'

/** 卡片变更广播：词表页、字幕上色、首页计数都靠它刷新 */
export function notifyCards() {
  window.dispatchEvent(new CustomEvent(CARDS_EVENT))
}
