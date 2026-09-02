import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { OFFLINE_CACHE_NAME, initOffline } from './lib/offline'
import { PlayerProvider } from './store/PlayerContext'

// 运行时缓存名带版本号，改版后旧缓存不会被 Workbox 自动回收（cleanupOutdatedCaches
// 只管预缓存）。按白名单清理，换版本号即可让旧数据整体失效。
const RUNTIME_CACHES = new Set([
  'data-cache-v4',
  'dict-ecdict-1-0-28-r1',
  'cover-cache-v3',
  // 用户主动下载的离线音频，永远不能被白名单清理扫到
  OFFLINE_CACHE_NAME,
])
async function purgeStaleCaches() {
  try {
    if (!('caches' in window)) return
    const keys = await caches.keys()
    const stale = keys.filter(
      key => !RUNTIME_CACHES.has(key) && !key.startsWith('workbox-precache'),
    )
    await Promise.all(stale.map(key => caches.delete(key)))
  } catch {
    // Safari 隐私模式可能禁用 Cache Storage；应用仍可在线工作。
  }
}
void purgeStaleCaches()

// 把已下载的音频预热成 blob: 地址：playTalk 在点击回调里同步取地址，没时间等异步查缓存
void initOffline()

// 旧版本用来标记一次性缓存迁移，现在改成每次启动按白名单清理，标志位不再需要
try {
  localStorage.removeItem('dtl-cache-migration-v3')
} catch {
  // 隐私模式下读写 localStorage 会抛错，忽略即可
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </ErrorBoundary>
  </StrictMode>,
)
