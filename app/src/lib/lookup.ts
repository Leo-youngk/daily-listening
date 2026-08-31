/**
 * 查词的纯逻辑：分词、词形归一、候选词组、分片键。
 * 前端（Player / DictPanel）与 Pages Function 共用同一份，保证两端切词结果一致。
 */

export interface DictSense {
  pos: string
  zh: string
}

export interface DictEntry {
  lemma: string
  senses: DictSense[]
  ph?: string
  en?: string
  rank?: number
  /** 屈折形式说明，如 "give的过去式" */
  note?: string
}

export interface DictShard {
  v: string
  entries: Record<string, DictEntry>
}

export interface LookupRequest {
  word: string
  wordIndex: number
  sentence: string
  sentenceZh?: string
  slug?: string
  sentenceIdx?: number
  startTime?: number
}

export interface LookupResult {
  term: string
  lemma: string
  phonetic: string
  partOfSpeech: string
  /** 本句义；降级模式下为空 */
  contextMeaning: string
  explanation: string
  otherMeanings: { partOfSpeech: string; zh: string }[]
  /** ai = 上下文判义成功；dictionary = 上下文判义不可用，仅词典义项 */
  source: 'ai' | 'dictionary'
}

export const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g

export interface Token {
  text: string
  start: number
  end: number
}

export function tokenizeSentence(text: string): Token[] {
  const tokens: Token[] = []
  for (const m of text.matchAll(WORD_RE)) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return tokens
}

export function normalizeTerm(word: string): string {
  return word.toLowerCase().replace(/’/g, "'").replace(/^[-']+|[-']+$/g, '')
}

/** 与 scripts/build_dict.py 的 shard_key 保持一致 */
export function shardKey(term: string): string {
  const t = term.toLowerCase().replace(/[^a-z]/g, '')
  if (!t) return '_'
  return t.length >= 2 ? t.slice(0, 2) : `${t}_`
}

/**
 * 以点击词为中心、左右各取最多两个词生成候选词组，长的排前面。
 * 例：句中 "may play out" 点 play -> ["may play out", "play out", "may play", "play"]
 */
export function phraseCandidates(tokens: string[], index: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    if (value && !seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
  }
  for (let len = 3; len >= 2; len -= 1) {
    for (let start = index - len + 1; start <= index; start += 1) {
      if (start < 0 || start + len > tokens.length) continue
      push(tokens.slice(start, start + len).join(' '))
    }
  }
  push(tokens[index] ?? '')
  return out
}

/** 上下文缓存键：同一个词在不同句子、不同位置互不复用 */
export function contextCacheKey(term: string, wordIndex: number, sentence: string, version: string): string {
  return `${version}|${term}|${wordIndex}|${hashString(sentence)}`
}

export function hashString(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13)
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36))
}

/** 生词身份：同一个词的不同义项要能同时存在 */
export function senseId(term: string, lemma: string, contextMeaning: string): string {
  return `${normalizeTerm(term)}|${normalizeTerm(lemma)}|${contextMeaning.trim()}`
}
