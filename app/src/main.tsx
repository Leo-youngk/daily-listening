import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { PlayerProvider } from './store/PlayerContext'

// 一次性迁移：早期部署曾缺少素材，旧 Service Worker 用 CacheFirst 把 404 也缓存了，
// 导致字幕/封面永远命中坏缓存。新版首次运行时清除这些运行时缓存并刷新一次，
// 强制重新拉取真实资源。（先置标志位再异步清理，避免刷新后重复触发）
const MIGRATION_KEY = 'dtl-cache-migration-v3'
async function migrateRuntimeCaches() {
  try {
    if (localStorage.getItem(MIGRATION_KEY) || !('caches' in window)) return
    localStorage.setItem(MIGRATION_KEY, '1')
    const keys = await caches.keys()
    const targets = keys.filter(key =>
      /data-cache(?!-v3)|cover-cache(?!-v2)|audio-cache|dict-cache(?!-v2)|gloss-cache(?!-v2)|workbox-runtime/.test(key),
    )
    await Promise.all(targets.map(key => caches.delete(key)))
    if (targets.length > 0) window.location.reload()
  } catch {
    // Safari 隐私模式可能禁用 localStorage/Cache Storage；应用仍可在线工作。
  }
}
void migrateRuntimeCaches()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlayerProvider>
      <App />
    </PlayerProvider>
  </StrictMode>,
)
