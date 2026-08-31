import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePlayer, usePlayerClock } from '../store/PlayerContext'
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
import type { DictTarget } from '../components/DictPanel'
import { normalizeTerm, tokenizeSentence } from '../lib/lookup'
import { navigate } from '../hooks/useHashRoute'

/** 可点词的英文句子；active 时带词级高亮跟随。词序与查词接口共用同一套分词 */
function TokenizedText({ text, scale, onWord, progress }: {
  text: string
  scale: number
  onWord: (wordIndex: number) => void
  progress?: number // 0~1，当前句播放进度（词级高亮用）
}) {
  const tokens = useMemo(() => tokenizeSentence(text), [text])
  const activeWord = progress !== undefined ? Math.min(tokens.length - 1, Math.floor(progress * tokens.length)) : -1
  const nodes: ReactNode[] = []
  let cursor = 0
  tokens.forEach((token, i) => {
    if (token.start > cursor) nodes.push(<span key={`gap-${i}`}>{text.slice(cursor, token.start)}</span>)
    const isPassed = i <= activeWord
    const isCurrent = i === activeWord && progress !== undefined && progress < 1
    nodes.push(
      <span
        key={`w-${i}`}
        onClick={e => { e.stopPropagation(); onWord(i) }}
        className={cn(
          'cursor-pointer rounded px-px transition-colors duration-150 active:bg-primary/25',
          isPassed && 'text-primary',
          isCurrent && 'font-semibold',
        )}
      >
        {token.text}
      </span>,
    )
    cursor = token.end
  })
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>)
  return (
    <p className="leading-relaxed" style={{ fontSize: `${17 * scale}px` }}>{nodes}</p>
  )
}

const SentenceRow = memo(function SentenceRow({ s, active, scale, hideZh, progress, onSeek, onWord }: {
  s: Sentence
  active: boolean
  scale: number
  hideZh: boolean
  progress?: number
  onSeek: (s: Sentence) => void
  onWord: (wordIndex: number, sentence: Sentence) => void
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
        <TokenizedText text={s.en} scale={scale} onWord={i => onWord(i, s)} progress={active ? progress : undefined} />
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
  const clock = usePlayerClock()
  const [settings, setSettings] = useState(loadSettings)
  const [dict, setDict] = useState<DictTarget | null>(null)
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
    if (!settings.autoScroll || clock.currentIdx < 0) return
    rowRefs.current[clock.currentIdx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [clock.currentIdx, settings.autoScroll])

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
  const handleWord = useCallback((wordIndex: number, sen: Sentence) => {
    const token = tokenizeSentence(sen.en)[wordIndex]
    if (!token) return
    setDict({
      word: normalizeTerm(token.text),
      wordIndex,
      sentence: sen.en,
      sentenceZh: sen.zh || undefined,
      slug,
      sentenceIdx: sen.i,
      startTime: sen.start,
    })
  }, [slug])

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col">
      {/* 顶栏 */}
      <header className="glass safe-top z-10 flex items-center gap-1 border-b border-line px-2 py-2">
        <Button variant="ghost" size="icon" onClick={() => {
          if (history.length > 1) history.back()
          else navigate('/library')
        }} aria-label="返回">
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
      <div ref={scrollBoxRef} className="min-h-0 flex-1 overflow-y-auto no-scrollbar vertical-scroll px-3 py-3">
        {p.loading && <p className="py-10 text-center text-sm text-muted-foreground">正在加载音频与字幕…</p>}
        {p.error && (
          <div className="mb-3 rounded-xl bg-destructive/10 px-3 py-3 text-center text-sm text-destructive">
            <p>{p.error}</p>
            <Button variant="secondary" size="sm" className="mt-2 rounded-full" onClick={p.retry}>重新加载</Button>
          </div>
        )}
        {p.buffering && !p.loading && (
          <div className="mb-2 flex items-center justify-center gap-2 rounded-lg bg-primary/8 px-3 py-1.5 text-[11px] text-primary">
            <div className="size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            缓冲中…
          </div>
        )}
        {!p.loading && talk && talk.zhSource !== 'official' && (
          <p className="mb-2 rounded-lg bg-primary/8 px-3 py-1.5 text-[11px] text-muted-foreground">
            {talk.zhSource === 'mixed' ? '本篇包含官方中文与机器补译，仅供参考' : '本篇中文为机器翻译，仅供参考'}
          </p>
        )}
        <div className="space-y-1 pb-6">
          {sentences.map((s, i) => {
            const isActive = i === clock.currentIdx
            const progress = isActive && s.end > s.start
              ? Math.max(0, Math.min(1, (clock.time - s.start) / (s.end - s.start)))
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
          <span className="w-8 text-right">{fmtTime(clock.time)}</span>
          <Slider
            className="flex-1"
            min={0}
            max={clock.duration || 100}
            step={0.5}
            value={[clock.time]}
            onValueChange={v => p.seek(v[0])}
            aria-label="播放进度"
          />
          <span className="w-8">{fmtTime(clock.duration)}</span>
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
              <div className="grid grid-cols-4 gap-2">
                {RATES.map(r => (
                  <Button
                    key={r}
                    variant={settings.rate === r ? 'default' : 'secondary'}
                    onClick={() => updateSettings({ rate: r })}
                    className="h-9 rounded-lg"
                  >
                    {r}x
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm text-muted-foreground">音频质量</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={p.quality === 'standard' ? 'default' : 'secondary'}
                  onClick={() => {
                    updateSettings({ audioQuality: 'standard' })
                    p.setQuality('standard')
                  }}
                  className="h-auto rounded-xl py-2"
                >
                  <span className="flex flex-col">
                    <span>标准音质</span>
                    <span className="text-[10px] opacity-75">72 kbps · 起播更快</span>
                  </span>
                </Button>
                <Button
                  variant={p.quality === 'high' ? 'default' : 'secondary'}
                  onClick={() => {
                    updateSettings({ audioQuality: 'high' })
                    p.setQuality('high')
                  }}
                  className="h-auto rounded-xl py-2"
                >
                  <span className="flex flex-col">
                    <span>高音质</span>
                    <span className="text-[10px] opacity-75">128 kbps · 更清晰</span>
                  </span>
                </Button>
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

      {dict && <DictPanel target={dict} onClose={() => setDict(null)} />}
    </div>
  )
}
