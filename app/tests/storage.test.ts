import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_ERROR_EVENT,
  isFinished,
  loadFavorites,
  loadProgress,
  loadStats,
  pruneEpisodes,
  recordStudy,
  saveProgress,
  saveSettings,
  toggleFavorite,
} from '../src/lib/storage'
import { localDateKey } from '../src/lib/date'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('节目换代清理', () => {
  it('只保留当前节目清单里的进度与收藏', () => {
    saveProgress('bbc6min_260924', 120, 380)
    saveProgress('ken_robinson_says_schools_kill_creativity', 600, 1165)
    toggleFavorite('ken_robinson_says_schools_kill_creativity')
    toggleFavorite('bbc6min_260924')
    pruneEpisodes(new Set(['bbc6min_260924']))
    expect(Object.keys(loadProgress())).toEqual(['bbc6min_260924'])
    expect(loadFavorites()).toEqual(['bbc6min_260924'])
  })
})

describe('听完判定', () => {
  it('离结尾不足 30 秒算听完', () => {
    expect(isFinished({ pos: 355, duration: 380 })).toBe(true)
    expect(isFinished({ pos: 300, duration: 380 })).toBe(false)
    expect(isFinished(undefined)).toBe(false)
  })
})

describe('背词也算打卡', () => {
  it('recordStudy 记下今天，重复调用不重复计', () => {
    recordStudy()
    recordStudy()
    expect(loadStats().days).toEqual([localDateKey()])
    expect(loadStats().seconds).toBe(0)
  })
})

describe('写入失败不静默', () => {
  function failingStorage(error: unknown) {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw error
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const messages: string[] = []
    window.addEventListener(STORAGE_ERROR_EVENT, e => messages.push((e as CustomEvent<string>).detail))
    return messages
  }

  it('配额超限时广播"已满"提示', () => {
    const messages = failingStorage(new DOMException('full', 'QuotaExceededError'))
    expect(saveProgress('demo', 10, 100)).toBe(false)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('已满')
  })

  it('无痕模式下进度、设置写入也会报错而不是当作成功', () => {
    const messages = failingStorage(new DOMException('denied', 'SecurityError'))
    expect(saveProgress('demo', 10, 100)).toBe(false)
    expect(saveSettings({ theme: 'dark' })).toBe(false)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toContain('无痕')
  })
})
