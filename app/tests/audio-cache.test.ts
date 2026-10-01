import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUDIO_CHUNK_BYTES, AUDIO_CHUNK_CACHE, audioChunkKey, cachedAudioResponse, parseAudioRange, writeAudioMeta,
} from '../src/lib/audio-cache'
import { memoryCaches } from './helpers/audio-cache'

const url = 'https://example.test/audio/v1/standard/long-podcast.mp3'

describe('本地音频 Range 播放', () => {
  beforeEach(() => vi.stubGlobal('caches', memoryCaches()))
  afterEach(() => vi.unstubAllGlobals())

  it('只读取 Range 所需的片段，跨片段的字节准确，不读取整集', async () => {
    const cache = await caches.open(AUDIO_CHUNK_CACHE)
    await writeAudioMeta(cache, { url, slug: 'long-podcast', quality: 'standard', bytes: AUDIO_CHUNK_BYTES * 3,
      type: 'audio/mpeg', etag: '"v1"', complete: true, pinned: false, at: 1 })
    await cache.put(audioChunkKey(url, AUDIO_CHUNK_BYTES), new Response(new Uint8Array(AUDIO_CHUNK_BYTES).fill(17)))
    await cache.put(audioChunkKey(url, AUDIO_CHUNK_BYTES * 2), new Response(new Uint8Array(AUDIO_CHUNK_BYTES).fill(29)))
    // 第一片故意不存在：播放末尾不能读到它，更不能要求整集已读入内存。
    const response = await cachedAudioResponse(new Request(url, { headers: {
      Range: `bytes=${AUDIO_CHUNK_BYTES * 2 - 3}-${AUDIO_CHUNK_BYTES * 2 + 2}`,
    } }))
    expect(response?.status).toBe(206)
    expect(response?.headers.get('Content-Length')).toBe('6')
    expect(response?.headers.get('Content-Range')).toBe(`bytes ${AUDIO_CHUNK_BYTES * 2 - 3}-${AUDIO_CHUNK_BYTES * 2 + 2}/${AUDIO_CHUNK_BYTES * 3}`)
    expect(Array.from(new Uint8Array(await response!.arrayBuffer()))).toEqual([17, 17, 17, 29, 29, 29])
  })

  it('未完成的缓存回落网络，不把半份文件伪装成完整音频', async () => {
    await writeAudioMeta(await caches.open(AUDIO_CHUNK_CACHE), {
      url, slug: 'long-podcast', quality: 'standard', bytes: 10, type: 'audio/mpeg', etag: null,
      complete: false, pinned: false, at: 1,
    })
    expect(await cachedAudioResponse(new Request(url, { headers: { Range: 'bytes=0-1' } }))).toBeNull()
  })

  it('未下完也能复用已存开头，206 正确说明实际范围与整集大小', async () => {
    const cache = await caches.open(AUDIO_CHUNK_CACHE)
    await writeAudioMeta(cache, { url, slug: 'long-podcast', quality: 'standard', bytes: AUDIO_CHUNK_BYTES * 2,
      type: 'audio/mpeg', etag: null, complete: false, pinned: false, at: 1 })
    await cache.put(audioChunkKey(url, 0), new Response(new Uint8Array(AUDIO_CHUNK_BYTES), {
      headers: { 'Content-Length': String(AUDIO_CHUNK_BYTES) },
    }))
    const response = await cachedAudioResponse(new Request(url, { headers: { Range: 'bytes=0-' } }))
    expect(response?.status).toBe(206)
    expect(response?.headers.get('Content-Length')).toBe(String(AUDIO_CHUNK_BYTES))
    expect(response?.headers.get('Content-Range')).toBe(`bytes 0-${AUDIO_CHUNK_BYTES - 1}/${AUDIO_CHUNK_BYTES * 2}`)
    expect((await response!.arrayBuffer()).byteLength).toBe(AUDIO_CHUNK_BYTES)
    expect(await cachedAudioResponse(new Request(url, { headers: { Range: `bytes=${AUDIO_CHUNK_BYTES}-` } }))).toBeNull()
  })

  it('完成标记存在但起始片段已被系统清掉时回落网络', async () => {
    await writeAudioMeta(await caches.open(AUDIO_CHUNK_CACHE), {
      url, slug: 'long-podcast', quality: 'standard', bytes: 10, type: 'audio/mpeg', etag: null,
      complete: true, pinned: false, at: 1,
    })
    expect(await cachedAudioResponse(new Request(url))).toBeNull()
  })

  it.each([
    ['bytes=0-1', { start: 0, end: 1 }],
    ['bytes=5-', { start: 5, end: 9 }],
    ['bytes=-2', { start: 8, end: 9 }],
    ['bytes=0-999', { start: 0, end: 9 }],
    ['bytes=10-', null], ['bytes=5-2', null], ['bytes=-0', null], ['bytes=0-1,4-5', null],
  ])('正确处理 Safari Range %s', (header, expected) => expect(parseAudioRange(header, 10)).toEqual(expected))
})
