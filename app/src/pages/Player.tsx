import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { usePlayer, usePlayerClock } from '../store/PlayerContext'
import type { LoopMode } from '../store/PlayerContext'
import { loadSettings, saveSettings, toggleFavorite, isFavorite } from '../lib/storage'
import type { Sentence, Settings } from '../lib/types'
import { fmtTime } from '../lib/format'
import {
  ChevronDownIcon, EllipsisIcon, ExternalLinkIcon, HeartIcon, MinusIcon, PauseIcon, PlayIcon, PlusIcon, RepeatIcon,
  SkipBackIcon, SkipForwardIcon,
} from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import DictPanel from '../components/DictPanel'
import type { DictTarget } from '../components/DictPanel'
import { normalizeTerm, tokenizeSentence } from '../lib/lookup'
import { prefetchLookup } from '../lib/dict'
import { navigate } from '../hooks/useHashRoute'
import { wordAt } from '../lib/timeline'
import OfflineControl from '../components/OfflineControl'
import Cover from '../components/Cover'
import EpisodeWords from '../components/EpisodeWords'
import Segmented from '../components/Segmented'
import { NotesIcon } from '../components/Icons'
import { useCards } from '../hooks/useCards'
import { useCoverTint } from '../hooks/useCoverTint'
import { isMastered } from '../lib/srs'
import { loadWordbookMap } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import { seriesInfo } from '../lib/types'

/** 字幕标注：在学的词铺底色，没学过的六级词加虚下划线；键是 normalizeTerm 后的表面形式 */
type WordMarks = Map<string, 'learning' | 'new'>
type View = Settings['playerView']

const VIEWS = [['play', '播放'], ['text', '文稿']] as const
const RATES = [0.5, 0.6, 0.7, 0.8, 1, 1.2, 1.5, 2]
/** 倍速胶囊点一下轮换的档位；更多档位在"···"里 */
const QUICK_RATES = [0.8, 1, 1.2, 1.5]
const LOOPS = [['0', '关'], ['1', '1 次'], ['3', '3 次'], ['999', '无限']] as const
const fmtRate = (r: number) => `${r.toFixed(1)}×`

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
function TokenizedText({ text, scale, sentence, marks, onWord, onPrefetch }: {
  text: string
  scale: number
  sentence: Sentence
  marks: WordMarks
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
        className={marks.size ? `subtitle-word${markClass(marks.get(normalizeTerm(token.text)))}` : 'subtitle-word'}
      >
        {token.text}
      </span>,
    )
    cursor = token.end
  })
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>)
  return (
    <p lang="en" className="subtitle-english" style={{ fontSize: `${18 * scale}px` }}>{nodes}</p>
  )
}

function markClass(mark?: 'learning' | 'new') {
  return mark ? ` is-${mark}` : ''
}

const SentenceRow = memo(function SentenceRow({ s, active, scale, hideZh, marks, onSeek, onWord, onPrefetch }: {
  s: Sentence
  active: boolean
  scale: number
  hideZh: boolean
  marks: WordMarks
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
      {/* 时间戳当键盘入口（视觉隐藏）：整行不能做成 button，否则读屏会把一整句当成一个标签吹掉，逐词查词就没了 */}
      <button
        onClick={e => { e.stopPropagation(); onSeek(s) }}
        aria-label={`跳到 ${fmtTime(s.start)}`}
        className="subtitle-timestamp"
      >
        {fmtTime(s.start)}
      </button>
      <TokenizedText text={s.en} scale={scale} sentence={s} marks={marks} onWord={onWord} onPrefetch={onPrefetch} />
      {!hideZh && s.zh && (
        <p lang="zh-CN" className="subtitle-translation" style={{ fontSize: `${15 * scale}px` }}>
          {s.zh}
        </p>
      )}
    </div>
  )
})

/** 字幕流独立成 memo 组件：Player 每 100ms 因进度条重渲染，这里只在换句时才重建 */
const SubtitleList = memo(function SubtitleList({ sentences, currentIdx, scale, hideZh, marks, onSeek, onWord, onPrefetch }: {
  sentences: Sentence[]
  currentIdx: number
  scale: number
  hideZh: boolean
  marks: WordMarks
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
            marks={marks}
            onSeek={onSeek}
            onWord={onWord}
            onPrefetch={onPrefetch}
          />
        </div>
      ))}
    </div>
  )
})

/** 同步线覆盖当前词及其前面几个词，读起来像一个在走的词组，而不是单个词在跳 */
const SYNC_SPAN = 3

/**
 * 播放视图的当前句双语预览。和字幕流一样只在换句时重渲染，
 * 同步线由 Player 的 rAF 直接改 class：词带 data-w，词前的空白带 data-g（下划线要连成一条）。
 */
