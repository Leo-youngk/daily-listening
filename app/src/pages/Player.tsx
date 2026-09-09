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
import { prefetchLookup } from '../lib/dict'
import { navigate } from '../hooks/useHashRoute'
import { wordAt } from '../lib/timeline'
import OfflineControl from '../components/OfflineControl'

/** 容器内缓动滚动。iOS Safari 的 scrollIntoView({behavior:'smooth'}) 连续调用会互相打断 */
function animateScroll(box: HTMLElement, to: number, duration = 380) {
  const from = box.scrollTop
  const target = Math.max(0, Math.min(to, box.scrollHeight - box.clientHeight))
  const delta = target - from
  if (Math.abs(delta) < 2) return () => {}
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    box.scrollTop = target
    return () => {}
  }
  let frame = 0
  const started = performance.now()
  const step = (now: number) => {
    const k = Math.min(1, (now - started) / duration)
    box.scrollTop = from + delta * (1 - (1 - k) ** 3)
    if (k < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}

/**
 * 可点词的英文句子。词序与查词接口共用同一套分词，data-w 下标同时也是 Sentence.w 的下标。
 * 高亮态不在这里渲染——由 Player 的 rAF 直接改 class，避免每帧重渲染整个字幕流。
 */
function TokenizedText({ text, scale, sentence, onWord, onPrefetch }: {
  text: string
  scale: number
  sentence: Sentence
  onWord: (wordIndex: number, sentence: Sentence) => void
  onPrefetch: (wordIndex: number, sentence: Sentence) => void
}) {
  const tokens = useMemo(() => tokenizeSentence(text), [text])
  const nodes: ReactNode[] = []
  let cursor = 0
  tokens.forEach((token, i) => {
    if (token.start > cursor) nodes.push(<span key={`gap-${i}`}>{text.slice(cursor, token.start)}</span>)
    nodes.push(
      <span
        key={`w-${i}`}
        data-w={i}
        onPointerDown={e => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          onPrefetch(i, sentence)
        }}
        onClick={e => { e.stopPropagation(); onWord(i, sentence) }}
        className="subtitle-word"
      >
        {token.text}
      </span>,
    )
    cursor = token.end
  })
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>)
  return (
    <p lang="en" className="subtitle-english" style={{ fontSize: `${20 * scale}px` }}>{nodes}</p>
  )
}

const SentenceRow = memo(function SentenceRow({ s, active, scale, hideZh, onSeek, onWord, onPrefetch }: {
  s: Sentence
  active: boolean
  scale: number
  hideZh: boolean
  onSeek: (s: Sentence) => void
  onWord: (wordIndex: number, sentence: Sentence) => void
  onPrefetch: (wordIndex: number, sentence: Sentence) => void
}) {
  return (
    <div
      onClick={() => onSeek(s)}
      aria-current={active ? 'true' : undefined}
      className="subtitle-sentence"
    >
      {/* 时间戳当键盘入口：整行不能做成 button，否则读屏会把一整句当成一个标签吹掉，逐词查词就没了 */}
      <button
        onClick={e => { e.stopPropagation(); onSeek(s) }}
        aria-label={`跳到 ${fmtTime(s.start)}`}
        className="subtitle-timestamp"
      >
        {fmtTime(s.start)}
      </button>
      <div className="min-w-0 flex-1">
        <TokenizedText text={s.en} scale={scale} sentence={s} onWord={onWord} onPrefetch={onPrefetch} />
        {!hideZh && s.zh && (
          <p lang="zh-CN" className="subtitle-translation" style={{ fontSize: `${14.5 * scale}px` }}>
            {s.zh}
          </p>
        )}
      </div>
    </div>
  )
})

