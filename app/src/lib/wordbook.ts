/**
 * 六级词表与原声例句（静态数据，scripts/build_vocab.py 生成）。
 *   /wordbook/cet6.json      [词, 音标, 简明释义, 词频名次, 级别]，六级新增在前
 *   /wordbook/episodes.json  每集出现的六级词（词表下标）
 *   /examples/<分片>.json    每个词最多 5 条原声例句
 *   /examples/index.json     切句音频地址前缀
 */
import { fetchJson, HttpError } from './http'
import { shardKey } from './lookup'

export interface BookWord {
  word: string
  ph: string
  zh: string
  rank: number
  /** 6 = 六级新增，4 = 四级及以下也要求 */
  tier: 4 | 6
  index: number
}

export interface Example {
  /** slug */
  s: string
  /** 句子下标 */
  i: number
  /** 目标词在句中的词下标 */
  w: number
  en: string
  zh: string
  /** 句子起止秒数 */
  a: number
  b: number
}

interface WordbookFile {
  v: string
  words: [string, string, string, number, 4 | 6][]
}

let wordbookTask: Promise<BookWord[]> | null = null
let episodeTask: Promise<Record<string, number[]>> | null = null
let indexTask: Promise<{ clipBase: string }> | null = null
const shardTasks = new Map<string, Promise<Record<string, Example[]>>>()

function once<T>(load: () => Promise<T>, reset: () => void): Promise<T> {
  const task = load()
  // 失败不能永久缓存：下次调用重新请求
  task.catch(reset)
  return task
}

export function loadWordbook(): Promise<BookWord[]> {
  wordbookTask ??= once(
    () => fetchJson<WordbookFile>('/wordbook/cet6.json', { timeoutMs: 20_000, retries: 2 })
      .then(data => data.words.map(([word, ph, zh, rank, tier], index) => ({ word, ph, zh, rank, tier, index }))),
    () => { wordbookTask = null },
  )
  return wordbookTask
}

let mapTask: Promise<Map<string, BookWord>> | null = null
export function loadWordbookMap(): Promise<Map<string, BookWord>> {
  mapTask ??= loadWordbook().then(words => new Map(words.map(w => [w.word, w])))
  mapTask.catch(() => { mapTask = null })
  return mapTask
}

export function loadEpisodeWords(): Promise<Record<string, number[]>> {
  episodeTask ??= once(
    () => fetchJson<{ episodes: Record<string, number[]> }>('/wordbook/episodes.json', { timeoutMs: 20_000, retries: 2 })
      .then(data => data.episodes),
    () => { episodeTask = null },
  )
  return episodeTask
}

function loadIndex() {
  indexTask ??= once(
    () => fetchJson<{ clipBase: string }>('/examples/index.json', { timeoutMs: 15_000, retries: 2 }),
    () => { indexTask = null },
  )
  return indexTask
}

export async function loadExamples(term: string): Promise<Example[]> {
  const key = shardKey(term)
  let task = shardTasks.get(key)
  if (!task) {
    task = fetchJson<{ entries: Record<string, Example[]> }>(`/examples/${key}.json`, { timeoutMs: 15_000, retries: 1 })
      .then(data => data.entries)
      // 没有这个分片（该字母开头的词都没有例句）是正常情况
      .catch(error => {
        if (error instanceof HttpError && error.status === 404) return {}
        shardTasks.delete(key)
        throw error
      })
    shardTasks.set(key, task)
  }
  return (await task)[term] ?? []
}

/** 切句音频：scripts/cut_clips.py 按"句子下标-起点厘秒"命名，句子重切后地址自动变 */
export async function clipUrl(slug: string, index: number, start: number): Promise<string> {
  const { clipBase } = await loadIndex()
  return `${clipBase}/${slug}/${index}-${Math.round(start * 100)}.m4a`
}

/** 卡片可用的原声例句：用户亲历的语境在前（查词、本集清点），其后是词表例句 */
export interface CardExample {
  slug: string
  i: number
  en: string
  zh?: string
  start: number
  /** 目标词的词下标，用于高亮 */
  w?: number
  own: boolean
}

export async function examplesFor(term: string, contexts: { slug: string; i: number; en: string; zh?: string; start: number; w?: number }[] = []): Promise<CardExample[]> {
  const own: CardExample[] = contexts
    .filter(c => c.slug)
    .map(c => ({ slug: c.slug, i: c.i, en: c.en, zh: c.zh, start: c.start, w: c.w, own: true }))
  const fromBook = term.includes(' ') ? [] : await loadExamples(term)
  const rest = fromBook
    .filter(e => !own.some(o => o.slug === e.s && o.i === e.i))
    .map(e => ({ slug: e.s, i: e.i, en: e.en, zh: e.zh, start: e.a, w: e.w, own: false }))
  return [...own, ...rest]
}
