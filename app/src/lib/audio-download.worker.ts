/// <reference lib="webworker" />
import {
  AUDIO_CHUNK_BYTES, AUDIO_CHUNK_CACHE, LEGACY_AUDIO_CACHE,
  audioChunkKey, deleteAudio, listAudioMeta, readAudioMeta, writeAudioMeta,
} from './audio-cache'
import type { AudioCacheMeta, AudioWorkerReply, AudioWorkerRequest } from './audio-cache'

declare const self: DedicatedWorkerGlobalScope
interface Job {
  controller: AbortController
  rangeController: AbortController | null
  paused: boolean
  pinned: boolean
  resume: (() => void) | null
  slug: string
  url: string
  finished: Promise<void>
}
const jobs = new Map<number, Job>()
let mutations: Promise<void> = Promise.resolve()
const AUTO_BUDGET = 1024 * 1024 * 1024

function send(message: AudioWorkerReply) { self.postMessage(message) }
function check(job: Job) { job.controller.signal.throwIfAborted() }
async function ready(job: Job) {
  check(job)
  while (job.paused) {
    await new Promise<void>(resolve => { job.resume = resolve })
    check(job)
  }
}

async function makeRoom(cache: Cache, meta: AudioCacheMeta) {
  if (meta.pinned) return
  if (meta.bytes > AUTO_BUDGET) throw new Error('音频超过自动保存容量，请手动下载')
  const entries = await listAudioMeta(cache)
  let autoBytes = entries.filter(e => !e.pinned && e.url !== meta.url).reduce((sum, e) => sum + e.bytes, meta.bytes)
  const estimate = await self.navigator.storage?.estimate?.()
  let free = estimate?.quota ? estimate.quota - (estimate.usage ?? 0) : Infinity
  // 手动下载一直保留；自动缓存最多 1 GB，配额吃紧时先清最早的自动缓存。
  for (const entry of entries.filter(e => !e.pinned && e.url !== meta.url).sort((a, b) => a.at - b.at)) {
    if (autoBytes <= AUTO_BUDGET && free > meta.bytes + 32 * 1024 * 1024) break
    await deleteAudio(cache, entry)
    autoBytes -= entry.bytes
    free += entry.bytes
  }
}

