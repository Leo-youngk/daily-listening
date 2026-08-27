import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
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
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json}'],
        // 早期部署曾缺少素材，旧 SW 把 404 也缓存了（CacheFirst），
        // 激活新版时清除所有运行时缓存，强制重新拉取真实资源
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'data-cache',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 300 },
            },
          },
          {
            urlPattern: /\/covers\/.*\.(jpg|jpeg|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cover-cache',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 180 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.dictionaryapi\.dev\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dict-cache',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 200 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.mymemory\.translated\.net\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gloss-cache',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 200 },
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
    // 构建不自动拷贝，由 scripts/sync_dist.ps1 在抓取完成后同步
    copyPublicDir: false,
  },
  server: {
    fs: { allow: ['..'] },
  },
})
