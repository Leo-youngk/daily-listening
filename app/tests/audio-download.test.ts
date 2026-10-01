import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUDIO_CHUNK_BYTES, AUDIO_CHUNK_CACHE, audioChunkKey, readAudioMeta, writeAudioMeta,
} from '../src/lib/audio-cache'
import type { AudioCacheMeta, AudioWorkerReply, AudioWorkerRequest } from '../src/lib/audio-cache'
import { memoryCaches } from './helpers/audio-cache'

const url = 'https://example.test/audio/v1/standard/long-podcast.mp3'
const bytes = AUDIO_CHUNK_BYTES * 2 + 9
let receive: (event: { data: AudioWorkerRequest }) => void
let replies: AudioWorkerReply[]
let ranges: string[]
let failAt: number | null

function send(message: AudioWorkerRequest) { receive({ data: message }) }
async function finished(id: number) {
  await vi.waitFor(() => expect(replies.some(reply => reply.id === id && reply.event !== 'progress')).toBe(true))
  return replies.find(reply => reply.id === id && reply.event !== 'progress')!
}
function download(id: number, pinned = false, paused = false) {
  send({ id, action: 'download', url, slug: 'long-podcast', quality: 'standard', pinned, paused })
}

describe('长音频后台续存', () => {
  beforeEach(async () => {
    vi.resetModules()
    replies = []; ranges = []; failAt = null
    vi.stubGlobal('caches', memoryCaches())
    vi.stubGlobal('self', {
      navigator: { storage: { estimate: async () => ({ usage: 0, quota: 2 ** 32 }) } },
      postMessage: (reply: AudioWorkerReply) => replies.push(reply),
      addEventListener: (_: string, handler: typeof receive) => { receive = handler },
    })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === 'HEAD') return new Response(null, { headers: {
        'Content-Length': String(bytes), 'Content-Type': 'audio/mpeg', ETag: '"unchanged"',
      } })
      const range = new Headers(options.headers).get('Range')!
      ranges.push(range)
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!
      if (Number(start) === failAt) throw new Error('网络中断')
      const data = new Uint8Array(Number(end) - Number(start) + 1).fill(Number(start) / AUDIO_CHUNK_BYTES + 1)
      return new Response(data, { status: 206, headers: { 'Content-Range': `${range.replace('=', ' ')}/${bytes}` } })
    }))
    await import('../src/lib/audio-download.worker')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('首存按固定片段落盘，保存完整后才发布完成标记', async () => {
    download(1)
    expect((await finished(1)).event).toBe('complete')
    expect(ranges).toEqual([`bytes=0-${AUDIO_CHUNK_BYTES - 1}`, `bytes=${AUDIO_CHUNK_BYTES}-${AUDIO_CHUNK_BYTES * 2 - 1}`, `bytes=${AUDIO_CHUNK_BYTES * 2}-${bytes - 1}`])
    expect((await readAudioMeta(await caches.open(AUDIO_CHUNK_CACHE), url))?.complete).toBe(true)
  })

  it('网络中断后重新开始，只请求缺失片段，已经存好的开头不会重下', async () => {
    failAt = AUDIO_CHUNK_BYTES
    download(1)
    expect((await finished(1)).event).toBe('error')
    const cache = await caches.open(AUDIO_CHUNK_CACHE)
    expect((await readAudioMeta(cache, url))?.complete).toBe(false)
    expect(await cache.match(audioChunkKey(url, 0))).toBeDefined()
    ranges = []; failAt = null
    download(2)
    expect((await finished(2)).event).toBe('complete')
    expect(ranges).toEqual([`bytes=${AUDIO_CHUNK_BYTES}-${AUDIO_CHUNK_BYTES * 2 - 1}`, `bytes=${AUDIO_CHUNK_BYTES * 2}-${bytes - 1}`])
  })

  it('等待播放缓冲时不抢网络，取消后任务结束且半份缓存不标为完整', async () => {
    const meta: AudioCacheMeta = { url, slug: 'long-podcast', quality: 'standard', bytes,
      type: 'audio/mpeg', etag: null, complete: false, pinned: false, at: 1 }
    await writeAudioMeta(await caches.open(AUDIO_CHUNK_CACHE), meta)
    download(1, false, true)
    await vi.waitFor(() => expect(replies.some(reply => reply.id === 1 && reply.event === 'progress')).toBe(true))
    expect(ranges).toEqual([])
    send({ id: 1, action: 'cancel' })
    expect((await finished(1)).event).toBe('error')
    expect((await readAudioMeta(await caches.open(AUDIO_CHUNK_CACHE), url))?.complete).toBe(false)
  })

  it('已存好的音频点保留不会重新下载，保留状态持久化', async () => {
    download(1)
    await finished(1)
    ranges = []
    download(2, true)
    expect((await finished(2)).event).toBe('complete')
    expect(ranges).toEqual([])
    expect((await readAudioMeta(await caches.open(AUDIO_CHUNK_CACHE), url))?.pinned).toBe(true)
  })

  it('删除一集同时清掉完整文件与未完成片段，其他集保持可用', async () => {
    download(1)
    await finished(1)
    const cache = await caches.open(AUDIO_CHUNK_CACHE)
    await writeAudioMeta(cache, { url: `${url}?other`, slug: 'other', quality: 'standard', bytes: 10,
      type: 'audio/mpeg', etag: null, complete: false, pinned: true, at: 1 })
    send({ id: 2, action: 'remove', slug: 'long-podcast' })
    await finished(2)
    expect(await readAudioMeta(cache, url)).toBeNull()
    expect(await cache.match(audioChunkKey(url, 0))).toBeUndefined()
    expect(await readAudioMeta(cache, `${url}?other`)).not.toBeNull()
  })
})
