/**
 * 音频自动保存与离线管理。界面只持有小索引，不读取整集音频字节。
 * Worker 按 2 MB 片段续存，Service Worker 按媒体的 Range 请求读取本地片段。
 * audio.play() 仍在点击回调同步调用，保留 iOS 的用户播放权限。
 */
import type { AudioQuality } from './types'
import { AUDIO_CHUNK_CACHE, LEGACY_AUDIO_CACHE } from './audio-cache'
import type { AudioCacheMeta, AudioDownloadStatus, AudioWorkerReply, AudioWorkerRequest } from './audio-cache'

const INDEX_KEY = 'dtl.offline'
export const OFFLINE_CACHE_NAME = LEGACY_AUDIO_CACHE
export const OFFLINE_EVENT = 'dtl-offline'
export const AUDIO_DOWNLOAD_EVENT = 'dtl-audio-download'
export function isPersistentCacheName(name: string): boolean {
  return name === LEGACY_AUDIO_CACHE || name === AUDIO_CHUNK_CACHE || name.startsWith('workbox-precache')
}

export interface OfflineEntry {
  slug: string
  quality: AudioQuality
  url: string
  bytes: number
  at: number
  /** 主动下载固定保留，自动缓存达到容量上限时可以清理最早的节目。 */
  pinned?: boolean
}
export type OfflineIndex = Record<string, OfflineEntry>
export type DownloadProgress = (received: number, total: number) => void

let nextId = 0
let worker: Worker | null = null
let indexRevision = 0
const latestTask = new Map<string, number>()
const pending = new Map<number, {
  resolve: (reply: AudioWorkerReply) => void
  reject: (error: Error) => void
  progress?: (status: AudioDownloadStatus) => void
}>()
interface Task {
  id: number
  slug: string
  url: string
  pinned: boolean
  paused: boolean
  controller: AbortController
  promise: Promise<void>
  progress: Set<DownloadProgress>
}
const tasks = new Map<string, Task>()
const statuses = new Map<string, AudioDownloadStatus>()
const suppressed = new Set<string>()
// 仅给尚未被 SW 接管的页面准备当前集的兼容地址，最多两份，绝不全库预热。
const blobUrls = new Map<string, string>()
const preparing = new Map<string, Promise<void>>()

function absolute(url: string) { return new URL(url, window.location.href).href }
function supported() { return typeof caches !== 'undefined' && typeof Worker !== 'undefined' }
function notify() { window.dispatchEvent(new CustomEvent(OFFLINE_EVENT)) }
function setStatus(slug: string, status: AudioDownloadStatus | null) {
  if (status) statuses.set(slug, status)
  else statuses.delete(slug)
  window.dispatchEvent(new CustomEvent(AUDIO_DOWNLOAD_EVENT, { detail: slug }))
}
function taskStatus(task: Task, status: AudioDownloadStatus | null) {
  if (latestTask.get(task.slug) === task.id) setStatus(task.slug, status)
}
export function audioDownloadStatus(slug: string): AudioDownloadStatus | null { return statuses.get(slug) ?? null }

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./audio-download.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<AudioWorkerReply>) => {
    const reply = event.data
    const waiting = pending.get(reply.id)
    if (!waiting) return
    if (reply.event === 'progress') { waiting.progress?.(reply.status); return }
    pending.delete(reply.id)
    if (reply.event === 'error') waiting.reject(new Error(reply.error))
    else waiting.resolve(reply)
  }
  worker.onerror = () => {
    for (const waiting of pending.values()) waiting.reject(new Error('音频后台缓存不可用，请重试'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}
function request(message: AudioWorkerRequest, progress?: (status: AudioDownloadStatus) => void): Promise<AudioWorkerReply> {
  return new Promise((resolve, reject) => {
    try {
      const target = getWorker()
      pending.set(message.id, { resolve, reject, progress })
      target.postMessage(message)
    } catch (error) { pending.delete(message.id); reject(error) }
  })
}

export function loadOfflineIndex(): OfflineIndex {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as OfflineIndex : {}
  } catch { return {} }
}
function saveOfflineIndex(index: OfflineIndex) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)) }
  catch (error) { console.error('offline index write failed', error) }
  notify()
}
export function isDownloaded(slug: string) { return slug in loadOfflineIndex() }
export function offlineBytes() { return Object.values(loadOfflineIndex()).reduce((sum, entry) => sum + entry.bytes, 0) }
export function offlineSource(url: string): string | null { return blobUrls.get(absolute(url)) ?? null }
export interface ResolvedOfflineSource { source: string; quality: AudioQuality }
export function offlineSourceForTalk(slug: string, preferredUrl: string, preferredQuality: AudioQuality): ResolvedOfflineSource | null {
  const direct = offlineSource(preferredUrl)
  if (direct) return { source: direct, quality: preferredQuality }
  const entry = loadOfflineIndex()[slug]
  if (!entry) return null
  const ready = offlineSource(entry.url)
  if (ready) return { source: ready, quality: entry.quality }
  // 原生媒体请求必须设置 crossorigin=anonymous，SW 才能可靠接收 Safari 的 Range 请求。
  if (navigator.serviceWorker?.controller) return { source: entry.url, quality: entry.quality }
  return null
}

