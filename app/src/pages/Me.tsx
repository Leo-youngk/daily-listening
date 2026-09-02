import { useEffect, useMemo, useState } from 'react'
import { useCatalog } from '../store/PlayerContext'
import { loadFavorites, loadProgress, loadStats, loadVocab, streakDays, saveSettings, loadSettings } from '../lib/storage'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import TalkCard from '../components/TalkCard'
import type { Settings } from '../lib/types'
import { fmtBytes, fmtDuration } from '../lib/format'
import {
  OFFLINE_CACHE_NAME,
  OFFLINE_EVENT,
  loadOfflineIndex,
  offlineBytes,
  removeAll,
  removeTalk,
  storageEstimate,
} from '../lib/offline'

export default function Me() {
  const { manifest } = useCatalog()
  const [, force] = useState(0)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [cacheStatus, setCacheStatus] = useState<'idle' | 'clearing' | 'done' | 'error'>('idle')
  const [offline, setOffline] = useState(loadOfflineIndex)
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    const f = () => force(x => x + 1)
    window.addEventListener('dtl-storage', f)
    return () => window.removeEventListener('dtl-storage', f)
  }, [])

  useEffect(() => {
    const sync = () => {
      setOffline(loadOfflineIndex())
      void storageEstimate().then(setEstimate)
    }
    sync()
    window.addEventListener(OFFLINE_EVENT, sync)
    return () => window.removeEventListener(OFFLINE_EVENT, sync)
  }, [])

  const stats = loadStats()
  const vocab = loadVocab()
  const favs = loadFavorites()
  const prog = loadProgress()

  const finished = useMemo(
    () => Object.entries(prog).filter(([, v]) => v.duration > 0 && v.pos > v.duration - 30).length,
    [prog],
  )

  const favItems = favs.map(s => manifest.find(m => m.slug === s)).filter(Boolean)

  const offlineItems = useMemo(
    () => Object.values(offline)
      .sort((a, b) => b.at - a.at)
      .map(entry => ({
        ...entry,
        title: manifest.find(m => m.slug === entry.slug)?.title ?? entry.slug,
      })),
    [offline, manifest],
  )

  const setTheme = (t: Settings['theme']) => {
    setSettings(s => {
      const next = { ...s, theme: t }
      saveSettings({ theme: t })
      return next
    })
  }

  return (
    <div className="px-3 pb-4">
      <h1 className="safe-top pb-3 pt-3 text-xl font-bold">我的</h1>

      {/* 统计卡 */}
      <div className="grid grid-cols-4 rounded-xl bg-card p-4 text-center shadow-xs ring-1 ring-foreground/5">
        {[
          [String(streakDays()), '连续打卡'],
          [fmtDuration(stats.seconds).split(' ')[0], '收听时长'],
          [String(finished), '听完篇数'],
          [String(vocab.filter(v => !v.mastered).length), '生词'],
        ].map(([num, label], i) => (
          <div key={label} className={i > 0 ? 'border-l border-line' : ''}>
            <p className="text-xl font-bold text-primary">{num}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* 收藏 */}
      <section className="mt-4">
        <h2 className="mb-2 text-[15px] font-bold">我的收藏（{favItems.length}）</h2>
        {favItems.length === 0 ? (
          <p className="rounded-xl bg-card p-4 text-center text-xs text-muted-foreground shadow-xs ring-1 ring-foreground/5">
            在播放页点击 ♡ 收藏喜欢的演讲
          </p>
        ) : (
          <div className="space-y-2">
            {favItems.map(item => item && <TalkCard key={item.slug} item={item} />)}
          </div>
        )}
      </section>

      {/* 离线音频 */}
      <section className="mt-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[15px] font-bold">离线音频（{offlineItems.length}）</h2>
          {offlineItems.length > 0 && (
            <button
              className="text-[11px] text-muted-foreground active:opacity-60"
              onClick={() => { void removeAll() }}
            >
              全部删除
            </button>
          )}
        </div>
        {offlineItems.length === 0 ? (
          <p className="rounded-xl bg-card p-4 text-center text-xs text-muted-foreground shadow-xs ring-1 ring-foreground/5">
            在播放页的「播放设置」里下载，断网也能听
          </p>
        ) : (
          <div className="rounded-xl bg-card shadow-xs ring-1 ring-foreground/5">
            {offlineItems.map((item, i) => (
              <div key={item.slug}>
                {i > 0 && <Separator />}
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{item.title}</p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                      {fmtBytes(item.bytes)} · {item.quality === 'high' ? '高音质' : '标准音质'}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="xs"
                    className="shrink-0 rounded-full px-3 text-muted-foreground"
                    onClick={() => { void removeTalk(item.slug) }}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
            <Separator />
            <p className="px-4 py-2.5 text-[11px] tabular-nums text-muted-foreground">
              共占用 {fmtBytes(offlineBytes())}
              {estimate && estimate.quota > 0 && ` · 本站可用 ${fmtBytes(estimate.quota - estimate.usage)}`}
            </p>
          </div>
        )}
      </section>

      {/* 设置 */}
      <section className="mt-4">
        <h2 className="mb-2 text-[15px] font-bold">设置</h2>
        <div className="rounded-xl bg-card shadow-xs ring-1 ring-foreground/5">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">外观</span>
            <div className="flex gap-1">
              {(['auto', 'light', 'dark'] as const).map(t => (
                <Button
                  key={t}
                  variant={settings.theme === t ? 'default' : 'secondary'}
                  size="xs"
                  className="rounded-full px-3"
                  onClick={() => setTheme(t)}
                >
                  {t === 'auto' ? '跟随系统' : t === 'light' ? '浅色' : '深色'}
                </Button>
              ))}
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">资源缓存</span>
            <Button
              variant="secondary"
              size="xs"
              className="rounded-full px-3 text-muted-foreground"
              disabled={cacheStatus === 'clearing'}
              onClick={async () => {
                setCacheStatus('clearing')
                try {
                  if ('caches' in window) {
                    const keys = await caches.keys()
                    // 离线音频是用户主动下载的，不能被"清除缓存"顺手删掉
                    await Promise.all(
                      keys.filter(key => key !== OFFLINE_CACHE_NAME).map(key => caches.delete(key)),
                    )
                  }
                  setCacheStatus('done')
                } catch {
                  setCacheStatus('error')
                }
              }}
            >
              {cacheStatus === 'clearing' ? '清除中…' : cacheStatus === 'done' ? '已清除' : cacheStatus === 'error' ? '重试' : '清除缓存'}
            </Button>
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
          字幕、封面与词典会自动缓存；音频可在播放设置里下载<br />
          素材来自 TED 与公开毕业演讲，仅供个人学习<br />
          词典数据基于 ECDICT（MIT License）
        </p>
        <p className="mt-1 text-center text-[11px] tabular-nums text-muted-foreground">
          版本 {__BUILD_SHA__} · {__BUILD_TIME__}
        </p>
      </section>
    </div>
  )
}
