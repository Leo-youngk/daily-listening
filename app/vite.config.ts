import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

function buildSha(): string {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'nogit'
  }
}

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 不用 autoUpdate：静默换版本会让用户看不出自己在用新版还是旧版，
      // 改成下载完成后显式提示，由用户点一下激活
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: '每日听力 · TED 版',
        short_name: '每日听力',
        description: 'TED 演讲与名校毕业演讲精听工具',
        theme_color: '#2F8FE0',
        background_color: '#F6F7F9',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // maskable 必须是单独一张：内容压进 80% 安全圆，否则 Android 圆形遮罩会咬掉耳朵
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 不能收 json：sync_dist 之后 dist 里有 300+ 素材和 400+ 词典分片，
        // 全预缓存会让首屏装几十兆，这两类改走 runtimeCaching
        globPatterns: ['**/*.{js,css,html,webmanifest}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // 缺失的数据/词典要真的 404，不能回落成 index.html
        navigateFallbackDenylist: [/^\/api\//, /^\/data\//, /^\/dict\//],
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'data-cache-v4',
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 320, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
          {
            // 词典分片内容随 ECDICT 版本整体更换，缓存名带版本号即可长期缓存
            urlPattern: /\/dict\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dict-ecdict-1-0-28-r1',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 450, maxAgeSeconds: 60 * 60 * 24 * 180 },
            },
          },
          {
            urlPattern: /\/covers\/.*\.(jpg|jpeg|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cover-cache-v3',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 320, maxAgeSeconds: 60 * 60 * 24 * 180 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  publicDir: '../public',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 素材目录（音频/数据/图标）体量大且后台还在下载，
    // 构建不自动拷贝，由 scripts/sync_dist.py 在抓取完成后同步
    copyPublicDir: false,
  },
  server: {
    fs: { allow: ['..'] },
  },
})
