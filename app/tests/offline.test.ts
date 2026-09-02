import { beforeEach, describe, expect, it } from 'vitest'
import { isDownloaded, loadOfflineIndex, offlineBytes, offlineSource } from '../src/lib/offline'
import { fmtBytes } from '../src/lib/format'
import type { OfflineIndex } from '../src/lib/offline'

const INDEX_KEY = 'dtl.offline'

function seed(index: OfflineIndex) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

describe('离线索引', () => {
  beforeEach(() => localStorage.clear())

  it('没下载过时是空的', () => {
    expect(loadOfflineIndex()).toEqual({})
    expect(isDownloaded('anything')).toBe(false)
    expect(offlineBytes()).toBe(0)
  })

  it('索引损坏时回落成空，不抛异常', () => {
    localStorage.setItem(INDEX_KEY, '{ 这不是 JSON')
    expect(loadOfflineIndex()).toEqual({})
    expect(isDownloaded('a')).toBe(false)
  })

  it('累计占用按条目求和', () => {
    seed({
      a: { slug: 'a', quality: 'standard', url: 'https://x/a.m4a', bytes: 1000, at: 1 },
      b: { slug: 'b', quality: 'high', url: 'https://x/b.m4a', bytes: 2500, at: 2 },
    })
    expect(isDownloaded('a')).toBe(true)
    expect(isDownloaded('c')).toBe(false)
    expect(offlineBytes()).toBe(3500)
  })

  it('没预热过的地址查不到 blob，调用方回落网络地址', () => {
    seed({ a: { slug: 'a', quality: 'standard', url: 'https://x/a.m4a', bytes: 10, at: 1 } })
    // initOffline 没跑过（jsdom 里没有 Cache Storage），内存表是空的
    expect(offlineSource('https://x/a.m4a')).toBeNull()
  })
})

describe('fmtBytes', () => {
  it('分档换算', () => {
    expect(fmtBytes(0)).toBe('0 MB')
    expect(fmtBytes(-5)).toBe('0 MB')
    expect(fmtBytes(2048)).toBe('2 KB')
    expect(fmtBytes(10 * 1024 * 1024)).toBe('10.0 MB')
    expect(fmtBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
  })

  it('不足 1 KB 也不显示 0 KB', () => {
    expect(fmtBytes(10)).toBe('1 KB')
  })
})