/** 首次安装、SW 尚未接管时的兼容路径：只在 Worker 里读取当前集。 */
export async function prepareOfflineSource(slug: string): Promise<void> {
  const entry = loadOfflineIndex()[slug]
  if (!supported() || !entry || navigator.serviceWorker?.controller || offlineSource(entry.url)) return
  const url = absolute(entry.url)
  const existing = preparing.get(url)
  if (existing) return existing
  const promise = (async () => {
    const reply = await request({ id: ++nextId, action: 'blob', url })
    if (reply.event !== 'result' || !reply.blob || loadOfflineIndex()[slug]?.url !== entry.url) return
    while (blobUrls.size >= 2) {
      const oldest = blobUrls.keys().next().value!
      URL.revokeObjectURL(blobUrls.get(oldest)!)
      blobUrls.delete(oldest)
    }
    blobUrls.set(url, URL.createObjectURL(reply.blob))
  })().finally(() => preparing.delete(url))
  preparing.set(url, promise)
  return promise
}

/** 启动只校验索引，不读取任何音频 body；恢复下载完成后未及写入索引的文件。 */
export async function initOffline(): Promise<void> {
  if (!supported()) return
  const revision = indexRevision
  try {
    const reply = await request({ id: ++nextId, action: 'list' })
    if (reply.event !== 'result') return
    const index = loadOfflineIndex()
    const entries = reply.entries ?? []
    const cached = new Set(entries.map(entry => entry.url))
    const legacy = await caches.open(LEGACY_AUDIO_CACHE)
    for (const [slug, entry] of Object.entries(index)) {
      if (!cached.has(absolute(entry.url)) && !await legacy.match(absolute(entry.url))) delete index[slug]
    }
    for (const entry of entries.sort((a, b) => a.at - b.at)) index[entry.slug] = entry
    if (revision !== indexRevision) return
    saveOfflineIndex(index)
  } catch (error) { console.warn('offline index unavailable', error) }
}

function cancelTask(task: Task) {
  task.controller.abort()
  worker?.postMessage({ id: task.id, action: 'cancel' } satisfies AudioWorkerRequest)
  pending.get(task.id)?.reject(new DOMException('下载已取消', 'AbortError'))
  pending.delete(task.id)
}

function startDownload(slug: string, quality: AudioQuality, source: string, pinned: boolean, paused: boolean): Task {
  const url = absolute(source)
  const existing = tasks.get(url)
  if (existing && !existing.controller.signal.aborted) {
    if (pinned) {
      existing.pinned = true
      worker?.postMessage({ id: existing.id, action: 'pin' } satisfies AudioWorkerRequest)
    }
    return existing
  }
  for (const previous of tasks.values()) if (previous.slug === slug && previous.url !== url) cancelTask(previous)
  const task: Task = {
    id: ++nextId, slug, url, pinned, paused, controller: new AbortController(),
    progress: new Set(), promise: Promise.resolve(),
  }
  tasks.set(url, task)
  latestTask.set(slug, task.id)
  setStatus(slug, { state: paused ? 'paused' : 'queued', received: 0, total: 0 })
  let lastProgress = 0
  task.promise = request({ id: task.id, action: 'download', slug, quality, url, pinned, paused }, status => {
    const now = performance.now()
    if (now - lastProgress < 500 && status.received !== status.total) return
    lastProgress = now
    taskStatus(task, status)
    for (const listener of task.progress) listener(status.received, status.total)
  }).then(async reply => {
    if (reply.event !== 'complete' || task.controller.signal.aborted) return
    const meta: AudioCacheMeta = { ...reply.meta, pinned: task.pinned }
    const index = loadOfflineIndex()
    const previous = index[slug]
    index[slug] = meta
    indexRevision++
    saveOfflineIndex(index)
    taskStatus(task, { state: 'complete', received: meta.bytes, total: meta.bytes })
    // 新音质成功落盘后才删除旧音质，失败或取消不会丢掉原下载。
    if (previous && absolute(previous.url) !== url) {
      await request({ id: ++nextId, action: 'remove', url: absolute(previous.url) })
      await (await caches.open(LEGACY_AUDIO_CACHE)).delete(absolute(previous.url))
    }
    // 自动清理的旧缓存同步从界面索引移除。
    await initOffline()
  }).catch(error => {
    if (task.controller.signal.aborted) taskStatus(task, null)
    else taskStatus(task, { state: 'error', received: statuses.get(slug)?.received ?? 0, total: statuses.get(slug)?.total ?? 0,
      error: error instanceof Error ? error.message : '下载失败' })
    throw error
  }).finally(() => { if (tasks.get(url) === task) tasks.delete(url) })
  return task
}

