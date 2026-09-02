/**
 * 离线音频。
 *
 * 音频存在 Cache Storage 里，播放时换成 blob: 地址直接喂给 <audio>，
 * 不走 Service Worker 拦截——iOS Safari 对 media 元素请求是否经过 SW 一直不可靠，
 * blob: 则百分之百可用，而且原生支持 seek。
 *
 * 关键约束：playTalk 会在点击回调里同步调用 audio.play()，一旦 await 就丢掉用户手势、
 * iOS 会拒绝播放。所以地址查询必须同步——启动时把已下载音频的 objectURL 预热进内存表，
 * 之后 offlineSource() 只读表。
 */
import type { AudioQuality } from './types'

const CACHE_NAME = 'offline-audio-v1'
const INDEX_KEY = 'dtl.offline'

export const OFFLINE_EVENT = 'dtl-offline'

export interface OfflineEntry {
  slug: string
  quality: AudioQuality
  /** 媒体源地址，用来在 Cache Storage 里定位 */
  url: string
  bytes: number
  at: number
}

export type OfflineIndex = Record<string, OfflineEntry>

/** 媒体源地址 -> blob: 地址。只在本模块内维护，随下载/删除同步增删 */
const blobUrls = new Map<string, string>()

function notify() {
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT))
}

export function loadOfflineIndex(): OfflineIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    return raw ? (JSON.parse(raw) as OfflineIndex) : {}
  } catch {
    return {}
  }
}

function saveOfflineIndex(index: OfflineIndex) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch (error) {
    console.error('offline index write failed', error)
  }
  notify()
}

export function isDownloaded(slug: string): boolean {
  return slug in loadOfflineIndex()
}

export function offlineBytes(): number {
  return Object.values(loadOfflineIndex()).reduce((sum, e) => sum + e.bytes, 0)
}

/** 同步查离线地址；没有就返回 null，调用方回落到网络地址 */
export function offlineSource(url: string): string | null {
  return blobUrls.get(url) ?? null
}

function supported(): boolean {
  return typeof caches !== 'undefined'
}

/**
 * 启动时预热。把已下载音频读成 blob: 地址，之后播放才能同步拿到。
 * 索引与实际缓存对不上（用户在系统设置里清了站点数据）时顺手修正索引。
 */
export async function initOffline(): Promise<void> {
  if (!supported()) return
  const index = loadOfflineIndex()
  const slugs = Object.keys(index)
  if (slugs.length === 0) return

  let cache: Cache
  try {
    cache = await caches.open(CACHE_NAME)
  } catch (error) {
    console.error('offline cache open failed', error)
    return
  }

  const missing: string[] = []
  await Promise.all(slugs.map(async slug => {
    const entry = index[slug]
    try {
      const hit = await cache.match(entry.url)
      if (!hit) {
        missing.push(slug)
        return
      }
      blobUrls.set(entry.url, URL.createObjectURL(await hit.blob()))
    } catch (error) {
      console.error('offline warm failed', slug, error)
      missing.push(slug)
    }
  }))

  if (missing.length) {
    for (const slug of missing) delete index[slug]
    saveOfflineIndex(index)
    console.warn(`离线音频缺失 ${missing.length} 篇，已从索引移除`, missing)
  } else if (blobUrls.size) {
    notify()
  }
}

export type DownloadProgress = (received: number, total: number) => void

/**
 * 下载一篇的音频。走 CORS fetch 拿可读响应（媒体源开了 Access-Control-Allow-Origin: *），
 * 边读边报进度，读完整体写进 Cache Storage。
 */
export async function downloadTalk(
  slug: string,
  quality: AudioQuality,
  url: string,
  onProgress?: DownloadProgress,
  signal?: AbortSignal,
): Promise<void> {
  if (!supported()) throw new Error('当前浏览器不支持离线缓存')

  const response = await fetch(url, { mode: 'cors', signal })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`)

  const total = Number(response.headers.get('Content-Length') ?? 0)
  const contentType = response.headers.get('Content-Type') ?? 'audio/mp4'

  let blob: Blob
  if (response.body && onProgress) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      onProgress(received, total)
    }
    blob = new Blob(chunks as BlobPart[], { type: contentType })
  } else {
    blob = await response.blob()
  }

  const cache = await caches.open(CACHE_NAME)
  await cache.put(url, new Response(blob, {
    headers: { 'Content-Type': contentType, 'Content-Length': String(blob.size) },
  }))

  const previous = blobUrls.get(url)
  if (previous) URL.revokeObjectURL(previous)
  blobUrls.set(url, URL.createObjectURL(blob))

  const index = loadOfflineIndex()
  index[slug] = { slug, quality, url, bytes: blob.size, at: Date.now() }
  saveOfflineIndex(index)
}

export async function removeTalk(slug: string): Promise<void> {
  const index = loadOfflineIndex()
  const entry = index[slug]
  if (!entry) return

  const objectUrl = blobUrls.get(entry.url)
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    blobUrls.delete(entry.url)
  }
  if (supported()) {
    try {
      const cache = await caches.open(CACHE_NAME)
      await cache.delete(entry.url)
    } catch (error) {
      console.error('offline delete failed', slug, error)
    }
  }
  delete index[slug]
  saveOfflineIndex(index)
}

export async function removeAll(): Promise<void> {
  for (const url of blobUrls.values()) URL.revokeObjectURL(url)
  blobUrls.clear()
  if (supported()) {
    try {
      await caches.delete(CACHE_NAME)
    } catch (error) {
      console.error('offline cache clear failed', error)
    }
  }
  saveOfflineIndex({})
}

/** 浏览器给本站的存储配额，用来提示"还能存多少" */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

export { CACHE_NAME as OFFLINE_CACHE_NAME }
