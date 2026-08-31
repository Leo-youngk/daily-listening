/**
 * 上下文判义接口：把整句原文连同点击位置一起送进 Workers AI，
 * 判断被点击的词在本句里的真实含义，并识别它是否属于某个固定词组。
 *
 * 义项、音标一律来自本地 ECDICT 分片（/dict/*.json），模型只负责"选哪一条 + 本句解释"，
 * 模型失败时降级为纯词典义项，并在 source 字段明确标出，不伪装成上下文翻译。
 */
import type { DictEntry, DictShard, LookupRequest, LookupResult } from '../../src/lib/lookup'
import { normalizeTerm, phraseCandidates, shardKey, tokenizeSentence } from '../../src/lib/lookup'

interface Env {
  /** wrangler.jsonc 的 ai.binding；类型来自 @cloudflare/workers-types */
  AI: Ai
  /** Pages Functions 读取同源静态资源（词典分片）的内置绑定 */
  ASSETS: Fetcher
}

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
/** 上下文缓存键的一部分：改提示词或换模型时必须递增，避免复用旧结果 */
const MODEL_VERSION = 'v1'
const RATE_LIMIT = 30
const RATE_WINDOW_SECONDS = 60
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30
const MAX_SENTENCE_LENGTH = 600

const SYSTEM_PROMPT = [
  '你是英语词义消歧助手。给定一句英文原文和其中被点击的一个词，判断它在这句话里的真实含义。',
  '规则：',
  '1. 如果被点击的词与相邻词构成短语动词、固定搭配或习语，term 必须是完整词组；否则 term 就是被点击的词本身。',
  '2. term 只能从给出的候选列表里选，不要自创。',
  '3. lemma 是 term 的词典原形。',
  '4. partOfSpeech 用英文词性标签：verb / noun / adjective / adverb / phrasal verb / idiom / preposition / conjunction 之一。',
  '5. contextMeaning 是该词在本句中的中文释义，简短，可用分号分隔近义表达；不要翻译整句。',
  '6. explanation 用一句中文说明它在本句里为什么是这个意思。',
  '只输出 JSON。',
].join('\n')

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    term: { type: 'string' },
    lemma: { type: 'string' },
    partOfSpeech: { type: 'string' },
    contextMeaning: { type: 'string' },
    explanation: { type: 'string' },
  },
  required: ['term', 'lemma', 'partOfSpeech', 'contextMeaning', 'explanation'],
  additionalProperties: false,
}

function json(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
  })
}

async function loadShards(env: Env, origin: string, keys: Set<string>): Promise<Map<string, DictEntry>> {
  const merged = new Map<string, DictEntry>()
  await Promise.all([...keys].map(async key => {
    try {
      const res = await env.ASSETS.fetch(`${origin}/dict/${key}.json`)
      if (!res.ok) return
      const shard = await res.json() as DictShard
      for (const [term, entry] of Object.entries(shard.entries ?? {})) merged.set(term, entry)
    } catch {
      // 分片缺失只影响候选丰富度，不影响主流程
    }
  }))
  return merged
}

/** 粗粒度限流：按 IP + 分钟窗口在边缘缓存里计数，防止公开接口被刷 */
async function overRateLimit(ip: string): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000))
  const key = new Request(`https://ratelimit.invalid/${encodeURIComponent(ip)}/${bucket}`)
  const cache = caches.default
  const hit = await cache.match(key)
  const used = hit ? Number(await hit.text()) || 0 : 0
  if (used >= RATE_LIMIT) return true
  await cache.put(key, new Response(String(used + 1), {
    headers: { 'Cache-Control': `max-age=${RATE_WINDOW_SECONDS * 2}` },
  }))
  return false
}

function pickDictEntry(entries: Map<string, DictEntry>, term: string): DictEntry | undefined {
  return entries.get(normalizeTerm(term)) ?? entries.get(term.toLowerCase())
}

function toOtherMeanings(entry: DictEntry | undefined, contextMeaning: string) {
  if (!entry) return []
  return entry.senses
    .filter(s => s.zh && s.zh !== contextMeaning)
    .slice(0, 6)
    .map(s => ({ partOfSpeech: s.pos.replace(/\.$/, ''), zh: s.zh }))
}