const SentencePreview = memo(function SentencePreview({ sentence, idx, hideZh, boxRef, onExpand }: {
  sentence: Sentence | undefined
  idx: number
  hideZh: boolean
  boxRef: RefObject<HTMLDivElement | null>
  onExpand: () => void
}) {
  const nodes = useMemo(() => {
    if (!sentence) return null
    const text = sentence.en
    const out: ReactNode[] = []
    let cursor = 0
    tokenizeSentence(text).forEach((token, i) => {
      if (token.start > cursor) out.push(<span key={`g-${i}`} data-g={i}>{text.slice(cursor, token.start)}</span>)
      out.push(<span key={`w-${i}`} data-w={i}>{token.text}</span>)
      cursor = token.end
    })
    if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>)
    return out
  }, [sentence])

  return (
    <button className="player-preview" onClick={onExpand} aria-label="展开完整文稿">
      {sentence ? (
        <>
          <div ref={boxRef} className="player-preview-en" data-idx={idx}>
            <p lang="en">{nodes}</p>
          </div>
          {!hideZh && sentence.zh && <p lang="zh-CN" className="player-preview-zh">{sentence.zh}</p>}
        </>
      ) : (
        <div className="player-preview-skeleton" aria-hidden>
          <span className="skeleton" /><span className="skeleton" /><span className="skeleton is-short" />
        </div>
      )}
      <ChevronDownIcon className="player-preview-expand" aria-hidden />
    </button>
  )
})

/** 设置面板里的一行：左标题（可带说明），右控件 */
function SettingRow({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="group-row">
      <div className="min-w-0">
        <p className="group-row-label">{label}</p>
        {note && <p className="group-row-sub">{note}</p>}
      </div>
      {children}
    </div>
  )
}

