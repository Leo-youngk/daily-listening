import { describe, expect, it } from 'vitest'
import { sentenceAt, wordAt } from '../src/lib/timeline'
import type { Sentence } from '../src/lib/types'

function sen(i: number, start: number, end: number, w?: number[]): Sentence {
  return { i, start, end, en: `s${i}`, zh: `句${i}`, ...(w ? { w } : {}) }
}

/** 干净的时间轴：句子首尾相接，无重叠 */
const CLEAN = [
  sen(0, 0, 2),
  sen(1, 2, 5),
  sen(2, 5, 9),
]

describe('sentenceAt', () => {
  it('空数据返回 -1', () => {
    expect(sentenceAt(undefined, 3)).toBe(-1)
    expect(sentenceAt([], 3)).toBe(-1)
  })

  it('落在句中取该句', () => {
    expect(sentenceAt(CLEAN, 1)).toBe(0)
    expect(sentenceAt(CLEAN, 3.5)).toBe(1)
    expect(sentenceAt(CLEAN, 7)).toBe(2)
  })

  it('边界时刻归属后一句（start 是闭区间）', () => {
    expect(sentenceAt(CLEAN, 2)).toBe(1)
    expect(sentenceAt(CLEAN, 5)).toBe(2)
  })

  it('音频开头早于第一句 start 时停在第一句，不返回 -1', () => {
    expect(sentenceAt([sen(0, 4, 6)], 0)).toBe(0)
  })

  it('超过最后一句仍停在最后一句', () => {
    expect(sentenceAt(CLEAN, 999)).toBe(2)
  })

  it('时间轴重叠超过 0.3s 时不提前跳走，仍高亮上一句', () => {
    // 第 0 句念到 5.0，第 1 句 cue 却从 2.0 开始，重叠 3s
    const overlap = [sen(0, 0, 5), sen(1, 2, 8)]
    expect(sentenceAt(overlap, 3)).toBe(0)
    expect(sentenceAt(overlap, 4.9)).toBe(0)
    // 上一句念完后才交棒
    expect(sentenceAt(overlap, 5.1)).toBe(1)
  })

  it('重叠不足 0.3s 属于正常抖动，按后一句算', () => {
    const jitter = [sen(0, 0, 2.2), sen(1, 2, 5)]
    expect(sentenceAt(jitter, 2.1)).toBe(1)
  })

  it('只回退一句，不会连续回退', () => {
    const messy = [sen(0, 0, 9), sen(1, 1, 9), sen(2, 2, 9)]
    expect(sentenceAt(messy, 3)).toBe(1)
  })
})

describe('wordAt', () => {
  // "It is a dream" 四个词
  const W = [0, 0.3, 0.3, 0.5, 0.5, 0.6, 0.7, 1.2]

  it('没有词级时间轴返回 -1', () => {
    expect(wordAt(undefined, 1)).toBe(-1)
    expect(wordAt([], 1)).toBe(-1)
  })

  it('本句还没开口返回 -1', () => {
    expect(wordAt(W, -0.5)).toBe(-1)
  })

  it('逐词推进', () => {
    expect(wordAt(W, 0)).toBe(0)
    expect(wordAt(W, 0.2)).toBe(0)
    expect(wordAt(W, 0.3)).toBe(1)
    expect(wordAt(W, 0.55)).toBe(2)
    expect(wordAt(W, 0.9)).toBe(3)
  })

  it('词间空档停在上一个词，不闪回 -1', () => {
    // 0.6~0.7 是第 2 词念完、第 3 词还没开始的停顿
    expect(wordAt(W, 0.65)).toBe(2)
  })

  it('句尾之后停在最后一个词', () => {
    expect(wordAt(W, 99)).toBe(3)
  })

  it('下标是词序不是数组下标', () => {
    expect(wordAt(W, 1.0)).toBe(W.length / 2 - 1)
  })
})
