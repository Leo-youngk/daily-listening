/**
 * 字幕时间轴的纯查找逻辑。
 *
 * 从 PlayerContext / Player 里抽出来单独放，是因为这两个查找函数是整个高亮链路的
 * 核心，出错的表现（高亮早一句、词高亮跳格）在真机上极难复现，必须能单测。
 */
import type { Sentence } from './types'

/**
 * 找出 time 落在哪一句，返回下标；空数组返回 -1。
 *
 * time 应当是"已扣掉字幕偏移"的时间。二分取最后一个 start <= time 的句子，
 * 再对仍有重叠的时间轴做一次回退——强制对齐失败、沿用原始 cue 的篇目里，
 * 下一句的 start 可能早于上一句的 end，此时不应在上一句念完前就把高亮跳走。
 */
export function sentenceAt(sentences: Sentence[] | undefined, time: number): number {
  if (!sentences?.length) return -1
  let low = 0
  let high = sentences.length - 1
  let answer = 0
  while (low <= high) {
    const middle = (low + high) >> 1
    if (sentences[middle].start <= time) {
      answer = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  const previous = sentences[answer - 1]
  if (previous && previous.end > time && previous.end - sentences[answer].start > 0.3) {
    return answer - 1
  }
  return answer
}

/**
 * 词级时间轴 w=[start,end,start,end,...] 里找当前词的下标。
 * 返回 -1 表示本句还没开口（time 早于第一个词的 start）。
 */
export function wordAt(w: number[] | undefined, time: number): number {
  if (!w) return -1
  const count = w.length >> 1
  if (count === 0 || time < w[0]) return -1
  let low = 0
  let high = count - 1
  let answer = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (w[middle * 2] <= time) {
      answer = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return answer
}
