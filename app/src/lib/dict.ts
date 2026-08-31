/**
 * 查词的两层缓存：
 *   1. 基础词典 —— /dict/<分片>.json，内容随 ECDICT 版本整体更换，Service Worker 长期缓存。
 *   2. 上下文判义 —— 按 词条 + 词序 + 整句哈希 + 模型版本 缓存，同一个词在不同句子里互不复用。
 * 失败结果一律不写长期缓存。
 */
import type { DictEntry, DictShard, LookupRequest, LookupResult } from './lookup'
import { contextCacheKey, normalizeTerm, phraseCandidates, shardKey, tokenizeSentence } from './lookup'

const CONTEXT_CACHE_KEY = 'dtl.sensecache'
const CONTEXT_CACHE_LIMIT = 400
const CONTEXT_CACHE_TTL = 1000 * 60 * 60 * 24 * 30

const shardPromises = new Map<string, Promise<DictShard | null>>()

function loadShard(key: string): Promise<DictShard | null> {
  const cached = shardPromises.get(key)
  if (cached) return cached
  const task = fetch(`/dict/${key}.json`)
    .then(res => (res.ok ? res.json() as Promise<DictShard> : null))
    .catch(() => null)
  shardPromises.set(key, task)
  return task
}

/** 取候选词条对应的本地词典条目；只下载候选涉及的分片 */
export async function loadEntries(terms: string[]): Promise<Map<string, DictEntry>> {
  const keys = new Set(terms.map(shardKey))
  const shards = await Promise.all([...keys].map(loadShard))
  const merged = new Map<string, DictEntry>()
  for (const shard of shards) {
    if (!shard) continue
    for (const [term, entry] of Object.entries(shard.entries)) merged.set(term, entry)
  }
  return merged
}

export interface LocalLookup {
  /** 本地词典能确定的最佳词条：优先最长的已收录词组，否则是被点击的词 */
  term: string
  entry?: DictEntry
  candidates: string[]
}

export async function lookupLocal(sentence: string, wordIndex: number): Promise<LocalLookup> {
  const tokens = tokenizeSentence(sentence).map(t => normalizeTerm(t.text))
  const candidates = phraseCandidates(tokens, wordIndex)
  const entries = await loadEntries(candidates)
  const word = tokens[wordIndex] ?? ''
  const phrase = candidates.find(c => c !== word && entries.has(c))
  const term = phrase ?? word
  return { term, entry: entries.get(term) ?? entries.get(word), candidates }
}

interface CachedSense extends LookupResult {
  ts: number
}

function readContextCache(): Record<string, CachedSense> {
  try {
    return JSON.parse(localStorage.getItem(CONTEXT_CACHE_KEY) || '{}') as Record<string, CachedSense>
  } catch {
    return {}
  }
}

export function readCachedSense(key: string): LookupResult | null {
  const hit = readContextCache()[key]
  if (!hit || Date.now() - hit.ts > CONTEXT_CACHE_TTL) return null
  return hit
}

function writeCachedSense(key: string, result: LookupResult) {
  try {
    const all = readContextCache()
    all[key] = { ...result, ts: Date.now() }
    const keys = Object.keys(all)
    if (keys.length > CONTEXT_CACHE_LIMIT) {
      keys.sort((a, b) => all[a].ts - all[b].ts)
        .slice(0, keys.length - CONTEXT_CACHE_LIMIT)
        .forEach(k => delete all[k])
    }
    localStorage.setItem(CONTEXT_CACHE_KEY, JSON.stringify(all))
  } catch (error) {
    // 缓存写不进去不影响本次查询结果，只记录不打扰用户
    console.warn('sense cache write failed', error)
  }
}

export const SENSE_CACHE_VERSION = 'v1'

export function senseCacheKeyOf(req: LookupRequest): string {
  return contextCacheKey(normalizeTerm(req.word), req.wordIndex, req.sentence, SENSE_CACHE_VERSION)
}

export async function lookupContext(req: LookupRequest, signal: AbortSignal): Promise<LookupResult> {
  const res = await fetch('/api/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  })
  const data = await res.json() as LookupResult
  if (!res.ok && res.status !== 429) throw new Error(`lookup failed: ${res.status}`)
  // 结果一到就落缓存，不等其他请求；降级结果不写，允许下次重试
  if (data.source === 'ai' && data.contextMeaning) writeCachedSense(senseCacheKeyOf(req), data)
  return data
}
