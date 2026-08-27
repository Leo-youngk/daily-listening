import { useEffect, useMemo, useState } from 'react'
import { usePlayer } from '../store/PlayerContext'
import { loadFavorites, loadProgress, loadStats, loadVocab, streakDays, saveSettings, loadSettings } from '../lib/storage'
import { fmtDuration } from '../lib/format'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import TalkCard from '../components/TalkCard'
import type { Settings } from '../lib/types'

export default function Me() {
  const { manifest } = usePlayer()
  const [, force] = useState(0)
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    const f = () => force(x => x + 1)
    window.addEventListener('dtl-storage', f)
    return () => window.removeEventListener('dtl-storage', f)
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
            <span className="text-sm">离线缓存</span>
            <Button
              variant="secondary"
              size="xs"
              className="rounded-full px-3 text-muted-foreground"
              onClick={() => {
                caches.keys().then(keys => keys.forEach(k => caches.delete(k)))
                alert('已清除离线缓存')
              }}
            >
              清除缓存
            </Button>
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
          每日听力 · TED 版<br />素材来自 TED 与公开毕业演讲，仅供个人学习
        </p>
      </section>
    </div>
  )
}
