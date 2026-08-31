import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupContext, readCachedSense, senseCacheKeyOf } from '../src/lib/dict'
import type { LookupRequest, LookupResult } from '../src/lib/lookup'

const PLAY_OUT: LookupRequest = {
  word: 'play',
  wordIndex: 7,
  sentence: 'We have no idea how this will play out over the next decade.',
}

const NATIVITY: LookupRequest = {
  word: 'play',
  wordIndex: 8,
  sentence: 'I was a sheep in the school Nativity play that December.',
}

const AI_RESULT: LookupResult = {
  term: 'play out',
  lemma: 'play out',
  phonetic: 'plei aut',
  partOfSpeech: 'phrasal verb',
  contextMeaning: '发展、演变',
  explanation: '这里指事情如何一步步展开。',
  otherMeanings: [{ partOfSpeech: 'v', zh: '把戏演完' }],
  source: 'ai',
}

const DEGRADED: LookupResult = {
  term: 'play',
  lemma: 'play',
  phonetic: 'plei',
  partOfSpeech: '',
  contextMeaning: '',
  explanation: '',
  otherMeanings: [{ partOfSpeech: 'n', zh: '游戏' }],
  source: 'dictionary',
}

function mockFetch(body: LookupResult, status = 200) {
  // 每次调用都要新建 Response，同一个实例的 body 只能读一次
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('上下文判义缓存', () => {
  it('成功结果立刻落缓存，同句同位置不再发请求', async () => {
    const fetchMock = mockFetch(AI_RESULT)
    const first = await lookupContext(PLAY_OUT, new AbortController().signal)
    expect(first.contextMeaning).toBe('发展、演变')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const cached = readCachedSense(senseCacheKeyOf(PLAY_OUT))
    expect(cached?.term).toBe('play out')
  })

  it('同一个词在另一句里不会命中上一句的缓存', async () => {
    mockFetch(AI_RESULT)
    await lookupContext(PLAY_OUT, new AbortController().signal)
    expect(senseCacheKeyOf(NATIVITY)).not.toBe(senseCacheKeyOf(PLAY_OUT))
    expect(readCachedSense(senseCacheKeyOf(NATIVITY))).toBeNull()
  })

  it('降级结果不写长期缓存，下次仍会重试', async () => {
    const fetchMock = mockFetch(DEGRADED)
    const result = await lookupContext(PLAY_OUT, new AbortController().signal)
    expect(result.source).toBe('dictionary')
    expect(result.contextMeaning).toBe('')
    expect(readCachedSense(senseCacheKeyOf(PLAY_OUT))).toBeNull()

    await lookupContext(PLAY_OUT, new AbortController().signal)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('限流返回 429 时按降级处理而不是抛错', async () => {
    mockFetch(DEGRADED, 429)
    const result = await lookupContext(PLAY_OUT, new AbortController().signal)
    expect(result.source).toBe('dictionary')
    expect(readCachedSense(senseCacheKeyOf(PLAY_OUT))).toBeNull()
  })

  it('服务端 500 抛错，由调用方进入降级展示', async () => {
    mockFetch(DEGRADED, 500)
    await expect(lookupContext(PLAY_OUT, new AbortController().signal)).rejects.toThrow(/500/)
  })

  it('缓存过期后不再命中', async () => {
    mockFetch(AI_RESULT)
    await lookupContext(PLAY_OUT, new AbortController().signal)
    const key = senseCacheKeyOf(PLAY_OUT)
    const all = JSON.parse(localStorage.getItem('dtl.sensecache')!) as Record<string, { ts: number }>
    all[key].ts = Date.now() - 1000 * 60 * 60 * 24 * 31
    localStorage.setItem('dtl.sensecache', JSON.stringify(all))
    expect(readCachedSense(key)).toBeNull()
  })
})