function dictionaryFallback(word: string, entries: Map<string, DictEntry>): LookupResult {
  const entry = pickDictEntry(entries, word)
  return {
    term: word,
    lemma: entry?.lemma ?? word,
    phonetic: entry?.ph ?? '',
    partOfSpeech: entry?.senses[0]?.pos.replace(/\.$/, '') ?? '',
    contextMeaning: '',
    explanation: '',
    otherMeanings: toOtherMeanings(entry, ''),
    source: 'dictionary',
  }
}

function parseModelOutput(raw: unknown): Record<string, string> | null {
  const result = (raw as { response?: unknown; choices?: { message?: { content?: string } }[] })
  let payload: unknown = result?.response
  if (payload === undefined && result?.choices?.length) payload = result.choices[0]?.message?.content
  if (typeof payload === 'string') {
    const start = payload.indexOf('{')
    const end = payload.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      payload = JSON.parse(payload.slice(start, end + 1))
    } catch {
      return null
    }
  }
  if (!payload || typeof payload !== 'object') return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v.trim()
  }
  return out
}

export const onRequestPost: (context: {
  request: Request
  env: Env
  waitUntil: (promise: Promise<unknown>) => void
}) => Promise<Response> = async ({ request, env, waitUntil }) => {
  let body: LookupRequest
  try {
    body = await request.json() as LookupRequest
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400)
  }

  const sentence = typeof body.sentence === 'string' ? body.sentence.slice(0, MAX_SENTENCE_LENGTH) : ''
  const word = normalizeTerm(typeof body.word === 'string' ? body.word : '')
  const tokens = tokenizeSentence(sentence).map(t => normalizeTerm(t.text))
  let wordIndex = Number.isInteger(body.wordIndex) ? body.wordIndex : -1
  if (tokens[wordIndex] !== word) wordIndex = tokens.indexOf(word)

  if (!word || !sentence || wordIndex < 0) {
    return json({ error: '缺少 word / sentence，或 word 不在 sentence 中' }, 400)
  }

  const origin = new URL(request.url).origin
  const candidates = phraseCandidates(tokens, wordIndex)
  const entries = await loadShards(env, origin, new Set(candidates.map(shardKey)))
  const known = candidates.filter(c => entries.has(c))
  if (!known.includes(word) && entries.has(word)) known.push(word)

  const cacheKey = new Request(
    `${origin}/__lookup/${MODEL_VERSION}/${encodeURIComponent(word)}/${wordIndex}/${encodeURIComponent(sentence)}`,
  )
  const cache = caches.default
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  if (await overRateLimit(request.headers.get('CF-Connecting-IP') ?? 'unknown')) {
    return json({ ...dictionaryFallback(word, entries), reason: 'rate-limited' }, 429)
  }

  const userPrompt = [
    `英文原句：${sentence}`,
    body.sentenceZh ? `参考中文字幕：${body.sentenceZh}` : '',
    `被点击的词：${word}（句中第 ${wordIndex} 个词，从 0 开始计数）`,
    '候选 term（只能从中选一个）：',
    ...(known.length ? known : [word]).map(c => {
      const senses = entries.get(c)?.senses.slice(0, 4).map(s => `${s.pos}${s.zh}`).join(' / ')
      return `- ${c}${senses ? `：${senses}` : ''}`
    }),
  ].filter(Boolean).join('\n')

  let parsed: Record<string, string> | null = null
  try {
    const raw = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 400,
      temperature: 0.1,
      response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
    })
    parsed = parseModelOutput(raw)
  } catch (error) {
    console.error('workers-ai lookup failed', { word, message: String(error) })
  }

  const allowed = new Set((known.length ? known : [word]).map(normalizeTerm))
  const term = parsed && allowed.has(normalizeTerm(parsed.term ?? '')) ? normalizeTerm(parsed.term) : word
  if (!parsed?.contextMeaning) {
    // 模型不可用或输出不合规：降级为词典义项，且不写长期缓存
    return json({ ...dictionaryFallback(word, entries), reason: 'ai-unavailable' }, 200)
  }

  const entry = pickDictEntry(entries, term)
  const result: LookupResult = {
    term,
    lemma: normalizeTerm(parsed.lemma || entry?.lemma || term),
    phonetic: entry?.ph ?? '',
    partOfSpeech: parsed.partOfSpeech ?? '',
    contextMeaning: parsed.contextMeaning,
    explanation: parsed.explanation ?? '',
    otherMeanings: toOtherMeanings(entry, parsed.contextMeaning),
    source: 'ai',
  }

  const response = json(result, 200, CACHE_TTL_SECONDS)
  waitUntil(cache.put(cacheKey, response.clone()))
  return response
}
