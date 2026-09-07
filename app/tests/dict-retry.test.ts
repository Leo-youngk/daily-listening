import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadEntries, lookupLocal, prefetchLookup } from '../src/lib/dict'

afterEach(() => vi.unstubAllGlobals())

describe('词典分片加载', () => {
  it('临时失败后下一次查询会重新请求', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('offline')
      return new Response(JSON.stringify({
        v: 'test',
        entries: { qzx: { lemma: 'qzx', senses: [] } },
      }))
    }))

    expect((await loadEntries(['qzx'])).has('qzx')).toBe(false)
    expect((await loadEntries(['qzx'])).has('qzx')).toBe(true)
    expect(calls).toBe(2)
  })

  it('预取会复用分片请求，并在完整词组结果前回调单词释义', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      return new Response(JSON.stringify({
        v: 'test',
        entries: {
          now: { lemma: 'now', senses: [{ pos: 'adv.', zh: '现在' }] },
          'zzq now': { lemma: 'zzq now', senses: [{ pos: 'phr.', zh: '测试短语' }] },
        },
      }))
    }))

    prefetchLookup('zzq now', 1)
    const partial = vi.fn()
    const result = await lookupLocal('zzq now', 1, partial)

    expect(partial).toHaveBeenCalledWith(expect.objectContaining({ term: 'now' }))
    expect(result.entry?.lemma).toBe('zzq now')
    // zz 和 n_ 两个分片各请求一次，点击后的查询没有再重复发 zz 请求。
    expect(calls).toBe(2)
  })
})
