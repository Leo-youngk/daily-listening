/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import { createPartialResponse } from 'workbox-range-requests'
import { cachedAudioResponse, LEGACY_AUDIO_CACHE } from './lib/audio-cache'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), {
  denylist: [/^\/api\//, /^\/audio\//, /^\/data\//, /^\/dict\//, /^\/wordbook\//, /^\/examples\//],
}))

registerRoute(({ url, request }) => request.destination === 'audio' || (
  url.origin === self.location.origin && /^\/audio\/v1\/(standard|high)\/[a-z0-9_-]+\.(mp3|m4a)$/.test(url.pathname)
), async ({ request }) => {
  try {
    const local = await cachedAudioResponse(request)
    if (local) return local
    // 旧下载继续可用；读取发生在 SW 中，不再启动时把全库装进界面内存。
    const legacy = await (await caches.open(LEGACY_AUDIO_CACHE)).match(request.url)
    if (legacy) return request.headers.has('Range') ? createPartialResponse(request, legacy) : legacy
  } catch { /* Cache Storage 不可用时仍可在线播放 */ }
  return fetch(request)
})

registerRoute(/\/data\/.*\.json$/, new NetworkFirst({
  cacheName: 'data-cache-v5', networkTimeoutSeconds: 5,
  plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 320, maxAgeSeconds: 60 * 60 * 24 * 14 })],
}))
registerRoute(/\/dict\/.*\.json(\?.*)?$/, new CacheFirst({
  cacheName: 'dict-ecdict-1-0-28-r3',
  plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 450, maxAgeSeconds: 60 * 60 * 24 * 180 })],
}))
registerRoute(/\/(wordbook|examples)\/.*\.json$/, new StaleWhileRevalidate({
  cacheName: 'vocab-cache-v2',
  plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60 })],
}))
registerRoute(/\/covers\/.*\.(jpg|jpeg|webp)$/, new CacheFirst({
  cacheName: 'cover-cache-v3',
  plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 320, maxAgeSeconds: 60 * 60 * 24 * 180 })],
}))
