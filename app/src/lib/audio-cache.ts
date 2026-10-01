import type { AudioQuality } from './types'

// 固定大小的持久片段；只在 Worker / Service Worker 内读取音频字节。
export const AUDIO_CHUNK_CACHE = 'audio-chunks-v2'
export const LEGACY_AUDIO_CACHE = 'offline-audio-v1'
export const AUDIO_CHUNK_BYTES = 2 * 1024 * 1024

export interface AudioCacheMeta {
  url: string
  slug: string
  quality: AudioQuality
  bytes: number
  type: string
  etag: string | null
  complete: boolean
  pinned: boolean
  at: number
}

export type DownloadState = 'queued' | 'downloading' | 'paused' | 'complete' | 'error'
export interface AudioDownloadStatus {
  state: DownloadState
  received: number
  total: number
  error?: string
}

export type AudioWorkerRequest =
  | { id: number; action: 'download'; url: string; slug: string; quality: AudioQuality; pinned: boolean; paused: boolean }
  | { id: number; action: 'pause'; paused: boolean; urgent?: boolean }
  | { id: number; action: 'pin' }
  | { id: number; action: 'keep'; url: string }
  | { id: number; action: 'cancel' }
  | { id: number; action: 'list' }
  | { id: number; action: 'remove'; slug?: string; url?: string }
  | { id: number; action: 'blob'; url: string }

export type AudioWorkerReply =
  | { id: number; event: 'progress'; status: AudioDownloadStatus }
  | { id: number; event: 'complete'; meta: AudioCacheMeta }
  | { id: number; event: 'result'; entries?: AudioCacheMeta[]; blob?: Blob }
  | { id: number; event: 'error'; error: string }

export function audioMetaKey(url: string): string {
  const key = new URL(url)
  key.searchParams.set('__dtl_audio', 'meta')
  return key.href
}

export function audioChunkKey(url: string, offset: number): string {
  const key = new URL(url)
  key.searchParams.set('__dtl_audio', String(offset))
  return key.href
}

export async function readAudioMeta(cache: Cache, url: string): Promise<AudioCacheMeta | null> {
  const hit = await cache.match(audioMetaKey(url))
  if (!hit) return null
  try {
    const meta = await hit.json() as AudioCacheMeta
    return meta.url === url && Number.isSafeInteger(meta.bytes) && meta.bytes > 0 ? meta : null
  } catch {
    return null
  }
}

export async function writeAudioMeta(cache: Cache, meta: AudioCacheMeta): Promise<void> {
  await cache.put(audioMetaKey(meta.url), new Response(JSON.stringify(meta), {
    headers: { 'Content-Type': 'application/json' },
  }))
}

export async function listAudioMeta(cache: Cache): Promise<AudioCacheMeta[]> {
  const entries: AudioCacheMeta[] = []
  for (const key of await cache.keys()) {
    if (new URL(key.url).searchParams.get('__dtl_audio') !== 'meta') continue
    const hit = await cache.match(key)
    if (!hit) continue
    try { entries.push(await hit.json() as AudioCacheMeta) } catch { /* 忽略损坏的索引 */ }
  }
  return entries
}

export async function deleteAudio(cache: Cache, meta: AudioCacheMeta): Promise<void> {
  // 先移除完成标记，播放请求就会回落网络；不能把半份文件误当成完整缓存。
  await cache.delete(audioMetaKey(meta.url))
  for (let offset = 0; offset < meta.bytes; offset += AUDIO_CHUNK_BYTES) {
    await cache.delete(audioChunkKey(meta.url, offset))
  }
}

/** Range 结束位置包含在内；拒绝多段、倒序、零长度和超界请求。 */
export function parseAudioRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return { start: 0, end: size - 1 }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    const length = Number(match[2])
    if (!Number.isSafeInteger(length) || length <= 0) return null
    return { start: Math.max(0, size - length), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null
  return { start, end }
}

/** 从磁盘只读本次 Range 涉及的片段，并按媒体消费者的读取速度输出。 */
export async function cachedAudioResponse(request: Request): Promise<Response | null> {
  const cache = await caches.open(AUDIO_CHUNK_CACHE)
  const meta = await readAudioMeta(cache, request.url)
  if (!meta) return null
  const ifRange = request.headers.get('If-Range')
  if (ifRange && ifRange !== meta.etag) return null
  const range = parseAudioRange(request.headers.get('Range'), meta.bytes)
  if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${meta.bytes}` } })
  const firstOffset = Math.floor(range.start / AUDIO_CHUNK_BYTES) * AUDIO_CHUNK_BYTES
  let first = await cache.match(audioChunkKey(meta.url, firstOffset))
  if (!first) return null
  // 半份缓存也能复用已存片段。返回一个完整、长度明确的 206，
  // 媒体元素会再请求后续范围；缺失的后续范围正常回落网络。
  if (!meta.complete) {
    if (!request.headers.has('Range')) return null
    const length = Number(first.headers.get('Content-Length'))
    if (!Number.isSafeInteger(length) || length <= 0) return null
    range.end = Math.min(range.end, firstOffset + length - 1)
  }
  const headers = new Headers({
    'Content-Type': meta.type,
    'Content-Length': String(range.end - range.start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
  if (meta.etag) headers.set('ETag', meta.etag)
  const partial = request.headers.has('Range')
  if (partial) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${meta.bytes}`)
  if (request.method === 'HEAD') return new Response(null, { headers })

  let position = range.start
  // 初始片段已经被系统清掉时直接回落网络，不发出一个无法读取的 206。
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const offset = Math.floor(position / AUDIO_CHUNK_BYTES) * AUDIO_CHUNK_BYTES
        const hit = first ?? await cache.match(audioChunkKey(meta.url, offset))
        first = undefined
        if (!hit) throw new Error('本地音频片段缺失，请联网重试')
        const blob = await hit.blob()
        const end = Math.min(range.end + 1, offset + blob.size)
        if (end <= position) throw new Error('本地音频片段损坏，请联网重试')
        controller.enqueue(new Uint8Array(await blob.slice(position - offset, end - offset).arrayBuffer()))
        position = end
        if (position > range.end) controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  }, { highWaterMark: 0 })
  return new Response(stream, { status: partial ? 206 : 200, headers })
}