async function rangeBlob(url: string, meta: AudioCacheMeta, offset: number, job: Job): Promise<Blob> {
  const end = Math.min(meta.bytes, offset + AUDIO_CHUNK_BYTES) - 1
  for (;;) {
    await ready(job)
    const controller = new AbortController()
    job.rangeController = controller
    const cancel = () => controller.abort()
    job.controller.signal.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error('音频下载超时，请重试')), 120_000)
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=${offset}-${end}`, ...(meta.etag ? { 'If-Range': meta.etag } : {}) },
        signal: controller.signal,
      })
      const expected = `bytes ${offset}-${end}/${meta.bytes}`
      if (response.status !== 206 || response.headers.get('Content-Range') !== expected) {
        await response.body?.cancel()
        throw new Error(`音频分段下载失败（HTTP ${response.status}）`)
      }
      const blob = await response.blob()
      check(job)
      if (blob.size !== end - offset + 1) throw new Error('音频片段不完整，请重试')
      return blob
    } catch (error) {
      check(job)
      if (controller.signal.reason !== 'playback-priority') throw error
      // 缓冲时中止当前网络片段，把带宽让给播放器；已写盘的片段仍保留。
    } finally {
      clearTimeout(timeout)
      job.controller.signal.removeEventListener('abort', cancel)
      job.rangeController = null
    }
  }
}

async function download(message: Extract<AudioWorkerRequest, { action: 'download' }>, job: Job) {
  const cache = await caches.open(AUDIO_CHUNK_CACHE)
  let meta = await readAudioMeta(cache, message.url)
  if (!meta) {
    await ready(job)
    const response = await fetch(message.url, { method: 'HEAD', signal: job.controller.signal })
    const bytes = Number(response.headers.get('Content-Length'))
    if (!response.ok || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('无法获取音频大小，请重试')
    meta = {
      url: message.url, slug: message.slug, quality: message.quality, bytes,
      type: response.headers.get('Content-Type') ?? 'audio/mpeg', etag: response.headers.get('ETag'),
      complete: false, pinned: message.pinned, at: Date.now(),
    }
    check(job)
    await makeRoom(cache, meta)
    await writeAudioMeta(cache, meta)
  }
  meta.pinned ||= job.pinned
  meta.at = Date.now()
  if (meta.complete) {
    await writeAudioMeta(cache, meta)
    check(job)
    send({ id: message.id, event: 'complete', meta })
    return
  }
  let received = 0
  const progress = () => send({ id: message.id, event: 'progress', status: {
    state: job.paused ? 'paused' : 'downloading', received, total: meta.bytes,
  } })
  progress()
  for (let offset = 0; offset < meta.bytes; offset += AUDIO_CHUNK_BYTES) {
    await ready(job)
    const key = audioChunkKey(meta.url, offset)
    const length = Math.min(AUDIO_CHUNK_BYTES, meta.bytes - offset)
    const hit = await cache.match(key)
    if (!hit || Number(hit.headers.get('Content-Length')) !== length) {
      const blob = await rangeBlob(meta.url, meta, offset, job)
      check(job)
      // Cache Storage 不接受 206，固定片段以独立的 200 存储。
      await cache.put(key, new Response(blob, {
        headers: { 'Content-Type': meta.type, 'Content-Length': String(blob.size) },
      }))
    }
    received += length
    progress() // 每个 2 MB 片段一次，界面再限频；绝不逐网络包 setState。
  }
  check(job)
  meta.complete = true
  meta.pinned ||= job.pinned
  await writeAudioMeta(cache, meta)
  check(job)
  send({ id: message.id, event: 'complete', meta })
}

async function readBlob(url: string): Promise<Blob | undefined> {
  const cache = await caches.open(AUDIO_CHUNK_CACHE)
  const meta = await readAudioMeta(cache, url)
  if (meta?.complete) {
    const parts: Blob[] = []
    for (let offset = 0; offset < meta.bytes; offset += AUDIO_CHUNK_BYTES) {
      const hit = await cache.match(audioChunkKey(url, offset))
      if (!hit) throw new Error('本地音频已缺失')
      parts.push(await hit.blob())
    }
    return new Blob(parts, { type: meta.type })
  }
  return (await (await caches.open(LEGACY_AUDIO_CACHE)).match(url))?.blob()
}

self.addEventListener('message', event => {
  const message = event.data as AudioWorkerRequest
  const job = jobs.get(message.id)
  if (message.action === 'pin') { if (job) job.pinned = true; return }
  if (message.action === 'pause') {
    if (job) {
      job.paused = message.paused
      if (message.paused && message.urgent) job.rangeController?.abort('playback-priority')
      if (!message.paused) { job.resume?.(); job.resume = null }
    }
    return
  }
  if (message.action === 'cancel') {
    job?.controller.abort()
    job?.rangeController?.abort()
    job?.resume?.()
    return
  }
  if (message.action === 'download') {
    const next: Job = { controller: new AbortController(), rangeController: null, paused: message.paused, pinned: message.pinned,
      resume: null, slug: message.slug, url: message.url, finished: Promise.resolve() }
    jobs.set(message.id, next)
    next.finished = download(message, next)
      .catch(error => send({ id: message.id, event: 'error', error: error instanceof Error ? error.message : String(error) }))
      .finally(() => jobs.delete(message.id))
    return
  }
  const operation = async () => {
    if (message.action === 'remove') {
      // 等正在写盘的片段收尾，防止“全部删除”之后旧任务又写出孤儿文件。
      const active = Array.from(jobs.values()).filter(job => message.url ? job.url === message.url : !message.slug || job.slug === message.slug)
      for (const job of active) { job.controller.abort(); job.rangeController?.abort(); job.resume?.() }
      await Promise.all(active.map(job => job.finished))
    }
    const cache = await caches.open(AUDIO_CHUNK_CACHE)
    if (message.action === 'list') {
      send({ id: message.id, event: 'result', entries: (await listAudioMeta(cache)).filter(e => e.complete) })
    } else if (message.action === 'blob') {
      send({ id: message.id, event: 'result', blob: await readBlob(message.url) })
    } else if (message.action === 'keep') {
      const meta = await readAudioMeta(cache, message.url)
      if (!meta?.complete) throw new Error('音频尚未保存完整，请继续下载')
      meta.pinned = true
      await writeAudioMeta(cache, meta)
      send({ id: message.id, event: 'complete', meta })
    } else if (message.action === 'remove') {
      for (const entry of await listAudioMeta(cache)) {
        if (message.url ? entry.url === message.url : !message.slug || entry.slug === message.slug) await deleteAudio(cache, entry)
      }
      if (!message.slug && !message.url) {
        await caches.delete(AUDIO_CHUNK_CACHE)
        await caches.delete(LEGACY_AUDIO_CACHE)
      }
      send({ id: message.id, event: 'result' })
    }
  }
  const failed = (error: unknown) => send({ id: message.id, event: 'error', error: error instanceof Error ? error.message : String(error) })
  if (message.action === 'keep' || message.action === 'remove') {
    // 保留与删除必须按点击顺序执行，避免删除后晚到的保留操作复活完成标记。
    mutations = mutations.then(operation).catch(failed)
  } else void operation().catch(failed)
})
