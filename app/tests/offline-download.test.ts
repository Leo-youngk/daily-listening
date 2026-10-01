import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioCacheMeta, AudioWorkerReply, AudioWorkerRequest } from '../src/lib/audio-cache'
import { LEGACY_AUDIO_CACHE } from '../src/lib/audio-cache'
import { memoryCaches } from './helpers/audio-cache'

const messages: AudioWorkerRequest[] = []
let current: MockWorker
class MockWorker {
  onmessage: ((event: MessageEvent<AudioWorkerReply>) => void) | null = null
  onerror = null
  meta: AudioCacheMeta | null = null
  constructor() { current = this }
  terminate() {}
  reply(data: AudioWorkerReply) { queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<AudioWorkerReply>)) }
  postMessage(message: AudioWorkerRequest) {
    messages.push(message)
    if (message.action === 'list') this.reply({ id: message.id, event: 'result', entries: this.meta ? [this.meta] : [] })
    if (message.action === 'keep') {
      this.meta!.pinned = true
      this.reply({ id: message.id, event: 'complete', meta: this.meta! })
    }
  }
}

describe('界面缓存调度', () => {
  beforeEach(() => {
    vi.resetModules(); localStorage.clear(); messages.length = 0
    vi.stubGlobal('caches', memoryCaches())
    vi.stubGlobal('Worker', MockWorker)
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('启动校验旧下载只看索引，不读取任何整集 body', async () => {
    const url = 'https://old-audio.example/retired/a.m4a'
    localStorage.setItem('dtl.offline', JSON.stringify({ a: { slug: 'a', quality: 'standard', url, bytes: 100_000_000, at: 1 } }))
    await (await caches.open(LEGACY_AUDIO_CACHE)).put(url, new Response('旧下载'))
    const body = vi.spyOn(Response.prototype, 'blob')
    const { initOffline, loadOfflineIndex } = await import('../src/lib/offline')
    await initOffline()
    expect(body).not.toHaveBeenCalled()
    expect(loadOfflineIndex().a.url).toBe(url)
  })

  it('手动下载复用自动下载，只发一个下载任务；刚完成时点保留也能持久保存', async () => {
    const { cacheTalkForReplay, downloadTalk, loadOfflineIndex } = await import('../src/lib/offline')
    const url = '/audio/v1/standard/long-podcast.mp3'
    cacheTalkForReplay('long-podcast', 'standard', url)
    const manual = downloadTalk('long-podcast', 'standard', url)
    const downloads = messages.filter(message => message.action === 'download')
    expect(downloads).toHaveLength(1)
    const job = downloads[0] as Extract<AudioWorkerRequest, { action: 'download' }>
    // 故意模拟后台已经完成、未赶上 pin 控制消息的情况。
    current.meta = { url: job.url, slug: job.slug, quality: job.quality, bytes: 100,
      type: 'audio/mpeg', etag: null, complete: true, pinned: false, at: 1 }
    current.reply({ id: job.id, event: 'complete', meta: current.meta })
    await manual
    expect(loadOfflineIndex()['long-podcast'].pinned).toBe(true)
    expect(current.meta.pinned).toBe(true)
    expect(messages.filter(message => message.action === 'download')).toHaveLength(1)
  })
})
