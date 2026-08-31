import { describe, expect, it } from 'vitest'
import {
  contextCacheKey,
  normalizeTerm,
  phraseCandidates,
  senseId,
  shardKey,
  tokenizeSentence,
} from '../src/lib/lookup'

const PLAY_OUT = 'We have no idea how this will play out over the next decade.'
const NATIVITY = 'I was a sheep in the school Nativity play that December.'

function indexOfWord(sentence: string, word: string): number {
  return tokenizeSentence(sentence).findIndex(t => normalizeTerm(t.text) === word)
}

describe('tokenizeSentence', () => {
  it('保留每个词在原句中的字符区间', () => {
    const tokens = tokenizeSentence('Play out, please.')
    expect(tokens.map(t => t.text)).toEqual(['Play', 'out', 'please'])
    expect(tokens[1].start).toBe(5)
    expect(tokens[1].end).toBe(8)
  })

  it('把撇号和连字符当作词的一部分', () => {
    expect(tokenizeSentence("It's a well-known trade-off.").map(t => t.text))
      .toEqual(["It's", 'a', 'well-known', 'trade-off'])
  })
})

describe('normalizeTerm', () => {
  it('统一大小写和弯撇号，并去掉首尾标点', () => {
    expect(normalizeTerm('Play')).toBe('play')
    expect(normalizeTerm('It’s')).toBe("it's")
    expect(normalizeTerm('-word-')).toBe('word')
  })
})

describe('phraseCandidates', () => {
  it('从点击位置向左右各取两词，长的词组排在前面', () => {
    const tokens = tokenizeSentence(PLAY_OUT).map(t => normalizeTerm(t.text))
    const i = tokens.indexOf('play')
    const candidates = phraseCandidates(tokens, i)
    expect(candidates).toContain('play')
    expect(candidates).toContain('play out')
    expect(candidates.indexOf('play out')).toBeLessThan(candidates.indexOf('play'))
  })

  it('单词在句首句尾也不会越界', () => {
    const tokens = ['thanks']
    expect(phraseCandidates(tokens, 0)).toEqual(['thanks'])
  })
})

describe('contextCacheKey', () => {
  it('同一个词在不同句子里得到不同的缓存键', () => {
    const a = contextCacheKey('play', indexOfWord(PLAY_OUT, 'play'), PLAY_OUT, 'v1')
    const b = contextCacheKey('play', indexOfWord(NATIVITY, 'play'), NATIVITY, 'v1')
    expect(a).not.toBe(b)
  })

  it('同一个词在同一句的同一位置得到相同的缓存键', () => {
    const i = indexOfWord(PLAY_OUT, 'play')
    expect(contextCacheKey('play', i, PLAY_OUT, 'v1'))
      .toBe(contextCacheKey('play', i, PLAY_OUT, 'v1'))
  })

  it('模型版本变化会让旧缓存整体失效', () => {
    const i = indexOfWord(PLAY_OUT, 'play')
    expect(contextCacheKey('play', i, PLAY_OUT, 'v1'))
      .not.toBe(contextCacheKey('play', i, PLAY_OUT, 'v2'))
  })
})

describe('shardKey', () => {
  it('按前两个字母分片，与 build_dict.py 保持一致', () => {
    expect(shardKey('play')).toBe('pl')
    expect(shardKey('play out')).toBe('pl')
    expect(shardKey('a')).toBe('a_')
    expect(shardKey('123')).toBe('_')
  })
})

describe('senseId', () => {
  it('同一个词的不同义项得到不同的身份', () => {
    expect(senseId('play out', 'play out', '发展、演变'))
      .not.toBe(senseId('play', 'play', '戏剧、演出'))
    expect(senseId('play', 'play', '播放'))
      .not.toBe(senseId('play', 'play', '戏剧、演出'))
  })

  it('同词条同义项重复收藏得到相同的身份', () => {
    expect(senseId('play', 'play', '播放')).toBe(senseId('play', 'play', '播放'))
  })
})