export default function Player({ slug }: { slug: string }) {
  const p = usePlayer()
  const clock = usePlayerClock()
  const [settings, setSettings] = useState(loadSettings)
  const [dict, setDict] = useState<DictTarget | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showWords, setShowWords] = useState(false)
  const { cards } = useCards()
  const [book, setBook] = useState<Map<string, BookWord> | null>(null)
  useEffect(() => {
    loadWordbookMap().then(setBook).catch(() => setBook(null))
  }, [])
  const [, force] = useState(0)
  const view: View = settings.playerView
  const scrollBoxRef = useRef<HTMLElement>(null)
  const userScrollUntil = useRef(0)
  const touching = useRef(false)
  const cancelScroll = useRef<() => void>(() => {})
  const scrollRunningUntil = useRef(0)
  const panelWasOpen = useRef(false)
  const follow = useRef({ playing: p.playing, enabled: settings.autoScroll, blocked: false })
  follow.current = {
    playing: p.playing,
    enabled: settings.autoScroll,
    blocked: !!dict || showSettings || showWords || view !== 'text',
  }
  const followPosition = useRef({ idx: -1, line: -1, suspended: false })

  const painted = useRef<{ row: HTMLElement | null; spans: HTMLElement[]; idx: number; word: number }>(
    { row: null, spans: [], idx: -1, word: -1 },
  )
  const previewRef = useRef<HTMLDivElement>(null)
  const previewPainted = useRef<{ box: HTMLElement | null; idx: number; word: number; marked: HTMLElement[] }>(
    { box: null, idx: -1, word: -2, marked: [] },
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
  const tint = useCoverTint(talk?.cover)

  // 虚线只标六级新增词：四级基础词大多已经会了，全标出来满屏都是线
  const marks = useMemo<WordMarks>(() => {
    const out: WordMarks = new Map()
    if (!talk || !settings.markWords) return out
    for (const [surface, lemma] of Object.entries(talk.lemmas ?? {})) {
      const card = cards.get(lemma)
      if (!card) {
        if (book?.get(lemma)?.tier === 6) out.set(surface, 'new')
      } else if (card.status === 'learning' && !isMastered(card)) out.set(surface, 'learning')
    }
    return out
  }, [talk, cards, book, settings.markWords])
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

  /** 播放视图预览卡的同步线：当前词和前面几个词下面画玫红线，念到卡片外的行时把那一行滚进来 */
  const syncPreview = useCallback(() => {
    const box = previewRef.current
    const state = previewPainted.current
    if (!box) {
      state.box = null
      return
    }
    const idx = Number(box.dataset.idx)
    const time = p.getSubtitleTime()
    // 预览卡随 clock 每 100ms 换句，rAF 比它快：句子还没对上时先不画
    const word = p.sentenceAt(time) === idx ? wordAt(sentencesRef.current[idx]?.w, time) : -1
    if (box !== state.box || idx !== state.idx) {
      box.scrollTop = 0
      state.box = box
      state.idx = idx
      state.word = -2
      state.marked = []
    }
    if (word === state.word) return
    state.word = word
    for (const el of state.marked) el.classList.remove('is-sync')
    state.marked = []
    if (word < 0) return
    for (let k = Math.max(0, word - SYNC_SPAN + 1); k <= word; k++) {
      const span = box.querySelector<HTMLElement>(`[data-w="${k}"]`)
      if (span) state.marked.push(span)
      // 只连纯空白；"rejection? Well" 这种跨标点的地方断开
      if (k > word - SYNC_SPAN + 1) {
        const gap = box.querySelector<HTMLElement>(`[data-g="${k}"]`)
        if (gap && !gap.textContent?.trim()) state.marked.push(gap)
      }
    }
    for (const el of state.marked) el.classList.add('is-sync')
    const current = box.querySelector<HTMLElement>(`[data-w="${word}"]`)
    if (!current) return
    const top = current.offsetTop
    const bottom = top + current.offsetHeight
    if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, bottom - box.clientHeight)
    }
  }, [p])

  useEffect(() => {
    painted.current = { row: null, spans: [], idx: -1, word: -1 }
    followPosition.current = { idx: -1, line: -1, suspended: false }
    userScrollUntil.current = 0
    cancelScroll.current()
  }, [talk])

  // 切到"文稿"时直接定位到正在读的句子，不从顶部滚一路动画
  useLayoutEffect(() => {
    const box = scrollBoxRef.current
    if (view !== 'text' || !box) return
    const idx = p.sentenceAt(p.getSubtitleTime())
    const row = idx < 0 ? null : box.querySelector<HTMLElement>(`[data-row="${idx}"]`)
    if (row) box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight * 0.35
    followPosition.current = { idx, line: -1, suspended: false }
    userScrollUntil.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, talk])

  // 播放中按帧跟；暂停、拖进度条时靠每次渲染后补一次（syncWords 无变化即刻返回，开销可忽略）
  useEffect(() => {
    if (!p.playing) return
    let frame = requestAnimationFrame(function tick() {
      syncWords()
      syncPreview()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [p.playing, syncWords, syncPreview])

  useEffect(() => {
    syncWords()
    syncPreview()
  })

  // 暂停、弹层、改变排版时终止旧动画；恢复播放后重新测量实际文字行。
  useEffect(() => {
    cancelScroll.current()
    scrollRunningUntil.current = 0
    followPosition.current.line = -1
    const panelOpen = !!dict || showSettings || showWords
    if (panelOpen || panelWasOpen.current) interruptFollow()
    panelWasOpen.current = panelOpen
    return () => cancelScroll.current()
  }, [p.playing, settings.autoScroll, settings.fontScale, settings.hideZh, dict, showSettings, showWords, interruptFollow])

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
      endTime: sen.end,
    })
  }, [slug])
  const handlePrefetch = useCallback((wordIndex: number, sen: Sentence) => {
    prefetchLookup(sen.en, wordIndex)
  }, [])

  const showText = useCallback(() => {
    setSettings(s => ({ ...s, playerView: 'text' }))
    saveSettings({ playerView: 'text' })
  }, [])

  const cycleRate = () => {
    const next = QUICK_RATES[(QUICK_RATES.indexOf(settings.rate) + 1) % QUICK_RATES.length] ?? 1
    updateSettings({ rate: next })
  }
  const close = () => {
    if (history.length > 1) history.back()
    else navigate('/programs')
  }
  const finished = !!talk && !p.playing && clock.duration > 0 && clock.time >= clock.duration - 1
  const buffering = p.buffering && !p.loading

  const status = (
    <>
      {!p.manifestReady && !p.manifestError && <p role="status" className="player-status">正在加载节目清单…</p>}
      {p.manifestError && (
        <div role="alert" className="player-status is-error">
          <p>{p.manifestError}</p>
          <button className="pill-button is-soft is-small" onClick={p.reloadManifest}>重新加载</button>
        </div>
      )}
      {p.loading && <p role="status" className="player-status">正在加载音频与字幕…</p>}
      {p.error && (
        <div role="alert" className="player-status is-error">
          <p>{p.error}</p>
          <button className="pill-button is-soft is-small" onClick={p.retry}>重新加载</button>
        </div>
      )}
      {p.notice && !p.error && <p role="status" className="player-notice">{p.notice}</p>}
    </>
  )

  const scrubber = (
    <div className="player-scrubber">
      <Slider
        className="player-scrub"
        min={0}
        max={clock.duration || 100}
        step={0.5}
        value={[clock.time]}
        onValueChange={v => p.seek(v[0])}
        aria-label="播放进度"
      />
      <div className="player-times">
        <span>{fmtTime(clock.time)}</span>
        {p.loop !== 0 && (
          <button className="player-loop-tag" onClick={() => setShowSettings(true)}>
            <RepeatIcon />单句循环{p.loop === 999 ? '' : ` ×${p.loop}`}
          </button>
        )}
        <span>{fmtTime(clock.duration)}</span>
      </div>
    </div>
  )

  const toggleButton = (
    <button className="player-toggle" onClick={p.toggle} aria-label={p.playing ? '暂停' : '播放'} aria-busy={buffering || undefined}>
      {buffering ? <span className="player-spinner" /> : p.playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  )
  const rateButton = (
    <button className="player-pill" onClick={cycleRate} aria-label={`播放速度 ${settings.rate} 倍，点击切换`}>
      {fmtRate(settings.rate)}
    </button>
  )
  const wordsButton = (
    <button className="player-pill" onClick={() => setShowWords(true)} disabled={!talk} aria-label="本集词汇">
      <NotesIcon />词汇
    </button>
  )

  const pageStyle = (tint ? { '--tint': tint } : undefined) as CSSProperties | undefined

  return (
    <div className={cn('player-page', view === 'play' ? 'is-play' : 'is-text')} style={pageStyle}>
      <header className="player-top safe-top">
        <button className="player-icon" onClick={close} aria-label="收起">
          <ChevronDownIcon />
        </button>
        <Segmented
          className="player-switch"
          value={view}
          options={VIEWS}
          label="播放页视图"
          onChange={v => updateSettings({ playerView: v })}
        />
        <button className="player-icon" onClick={() => setShowSettings(true)} aria-label="播放设置">
          <EllipsisIcon />
        </button>
      </header>

      {/* 播放：封面 · 标题 · 大按钮 */}
      <section className="player-now overflow-y-auto no-scrollbar vertical-scroll" hidden={view !== 'play'} aria-label="正在播放">
        <div className="player-now-art">
          <Cover src={talk?.cover} className="player-now-cover" alt="" />
        </div>
        <div className="player-now-head">
          <div className="min-w-0 flex-1">
            <h1 className="player-now-title">{talk ? talk.title : '加载中…'}</h1>
            {talk && <p className="player-now-series">{seriesInfo(talk.category).name}</p>}
          </div>
          <button
            className={cn('player-heart', fav && 'is-on')}
            onClick={() => { toggleFavorite(slug); force(x => x + 1) }}
            aria-label={fav ? '取消收藏' : '收藏'}
            aria-pressed={fav}
          >
            <HeartIcon />
          </button>
        </div>
        {talk && sentences.length > 0 && (
          <SentencePreview
            key={talk.slug}
            sentence={sentences[Math.max(0, clock.currentIdx)]}
            idx={Math.max(0, clock.currentIdx)}
            hideZh={settings.hideZh}
            boxRef={previewRef}
            onExpand={showText}
          />
        )}
        {!talk && !p.error && !p.manifestError && (
          <SentencePreview sentence={undefined} idx={-1} hideZh={settings.hideZh} boxRef={previewRef} onExpand={showText} />
        )}
        {status}
        {finished && (
          <button className="player-finish-inline" onClick={() => setShowWords(true)}>听完了 · 清点本集生词</button>
        )}
        <div className="player-now-controls">
          {scrubber}
          <div className="player-now-transport">
            <button className="player-step" onClick={() => p.stepSentence(-1)}>
              <SkipBackIcon /><span>上一句</span>
            </button>
            {toggleButton}
            <button className="player-step" onClick={() => p.stepSentence(1)}>
              <SkipForwardIcon /><span>下一句</span>
            </button>
          </div>
          <div className="player-now-pills">
            {rateButton}
            {wordsButton}
          </div>
        </div>
      </section>

      {/* 文稿：双语字幕 + 底部控制卡 */}
      <main
        ref={scrollBoxRef}
        hidden={view !== 'text'}
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
        {status}
        <SubtitleList
          sentences={sentences}
          currentIdx={clock.currentIdx}
          scale={settings.fontScale}
          hideZh={settings.hideZh}
          marks={marks}
          onSeek={handleSeek}
          onWord={handleWord}
          onPrefetch={handlePrefetch}
        />
      </main>
      <div className="player-dock safe-bottom" hidden={view !== 'text'}>
        {finished && (
          <button className="player-finish" onClick={() => setShowWords(true)}>听完了 · 清点本集生词</button>
        )}
        {scrubber}
        <div className="player-dock-row">
          {rateButton}
          <button className="player-step" onClick={() => p.stepSentence(-1)} aria-label="上一句"><SkipBackIcon /></button>
          {toggleButton}
          <button className="player-step" onClick={() => p.stepSentence(1)} aria-label="下一句"><SkipForwardIcon /></button>
          {wordsButton}
        </div>
      </div>

      {/* 播放设置 */}
      <Sheet open={showSettings} onOpenChange={o => setShowSettings(o)}>
        <SheetContent side="bottom" className="app-sheet">
          <SheetTitle className="app-sheet-title">播放设置</SheetTitle>
          <div className="app-sheet-body no-scrollbar vertical-scroll">
            <div className="group">
              <SettingRow label="单句循环">
                <Segmented kind="choice" size="sm" label="单句循环" value={String(p.loop)} options={LOOPS}
                  onChange={v => p.setLoop(Number(v) as LoopMode)} />
              </SettingRow>
              <div className="group-row is-stacked">
                <p className="group-row-label">播放速度</p>
                <Segmented kind="choice" size="sm" label="播放速度" className="is-wide" value={String(settings.rate)}
                  options={RATES.map(r => [String(r), r.toFixed(1)] as const)}
                  onChange={v => updateSettings({ rate: Number(v) })} />
              </div>
            </div>

            <h3 className="group-title">字幕</h3>
            <div className="group">
              <SettingRow label="显示中文译文" note="中文为 Gemini 机器翻译">
                <Switch checked={!settings.hideZh} onCheckedChange={v => updateSettings({ hideZh: !v })} />
              </SettingRow>
              <SettingRow label="标出六级词" note="粉底是在学的词，虚线是没学过的六级新词">
                <Switch checked={settings.markWords} onCheckedChange={v => updateSettings({ markWords: v })} />
              </SettingRow>
              <SettingRow label="跟随朗读滚动">
                <Switch checked={settings.autoScroll} onCheckedChange={v => updateSettings({ autoScroll: v })} />
              </SettingRow>
              <SettingRow label="字号">
                <div className="stepper">
                  <button aria-label="缩小字号"
                    onClick={() => updateSettings({ fontScale: Math.max(0.8, +(settings.fontScale - 0.1).toFixed(1)) })}>
                    <MinusIcon />
                  </button>
                  <span>{Math.round(settings.fontScale * 100)}%</span>
                  <button aria-label="放大字号"
                    onClick={() => updateSettings({ fontScale: Math.min(1.4, +(settings.fontScale + 0.1).toFixed(1)) })}>
                    <PlusIcon />
                  </button>
                </div>
              </SettingRow>
              <div className="group-row is-stacked">
                <div className="flex w-full items-center justify-between">
                  <p className="group-row-label">字幕偏移</p>
                  <button className="row-button" onClick={() => p.setSubtitleOffset(0)} aria-label="字幕偏移归零">
                    {p.subtitleOffset > 0 ? '+' : ''}{p.subtitleOffset.toFixed(2)}s
                  </button>
                </div>
                <Slider
                  className="player-offset"
                  min={-0.5}
                  max={0.5}
                  step={0.05}
                  value={[p.subtitleOffset]}
                  onValueChange={v => p.setSubtitleOffset(+v[0].toFixed(2))}
                  aria-label="字幕偏移"
                />
                <p className="group-row-sub">蓝牙耳机有 0.1~0.3 秒输出延迟。觉得字幕比声音快就往右调，点数值归零</p>
              </div>
            </div>

            <h3 className="group-title">音频</h3>
            <div className="group">
              <SettingRow label="音质" note={p.quality === 'high' ? '128 kbps · 更清晰' : '72 kbps · 起播更快'}>
                <Segmented kind="choice" size="sm" label="音质" value={p.quality}
                  options={[['standard', '标准'], ['high', '高']] as const}
                  onChange={v => { updateSettings({ audioQuality: v }); p.setQuality(v) }} />
              </SettingRow>
              <div className="group-row is-stacked">
                <OfflineControl slug={slug} quality={p.quality} url={talk?.audioUrls?.[p.quality]} />
              </div>
            </div>

            {talk?.sourceUrl && (
              <a className="app-sheet-link" href={talk.sourceUrl} target="_blank" rel="noreferrer">
                查看节目原文 <ExternalLinkIcon />
              </a>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {dict && <DictPanel target={dict} onClose={() => setDict(null)} />}
      {showWords && talk && <EpisodeWords talk={talk} onClose={() => setShowWords(false)} />}
    </div>
  )
}
