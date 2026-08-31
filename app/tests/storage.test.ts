import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_ERROR_EVENT,
  addVocab,
  loadVocab,
  removeVocab,
  saveProgress,
  saveSettings,
  updateVocab,
} from '../src/lib/storage'
import type { VocabItem } from '../src/lib/types'

type NewVocab = Omit<VocabItem, 'id' | 'addedAt' | 'mastered'>

const PLAY_OUT: NewVocab = {
  term: 'play out',
  word: 'play',
  lemma: 'play out',
  contextMeaning: '发展、演变',
  sentenceEn: 'We have no idea how this will play out.',
  slug: 'demo',
  sentenceIdx: 3,
  startTime: 12.5,
}

const PLAY_DRAMA: NewVocab = {
  term: 'play',
  word: 'play',
  lemma: 'play',
  contextMeaning: '戏剧、演出',
  sentenceEn: 'I was a sheep in the school Nativity play.',
}

const PLAY_MEDIA: NewVocab = {
  term: 'play',
  word: 'play',
  lemma: 'play',
  contextMeaning: '播放',
  sentenceEn: 'Press the button to play the recording.',
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('生词本按义项去重', () => {
  it('同一个词的三个义项可以同时存在', () => {
    expect(addVocab(PLAY_OUT)).toBe('added')
    expect(addVocab(PLAY_DRAMA)).toBe('added')
    expect(addVocab(PLAY_MEDIA)).toBe('added')
    const all = loadVocab()
    expect(all).toHaveLength(3)
    expect(new Set(all.map(v => v.id)).size).toBe(3)
  })

  it('重复收藏同一个义项返回 exists，不谎报成功', () => {
    expect(addVocab(PLAY_DRAMA)).toBe('added')
    expect(addVocab(PLAY_DRAMA)).toBe('exists')
    expect(loadVocab()).toHaveLength(1)
  })

  it('删除和标记掌握都按义项定位', () => {
    addVocab(PLAY_OUT)
    addVocab(PLAY_DRAMA)
    const drama = loadVocab().find(v => v.contextMeaning === '戏剧、演出')!
    expect(updateVocab(drama.id, { mastered: true })).toBe(true)
    expect(loadVocab().find(v => v.id === drama.id)!.mastered).toBe(true)
    expect(loadVocab().find(v => v.term === 'play out')!.mastered).toBe(false)
    removeVocab(drama.id)
    expect(loadVocab().map(v => v.term)).toEqual(['play out'])
  })

  it('保留回到原文所需的定位信息', () => {
    addVocab(PLAY_OUT)
    const saved = loadVocab()[0]
    expect(saved.slug).toBe('demo')
    expect(saved.sentenceIdx).toBe(3)
    expect(saved.startTime).toBe(12.5)
    expect(saved.word).toBe('play')
  })
})

describe('旧数据升级', () => {
  it('旧版 {word, meaning, source} 记录读出来不丢', () => {
    localStorage.setItem(
      'dtl.vocab',
      JSON.stringify([{ word: 'play', meaning: '播放', source: 'Press play.', addedAt: 1, mastered: true }]),
    )
    const all = loadVocab()
    expect(all).toHaveLength(1)
    expect(all[0].term).toBe('play')
    expect(all[0].contextMeaning).toBe('播放')
    expect(all[0].sentenceEn).toBe('Press play.')
    expect(all[0].mastered).toBe(true)
    expect(all[0].id).toBeTruthy()
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

  it('配额超限时 addVocab 返回 failed 并广播提示', () => {
    const messages = failingStorage(new DOMException('full', 'QuotaExceededError'))
    expect(addVocab(PLAY_DRAMA)).toBe('failed')
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