/** 字幕流独立成 memo 组件：Player 每 100ms 因进度条重渲染，这里只在换句时才重建 */
const SubtitleList = memo(function SubtitleList({ sentences, currentIdx, scale, hideZh, onSeek, onWord, onPrefetch }: {
  sentences: Sentence[]
  currentIdx: number
  scale: number
  hideZh: boolean
  onSeek: (s: Sentence) => void
  onWord: (wordIndex: number, sentence: Sentence) => void
  onPrefetch: (wordIndex: number, sentence: Sentence) => void
}) {
  return (
    <div className="subtitle-list">
      {sentences.map((s, i) => (
        <div key={s.i} data-row={i}>
          <SentenceRow
            s={s}
            active={i === currentIdx}
            scale={scale}
            hideZh={hideZh}
            onSeek={onSeek}
            onWord={onWord}
            onPrefetch={onPrefetch}
          />
        </div>
      ))}
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
  const scrollBoxRef = useRef<HTMLElement>(null)
  const userScrollUntil = useRef(0)
  const touching = useRef(false)
  const cancelScroll = useRef<() => void>(() => {})
  const scrollRunningUntil = useRef(0)
  const panelWasOpen = useRef(false)
  const follow = useRef({ playing: p.playing, enabled: settings.autoScroll, blocked: false })
  follow.current = { playing: p.playing, enabled: settings.autoScroll, blocked: !!dict || showSettings }
  const followPosition = useRef({ idx: -1, line: -1, suspended: false })

  const painted = useRef<{ row: HTMLElement | null; spans: HTMLElement[]; idx: number; word: number }>(
    { row: null, spans: [], idx: -1, word: -1 },
  )
  const interruptFollow = useCallback(() => {
    userScrollUntil.current = Date.now() + 6000
    followPosition.current.idx = painted.current.idx
    followPosition.current.suspended = true
    cancelScroll.current()
    scrollRunningUntil.current = 0
  }, [])

  const fav = isFavorite(slug)
  const talk = p.talk
  const sentences = talk?.sentences ?? []
  const sentencesRef = useRef<Sentence[]>(sentences)
  sentencesRef.current = sentences

  // 切换到本篇（等 manifest 就绪，避免深链进入时的竞态）
  useEffect(() => {
    if (p.manifestReady && p.slug !== slug) p.playTalk(slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, p.manifestReady])

  // 应用倍速
  useEffect(() => { p.setRate(settings.rate) }, [settings.rate]) // eslint-disable-line

  /**
   * 词级高亮直接改 DOM class，不进 React 渲染路径。
   * 走 state 的话每帧要重建整条字幕流（最长的一篇 522 句），iPhone 上必卡。
   */
  const syncWords = useCallback(() => {
    const box = scrollBoxRef.current
    if (!box) return
    const time = p.getSubtitleTime()
    const idx = p.sentenceAt(time)
    const state = painted.current

    if (idx !== state.idx || !state.row?.isConnected) {
      if (state.row?.isConnected) {
        for (const span of state.spans) span.classList.remove('is-spoken')
      }
      const row = idx < 0 ? null : box.querySelector<HTMLElement>(`[data-row="${idx}"]`)
      state.row = row
      state.spans = row ? Array.from(row.querySelectorAll<HTMLElement>('[data-w]')) : []
      state.idx = idx
      state.word = -2
    }
    if (!state.spans.length) return

    // 没有词级时间轴的篇目只做整句高亮，不用句内比例伪造词级进度
    const word = wordAt(sentencesRef.current[idx]?.w, time)
    if (word !== state.word) {
      state.spans[state.word]?.classList.remove('is-spoken')
      state.spans[word]?.classList.add('is-spoken')
      state.word = word
    }

    const position = followPosition.current
    if (!follow.current.playing || !follow.current.enabled || follow.current.blocked
      || touching.current || Date.now() < userScrollUntil.current) {
      if (position.suspended) position.idx = idx
      return
    }
    // 手动回看后等到下一句恢复；词典关闭不会在句子中间突然拉回。
    if (position.suspended && position.idx === idx) return
    position.suspended = false
    const anchor = state.spans[word] ?? state.spans[0]
    const line = anchor.offsetTop
    if (position.idx === idx && position.line === line) return
    if (performance.now() < scrollRunningUntil.current) return
    position.idx = idx
    position.line = line
    const rect = box.getBoundingClientRect()
    const top = anchor.getBoundingClientRect().top - rect.top
    // 朗读行落在舒适区域时保持页面不动，越界才移至 40% 高度。
    if (top >= box.clientHeight * 0.28 && top <= box.clientHeight * 0.54) return
    cancelScroll.current()
    scrollRunningUntil.current = performance.now() + 400
    cancelScroll.current = animateScroll(box, box.scrollTop + top - box.clientHeight * 0.4, 400)
  }, [p])

  useEffect(() => {
    painted.current = { row: null, spans: [], idx: -1, word: -1 }
    followPosition.current = { idx: -1, line: -1, suspended: false }
    userScrollUntil.current = 0
    cancelScroll.current()
  }, [talk])

  // 播放中按帧跟；暂停、拖进度条时靠每次渲染后补一次（syncWords 无变化即刻返回，开销可忽略）
  useEffect(() => {
    if (!p.playing) return
    let frame = requestAnimationFrame(function tick() {
      syncWords()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [p.playing, syncWords])

  useEffect(() => { syncWords() })

  // 暂停、弹层、改变排版时终止旧动画；恢复播放后重新测量实际文字行。
  useEffect(() => {
    cancelScroll.current()
    scrollRunningUntil.current = 0
    followPosition.current.line = -1
    const panelOpen = !!dict || showSettings
    if (panelOpen || panelWasOpen.current) interruptFollow()
    panelWasOpen.current = panelOpen
    return () => cancelScroll.current()
  }, [p.playing, settings.autoScroll, settings.fontScale, settings.hideZh, dict, showSettings, interruptFollow])

  useEffect(() => {
    const box = scrollBoxRef.current
    if (!box) return
    const observer = new ResizeObserver(() => { followPosition.current.line = -1 })
    observer.observe(box)
    // 旧版 iOS 不支持 overscroll-behavior，边界手势显式拦截，正文内部仍用原生滚动。
    let lastY = 0
    const start = (event: TouchEvent) => { lastY = event.touches[0]?.clientY ?? 0 }
    const move = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? lastY
      const delta = y - lastY
      lastY = y
      if (event.touches.length > 1 || (delta > 0 && box.scrollTop <= 0)
        || (delta < 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 1)) {
        if (event.cancelable) event.preventDefault()
      }
    }
    box.addEventListener('touchstart', start, { passive: true })
    box.addEventListener('touchmove', move, { passive: false })
    return () => {
      observer.disconnect()
      box.removeEventListener('touchstart', start)
      box.removeEventListener('touchmove', move)
    }
  }, [])

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings(s => {
      const next = { ...s, ...patch }
      saveSettings(patch)
      return next
    })
  }

  // 稳定引用，让 SentenceRow 的 memo 生效（否则 200 行会跟着 Player 一起重渲染）
  const handleSeek = useCallback((sen: Sentence) => p.seek(sen.start + p.subtitleOffset), [p.seek, p.subtitleOffset]) // eslint-disable-line
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
  const handlePrefetch = useCallback((wordIndex: number, sen: Sentence) => {
    prefetchLookup(sen.en, wordIndex)
  }, [])

  return (
    <div className="relative mx-auto flex h-full max-w-lg flex-col">
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
      <main
        ref={scrollBoxRef}
        aria-label="双语字幕"
        onWheel={interruptFollow}
        onScroll={() => {
          if (followPosition.current.suspended) {
            userScrollUntil.current = Date.now() + 6000
            followPosition.current.idx = painted.current.idx
          }
        }}
        onTouchStart={() => { touching.current = true; interruptFollow() }}
        onTouchMove={interruptFollow}
        onTouchEnd={() => { touching.current = false; interruptFollow() }}
        onTouchCancel={() => { touching.current = false; interruptFollow() }}
        onKeyDown={e => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) interruptFollow() }}
        className="subtitle-scroll min-h-0 flex-1 overflow-y-auto no-scrollbar vertical-scroll"
      >
        {!p.manifestReady && !p.manifestError && (
          <p role="status" className="py-10 text-center text-sm text-muted-foreground">正在加载语料清单…</p>
        )}
        {p.manifestError && (
          <div role="alert" className="mb-3 rounded-xl bg-destructive/10 px-3 py-3 text-center text-sm text-destructive">
            <p>{p.manifestError}</p>
            <Button variant="secondary" size="sm" className="mt-2 rounded-full" onClick={p.reloadManifest}>重新加载语料</Button>
          </div>
        )}
        {p.loading && (
          <p role="status" className="py-10 text-center text-sm text-muted-foreground">正在加载音频与字幕…</p>
        )}
        {p.error && (
          <div role="alert" className="mb-3 rounded-xl bg-destructive/10 px-3 py-3 text-center text-sm text-destructive">
            <p>{p.error}</p>
            <Button variant="secondary" size="sm" className="mt-2 rounded-full" onClick={p.retry}>重新加载</Button>
          </div>
        )}
        {p.notice && !p.error && (
          <p role="status" className="mb-2 rounded-lg bg-primary/8 px-3 py-1.5 text-[11px] text-primary">
            {p.notice}
          </p>
        )}
        {p.buffering && !p.loading && (
          <div role="status" className="pointer-events-none absolute right-4 bottom-32 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/95 px-3 py-1.5 text-[11px] text-primary">
            <div className="size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            缓冲中…
          </div>
        )}
        {!p.loading && talk && talk.zhSource !== 'official' && (
          <p className="mb-2 rounded-lg bg-primary/8 px-3 py-1.5 text-[11px] text-muted-foreground">
            {talk.zhSource === 'mixed' ? '本篇包含官方中文与机器补译，仅供参考' : '本篇中文为机器翻译，仅供参考'}
          </p>
        )}
        <SubtitleList
          sentences={sentences}
          currentIdx={clock.currentIdx}
          scale={settings.fontScale}
          hideZh={settings.hideZh}
          onSeek={handleSeek}
          onWord={handleWord}
          onPrefetch={handlePrefetch}
        />
      </main>

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
            <OfflineControl slug={slug} quality={p.quality} url={talk?.audioUrls?.[p.quality]} />

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
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">字幕偏移</p>
                <button
                  className="text-sm tabular-nums text-primary"
                  onClick={() => p.setSubtitleOffset(0)}
                >
                  {p.subtitleOffset > 0 ? '+' : ''}{p.subtitleOffset.toFixed(2)}s
                </button>
              </div>
              <Slider
                min={-0.5}
                max={0.5}
                step={0.05}
                value={[p.subtitleOffset]}
                onValueChange={v => p.setSubtitleOffset(+v[0].toFixed(2))}
                aria-label="字幕偏移"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                蓝牙耳机有 0.1~0.3 秒输出延迟。觉得字幕比声音快就往右调，点数值归零
              </p>
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
