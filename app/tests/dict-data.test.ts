import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DictShard } from '../src/lib/lookup'
import { normalizeTerm, phraseCandidates, shardKey, tokenizeSentence } from '../src/lib/lookup'

// jsdom 环境下 import.meta.url 不是 file: 协议，只能从 vitest 的工作目录（app/）推路径
const DICT_DIR = resolve(process.cwd(), '../public/dict')

function shard(key: string): DictShard {
  return JSON.parse(readFileSync(resolve(DICT_DIR, `${key}.json`), 'utf-8')) as DictShard
}

function entry(term: string) {
  return shard(shardKey(term)).entries[term]
}

/** 复刻 lookupLocal 的选词逻辑，但直接读磁盘上的分片，验证词典数据本身 */
function resolveTerm(sentence: string, word: string) {
  const tokens = tokenizeSentence(sentence).map(t => normalizeTerm(t.text))
  const index = tokens.indexOf(word)
  const candidates = phraseCandidates(tokens, index)
  const phrase = candidates.find(c => c !== word && entry(c))
  const term = phrase ?? word
  return { term, entry: entry(term) }
}

describe('词典分片索引', () => {
  it('index.json 标明版本和 ECDICT 来源', () => {
    const index = JSON.parse(readFileSync(resolve(DICT_DIR, 'index.json'), 'utf-8')) as {
      v: string
      source: string
      shards: Record<string, number>
    }
    expect(index.v).toMatch(/^ecdict-/)
    expect(index.source).toContain('MIT')
    expect(Object.keys(index.shards).length).toBeGreaterThan(300)
  })
})

describe('本地词典义项', () => {
  it('play 收录多个词性和多条常用义项', () => {
    const e = entry('play')
    expect(e).toBeDefined()
    expect(e.senses.length).toBeGreaterThan(1)
    expect(e.senses.some(s => s.pos.startsWith('n'))).toBe(true)
    expect(e.senses.some(s => s.pos.startsWith('v'))).toBe(true)
    expect(e.ph).toBeTruthy()
  })

  it('屈折形式直接带原形义项，不用再取一次分片', () => {
    const e = entry('gave')
    expect(e.lemma).toBe('give')
    expect(e.senses.some(s => s.zh.includes('给'))).toBe(true)
    // 不能只剩 "give的过去式" 这种没有信息量的解释
    expect(e.senses.every(s => /的过去式|的过去分词|的复数/.test(s.zh))).toBe(false)
    expect(e.note).toBeTruthy()
  })

  it('taken 归一到 take', () => {
    expect(entry('taken').lemma).toBe('take')
  })
})

describe('词组识别', () => {
  it('play out 被识别成词组，而不是单独的 play', () => {
    const r = resolveTerm('We have no idea how this will play out over the next decade.', 'play')
    expect(r.term).toBe('play out')
    expect(r.entry.senses[0].zh).not.toContain('播放')
  })

  it('Nativity play 走戏剧义，不会和 play out 混成同一条', () => {
    const r = resolveTerm('I was a sheep in the school Nativity play that December.', 'play')
    // ECDICT 收了 "nativity play"（基督诞生剧），比裸 play 更贴合本句
    expect(r.term).toBe('nativity play')
    expect(r.entry.senses[0].zh).toContain('剧')
    expect(r.entry.senses.some(s => s.zh.includes('播放'))).toBe(false)
  })

  it('take off 作为词组收录', () => {
    const r = resolveTerm('The plane will take off in ten minutes.', 'take')
    expect(r.term).toBe('take off')
  })
})