/** 播放即加入自动保存队列；换集停止旧任务，片段继续保存在磁盘以便下次续存。 */
export function cacheTalkForReplay(slug: string, quality: AudioQuality, url: string) {
  if (!supported() || suppressed.has(slug)) return
  for (const task of tasks.values()) if (!task.pinned && task.url !== absolute(url)) cancelTask(task)
  if (loadOfflineIndex()[slug]?.url && absolute(loadOfflineIndex()[slug].url) === absolute(url)) return
  const task = startDownload(slug, quality, url, false, true)
  void task.promise.catch(() => { /* 后台缓存失败不阻断在线播放，下次收听续存 */ })
}

/** 播放缓冲不足时暂停保存，把 CPU 和带宽优先给正在听的内容。 */
export function setAudioCachePlayback(slug: string | null, mayDownload: boolean, urgent = false) {
  for (const task of tasks.values()) {
    if (task.slug !== slug || task.controller.signal.aborted) continue
    const paused = !mayDownload
    if (paused === task.paused && !urgent) continue
    task.paused = paused
    worker?.postMessage({ id: task.id, action: 'pause', paused, urgent } satisfies AudioWorkerRequest)
    const status = statuses.get(task.slug)
    if (status) setStatus(task.slug, { ...status, state: paused ? 'paused' : 'downloading' })
  }
}

export async function downloadTalk(slug: string, quality: AudioQuality, url: string, onProgress?: DownloadProgress, signal?: AbortSignal): Promise<void> {
  if (!supported()) throw new Error('当前浏览器不支持离线缓存')
  signal?.throwIfAborted()
  suppressed.delete(slug)
  const task = startDownload(slug, quality, url, true, false)
  if (onProgress) task.progress.add(onProgress)
  // 手动下载同样复用自动下载中的任务，不发出第二份整集请求。
  setAudioCachePlayback(slug, true)
  const abort = () => cancelTask(task)
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await task.promise
    task.controller.signal.throwIfAborted()
    signal?.throwIfAborted()
    // 自动保存刚完成、任务仍在同步索引时点击“保留”，也必须持久化保留状态。
    const reply = await request({ id: ++nextId, action: 'keep', url: absolute(url) })
    if (reply.event === 'complete') {
      const index = loadOfflineIndex()
      index[slug] = reply.meta
      indexRevision++
      saveOfflineIndex(index)
    }
  }
  finally { if (onProgress) task.progress.delete(onProgress); signal?.removeEventListener('abort', abort) }
}

export function cancelAudioDownload(slug: string) {
  suppressed.add(slug)
  for (const task of tasks.values()) if (task.slug === slug) cancelTask(task)
}

export async function removeTalk(slug: string): Promise<void> {
  indexRevision++
  cancelAudioDownload(slug)
  if (supported()) await request({ id: ++nextId, action: 'remove', slug })
  const index = loadOfflineIndex()
  const entry = index[slug]
  if (entry) {
    const objectUrl = blobUrls.get(absolute(entry.url))
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    blobUrls.delete(absolute(entry.url))
    if (typeof caches !== 'undefined') await (await caches.open(LEGACY_AUDIO_CACHE)).delete(absolute(entry.url))
    delete index[slug]
  }
  saveOfflineIndex(index)
  indexRevision++
  latestTask.delete(slug)
  setStatus(slug, null)
}
export async function removeAll(): Promise<void> {
  indexRevision++
  for (const slug of Object.keys(loadOfflineIndex())) suppressed.add(slug)
  for (const task of tasks.values()) { suppressed.add(task.slug); cancelTask(task) }
  if (supported()) await request({ id: ++nextId, action: 'remove' })
  for (const url of blobUrls.values()) URL.revokeObjectURL(url)
  blobUrls.clear()
  statuses.clear()
  latestTask.clear()
  indexRevision++
  saveOfflineIndex({})
}
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch { return null }
}
