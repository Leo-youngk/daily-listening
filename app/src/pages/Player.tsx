import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlayer } from '../store/PlayerContext'
import { loadSettings, saveSettings, toggleFavorite, isFavorite } from '../lib/storage'
import type { Sentence, Settings } from '../lib/types'
import { fmtTime } from '../lib/format'
import {
  ChevronLeftIcon, HeartIcon, PauseIcon, PlayIcon, SettingsIcon,
  SkipBackIcon, SkipForwardIcon, RotateCcwIcon, FastForwardIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import DictPanel from '../components/DictPanel'

const WORD_RE = /([A-Za-z][A-Za-z'’-]*)/g

/** 可点词的英文句子；active 时带词级高亮跟随 */
function TokenizedText({ text, scale, onWord, progress }: {
  text: string
  scale: number
  onWord: (w: string) => void
  progress?: number // 0~1，当前句播放进度（词级高亮用）
}) {
  const parts = useMemo(() => text.split(WORD_RE), [text])
  const wordCount = Math.ceil(parts.length / 2)
  const activeWord = progress !== undefined ? Math.min(wordCount - 1, Math.floor(progress * wordCount)) : -1
  let wordIdx = -1
  return (
    <p className="leading-relaxed" style={{ fontSize: `${17 * scale}px` }}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (() => {
          wordIdx += 1
          const isPassed = wordIdx <= activeWord
          const isCurrent = wordIdx === activeWord && progress !== undefined && progress < 1
          return (
            <span
              key={i}
              onClick={e => { e.stopPropagation(); onWord(p) }}
              className={cn(
                'cursor-pointer rounded px-px transition-colors duration-150 active:bg-primary/25',
                isPassed && 'text-primary',
                isCurrent && 'font-semibold',
              )}
            >
              {p}
            </span>
          )
        })() : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  )
}

const SentenceRow = memo(function SentenceRow({ s, active, scale, hideZh, progress, onSeek, onWord }: {
  s: Sentence
  active: boolean
  scale: number
  hideZh: boolean
  progress?: number
  onSeek: (s: Sentence) => void
  onWord: (w: string, src: string) => void
}) {
  return (
    <div
      onClick={() => onSeek(s)}
      className={cn(
        'flex gap-2.5 rounded-xl px-3 py-2.5 transition-colors',
        active ? 'bg-primary/8' : 'active:bg-muted/60',
      )}
    >
      <span className={cn('mt-0.5 shrink-0 text-[11px] tabular-nums', active ? 'text-primary' : 'text-muted-foreground/70')}>
        {fmtTime(s.start)}
      </span>
      <div className="min-w-0 flex-1">
        <TokenizedText text={s.en} scale={scale} onWord={w => onWord(w, s.en)} progress={active ? progress : undefined} />
        {!hideZh && s.zh && (
          <p className="mt-1 text-muted-foreground" style={{ fontSize: `${14 * scale}px`, lineHeight: 1.5 }}>
            {s.zh}
          </p>
        )}
      </div>
    </div>
  )
})

const RATES = [0.5, 0.6, 0.7, 0.8, 1, 1.2, 1.5, 2]

export default function Player({ slug }: { slug: string }) {
  const p = usePlayer()
  const [settings, setSettings] = useState(loadSettings)
  const [dict, setDict] = useState<{ word: string; source: string } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [, force] = useState(0)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const scrollBoxRef = useRef<HTMLDivElement>(null)

  const fav = isFavorite(slug)

  // 切换到本篇（等 manifest 就绪，避免深链进入时的竞态）
  useEffect(() => {
    if (p.manifestReady && p.slug !== slug) p.playTalk(slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, p.manifestReady])

  // 应用倍速
  useEffect(() => { p.setRate(settings.rate) }, [settings.rate]) // eslint-disable-line

  // 自动滚动
  useEffect(() => {
    if (!settings.autoScroll || p.currentIdx < 0) return
    rowRefs.current[p.currentIdx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [p.currentIdx, settings.autoScroll])

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings(s => {
      const next = { ...s, ...patch }
      saveSettings(patch)
      return next
    })
  }

  const talk = p.talk
  const sentences = talk?.sentences ?? []

  // 稳定引用，让 SentenceRow 的 memo 生效（否则 60fps 下 200 行全部重渲染）
  const handleSeek = useCallback((sen: Sentence) => p.seek(sen.start), [p.seek]) // eslint-disable-line
  const handleWord = useCallback((w: string, src: string) => setDict({ word: w.toLowerCase(), source: src }), [])

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col">
      {/* 顶栏 */}
      <header className="glass safe-top z-10 flex items-center gap-1 border-b border-line px-2 py-2">
        <Button variant="ghost" size="icon" onClick={() => history.back()} aria-label="返回">
          <ChevronLeftIcon className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{talk?.title ?? '加载中…'}</p>
          {talk && <p className="truncate text-[11px] text-muted-foreground">{talk.speaker}{talk.category === 'commencement' && talk.school ? ` · ${talk.school}` : ''}</p>}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => { toggleFavorite(slug); force(x => x + 1) }}
          aria-label="收藏"
        >
          <HeartIcon className={cn('size-5', fav && 'fill-primary text-primary')} />
        </Button>
      </header>

      {/* 字幕流 */}
      <div ref={scrollBoxRef} className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-3 py-3">
        {p.loading && <p className="py-10 text-center text-sm text-muted-foreground">正在加载音频与字幕…</p>}
        {p.buffering && !p.loading && (
          <div className="mb-2 flex items-center justify-center gap-2 rounded-lg bg-primary/8 px-3 py-1.5 text-[11px] text-primary">
            <div className="size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            缓冲中…
          </div>
        )}
        {!p.loading && talk && talk.zhSource === 'mt' && (
          <p className="mb-2 rounded-lg bg-primary/8 px-3 py-1.5 text-[11px] text-muted-foreground">本篇中文为机器翻译，仅供参考</p>
        )}
        <div className="space-y-1 pb-6">
          {sentences.map((s, i) => {
            const isActive = i === p.currentIdx
            const progress = isActive && s.end > s.start
              ? Math.max(0, Math.min(1, (p.time - s.start) / (s.end - s.start)))
              : undefined
            return (
              <div key={s.i} ref={el => { rowRefs.current[i] = el }}>
                <SentenceRow
                  s={s}
                  active={isActive}
                  scale={settings.fontScale}
                  hideZh={settings.hideZh}
                  progress={progress}
                  onSeek={handleSeek}
                  onWord={handleWord}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* 播放条 */}
      <div className="glass safe-bottom border-t border-line px-4 pt-3">
        <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground tabular-nums">
          <span className="w-8 text-right">{fmtTime(p.time)}</span>
          <Slider
            className="flex-1"
            min={0}
            max={p.duration || 100}
            step={0.5}
            value={[p.time]}
            onValueChange={v => p.seek(v[0])}
            aria-label="播放进度"
          />
          <span className="w-8">{fmtTime(p.duration)}</span>
        </div>
        <div className="flex items-center justify-between py-2">
          <Button
            variant="ghost"
            onClick={p.cycleLoop}
            className={cn('h-8 min-w-14 rounded-full px-2 text-xs font-semibold', p.loop !== 0 && 'bg-primary/10 text-primary')}
            aria-label="单句循环"
          >
            {p.loop === 0 ? '循环' : p.loop === 999 ? '∞' : `×${p.loop}`}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => p.skip(-5)} aria-label="后退 5 秒">
              <RotateCcwIcon className="size-4.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => p.stepSentence(-1)} aria-label="上一句">
              <SkipBackIcon className="size-5 fill-current" />
            </Button>
            <Button
              onClick={p.toggle}
              size="icon"
              className="size-12 rounded-full shadow-md"
              aria-label={p.playing ? '暂停' : '播放'}
            >
              {p.buffering ? (
                <div className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : p.playing ? (
                <PauseIcon className="size-6 fill-current" />
              ) : (
                <PlayIcon className="size-6 fill-current" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => p.stepSentence(1)} aria-label="下一句">
              <SkipForwardIcon className="size-5 fill-current" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => p.skip(5)} aria-label="前进 5 秒">
              <FastForwardIcon className="size-4.5" />
            </Button>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} aria-label="设置" className="min-w-14">
            <SettingsIcon className="size-5" />
          </Button>
        </div>
      </div>

      {/* 播放设置 */}
      <Sheet open={showSettings} onOpenChange={o => setShowSettings(o)}>
        <SheetContent side="bottom" className="mx-auto w-full max-w-lg rounded-t-2xl px-4 pt-2 pb-6">
          <SheetHeader className="p-0 pt-2 pb-1 text-center">
            <SheetTitle className="text-sm font-semibold">播放设置</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 px-1 pt-2">
            <div>
              <p className="mb-2 text-sm text-muted-foreground">播放速度</p>
              <div className="flex gap-2">
                {RATES.map(r => (
                  <Button
                    key={r}
                    variant={settings.rate === r ? 'default' : 'secondary'}
                    onClick={() => updateSettings({ rate: r })}
                    className="h-9 flex-1 rounded-lg"
                  >
                    {r}x
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">字幕字号</p>
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="icon" className="rounded-full"
                  onClick={() => updateSettings({ fontScale: Math.max(0.8, +(settings.fontScale - 0.1).toFixed(1)) })}>
                  －
                </Button>
                <span className="w-10 text-center text-sm tabular-nums">{Math.round(settings.fontScale * 100)}%</span>
                <Button variant="secondary" size="icon" className="rounded-full"
                  onClick={() => updateSettings({ fontScale: Math.min(1.4, +(settings.fontScale + 0.1).toFixed(1)) })}>
                  ＋
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">隐藏中文译文</p>
              <Switch checked={settings.hideZh} onCheckedChange={v => updateSettings({ hideZh: v })} />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">字幕自动滚动</p>
              <Switch checked={settings.autoScroll} onCheckedChange={v => updateSettings({ autoScroll: v })} />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {dict && <DictPanel word={dict.word} source={dict.source} onClose={() => setDict(null)} />}
    </div>
  )
}
