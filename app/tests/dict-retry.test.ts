import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadEntries } from '../src/lib/dict'

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
})
