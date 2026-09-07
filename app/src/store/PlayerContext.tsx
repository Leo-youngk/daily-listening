import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { AudioQuality, ManifestItem, TalkData } from '../lib/types'
import { loadProgress, loadSettings, recordListen, saveProgress, saveSettings } from '../lib/storage'
import { fetchJson } from '../lib/http'
import { sentenceAt as findSentence } from '../lib/timeline'
import { offlineSourceForTalk } from '../lib/offline'

export type LoopMode = 0 | 1 | 3 | 999

interface PlayerState {
  manifest: ManifestItem[]
  manifestReady: boolean
  manifestError: string | null
  reloadManifest: () => void
  slug: string | null
  talk: TalkData | null
  loading: boolean
  playing: boolean
  buffering: boolean
  error: string | null
  notice: string | null
  rate: number
  loop: LoopMode
  quality: AudioQuality
  playTalk: (slug: string, at?: number) => void
  retry: () => void
  toggle: () => void
  seek: (time: number) => void
  skip: (delta: number) => void
  stepSentence: (direction: 1 | -1) => void
  setRate: (rate: number) => void
  cycleLoop: () => void
  setLoop: (mode: LoopMode) => void
  setQuality: (quality: AudioQuality) => void
  sentenceAt: (time: number) => number
  subtitleOffset: number
  setSubtitleOffset: (seconds: number) => void
  /** 已扣掉字幕偏移的播放位置，供词级高亮的 rAF 循环逐帧读取（不走 React state） */
  getSubtitleTime: () => number
}

interface PlayerClockState {
  time: number
  duration: number
  currentIdx: number
}

interface PlayerActions {
  playTalk: (slug: string, at?: number) => void
}

interface CatalogState {
  manifest: ManifestItem[]
  manifestReady: boolean
  manifestError: string | null
  reloadManifest: () => void
}

const PlayerContext = createContext<PlayerState | null>(null)
const PlayerClockContext = createContext<PlayerClockState | null>(null)
const PlayerActionsContext = createContext<PlayerActions | null>(null)
const CatalogContext = createContext<CatalogState | null>(null)

export function usePlayer() {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer outside provider')
  return value
}

export function usePlayerClock() {
  const value = useContext(PlayerClockContext)
  if (!value) throw new Error('usePlayerClock outside provider')
  return value
}

export function usePlayerActions() {
  const value = useContext(PlayerActionsContext)
  if (!value) throw new Error('usePlayerActions outside provider')
  return value
}

export function useCatalog() {
  const value = useContext(CatalogContext)
  if (!value) throw new Error('useCatalog outside provider')
  return value
}

function audioErrorMessage(audio: HTMLAudioElement): string {
  switch (audio.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return '音频加载已中止，请重试'
    case MediaError.MEDIA_ERR_NETWORK:
      return '音频网络请求失败，请检查网络后重试'
    case MediaError.MEDIA_ERR_DECODE:
      return '音频解码失败，请切换音质或重试'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return '当前音频不可用，请切换音质或重试'
    default:
      return '音频加载失败，请重试'
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [audio] = useState(() => {
    const element = new Audio()
    element.preload = 'metadata'
    return element
  })
  const [manifest, setManifest] = useState<ManifestItem[]>([])
  const [manifestReady, setManifestReady] = useState(false)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [manifestReload, setManifestReload] = useState(0)
  const [slug, setSlug] = useState<string | null>(null)
  const [talk, setTalk] = useState<TalkData | null>(null)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [clock, setClock] = useState<PlayerClockState>({ time: 0, duration: 0, currentIdx: -1 })
  const [rate, setRateState] = useState(() => loadSettings().rate)
  const [loop, setLoopState] = useState<LoopMode>(0)
  const [quality, setQualityState] = useState<AudioQuality>(() => loadSettings().audioQuality)
  const [subtitleOffset, setSubtitleOffsetState] = useState(() => loadSettings().subtitleOffset)
  const offsetRef = useRef(subtitleOffset)

  const talkRef = useRef<TalkData | null>(null)
  const slugRef = useRef<string | null>(null)
  const loopRef = useRef<LoopMode>(0)
  const loopLeftRef = useRef(0)
  const loopSentenceRef = useRef(-1)
  const pendingSeekRef = useRef<number | null>(null)
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null)
  const listenPositionRef = useRef<number | null>(null)
  const listenPendingRef = useRef(0)

  const reloadManifest = useCallback(() => setManifestReload(value => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setManifestReady(false)
    setManifestError(null)
    fetchJson<ManifestItem[]>('/data/manifest.json', {
      signal: controller.signal,
      timeoutMs: 15_000,
      retries: 2,
    })
      .then(data => {
        if (!Array.isArray(data) || data.length === 0) throw new Error('语料清单为空')
        setManifest(data)
      })
      .catch(fetchError => {
        if (controller.signal.aborted) return
        setManifest([])
        setManifestError(fetchError instanceof Error ? fetchError.message : '语料清单加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setManifestReady(true)
      })
    return () => controller.abort()
  }, [manifestReload])

  const manifestBySlug = useMemo(
    () => new Map(manifest.map(item => [item.slug, item])),
    [manifest],
  )

  const sentenceAt = useCallback(
    (time: number) => findSentence(talkRef.current?.sentences, time),
    [],
  )

  const getSubtitleTime = useCallback(
    () => (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) - offsetRef.current,
    [audio],
  )

  const updateClock = useCallback(() => {
    const time = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0
    setClock(previous => {
      const currentIdx = sentenceAt(time - offsetRef.current)
      if (
        Math.abs(previous.time - time) < 0.02
        && Math.abs(previous.duration - duration) < 0.02
        && previous.currentIdx === currentIdx
      ) return previous
      return { time, duration, currentIdx }
    })
  }, [audio, sentenceAt])

  const handlePlayFailure = useCallback((playError: unknown) => {
    setBuffering(false)
    setPlaying(false)
    if (playError instanceof DOMException && playError.name === 'NotAllowedError') {
      setError('浏览器阻止了自动播放，请点一次播放按钮')
      return
    }
    setError(playError instanceof Error ? `音频无法播放：${playError.message}` : '音频无法播放，请重试')
  }, [])

  const startPlayback = useCallback(() => {
    setError(null)
    setBuffering(true)
    void audio.play().catch(handlePlayFailure)
  }, [audio, handlePlayFailure])

  /** 只累计真实播放推进，跳转和缓冲造成的大时间差不会算进学习时长。 */
  const sampleListenProgress = useCallback((allowPaused = false) => {
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
    const previous = listenPositionRef.current
    if (
      previous !== null
      && (allowPaused || !audio.paused)
      && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      const delta = current - previous
      // timeupdate 在正常播放时频率较高；超过 2 秒视为缓冲或用户 seek。
      if (delta >= 0 && delta <= 2) listenPendingRef.current += delta
    }
    listenPositionRef.current = current
  }, [audio])

  const flushListenProgress = useCallback(() => {
    sampleListenProgress(true)
    const wholeSeconds = Math.floor(listenPendingRef.current)
    if (wholeSeconds > 0) {
      recordListen(wholeSeconds)
      listenPendingRef.current -= wholeSeconds
    }
    if (slugRef.current) saveProgress(slugRef.current, audio.currentTime, audio.duration || 0)
  }, [audio, sampleListenProgress])

  const playTalk = useCallback((target: string, at?: number) => {
    const meta = manifestBySlug.get(target)
    if (!meta) {
      setError('未找到这篇演讲，请返回语料库重试')
      return
    }
    const source = meta.audioUrls?.[quality]
    if (!source) {
      setError(`这篇演讲缺少${quality === 'high' ? '高' : '标准'}音质地址`)
      return
    }

    requestRef.current?.controller.abort()
    const request = {
      id: (requestRef.current?.id ?? 0) + 1,
      controller: new AbortController(),
    }
    requestRef.current = request

    const saved = loadProgress()[target]
    const knownDuration = meta.duration || saved?.duration || 0
    const requestedAt = at !== undefined && Number.isFinite(at) ? at : undefined
    const startAt = requestedAt ?? (
      saved && saved.pos > 3 && saved.pos < knownDuration - 10 ? saved.pos : 0
    )

    // 先结算并暂停上一篇，避免 pause 事件把旧进度写到新 slug。
    flushListenProgress()
    audio.pause()
    listenPositionRef.current = null
    listenPendingRef.current = 0

    slugRef.current = target
    talkRef.current = null
    setSlug(target)
    setTalk(null)
    setLoading(true)
    setError(null)
    setNotice(null)
    setLoopState(0)
    loopRef.current = 0
    loopSentenceRef.current = -1
    pendingSeekRef.current = startAt
    setClock({ time: startAt, duration: meta.duration || 0, currentIdx: -1 })

    audio.playbackRate = rate
    // 已下载的篇目直接放本地 blob，断网也能听
    const resolvedOffline = offlineSourceForTalk(target, source, quality)
    audio.src = resolvedOffline?.source ?? source
    if (resolvedOffline && resolvedOffline.quality !== quality) {
      setNotice(`未找到${quality === 'high' ? '高' : '标准'}音质的离线文件，已使用${resolvedOffline.quality === 'high' ? '高' : '标准'}音质`)
    }
    startPlayback()

    fetchJson<TalkData>(`/data/${encodeURIComponent(target)}.json`, {
      signal: request.controller.signal,
      timeoutMs: 15_000,
      retries: 2,
    })
      .then(data => {
        if (requestRef.current?.id !== request.id) return
        if (!Array.isArray(data.sentences) || data.sentences.length === 0) {
          throw new Error('字幕内容为空')
        }
        talkRef.current = data
        setTalk(data)
        updateClock()
      })
      .catch(fetchError => {
        if (request.controller.signal.aborted || requestRef.current?.id !== request.id) return
        talkRef.current = null
        setTalk(null)
        setError(fetchError instanceof Error ? `字幕加载失败：${fetchError.message}` : '字幕加载失败，请重试')
      })
      .finally(() => {
        if (requestRef.current?.id === request.id) setLoading(false)
      })
  }, [audio, flushListenProgress, manifestBySlug, quality, rate, startPlayback, updateClock])

  useEffect(() => {
    const applyPendingSeek = () => {
      if (pendingSeekRef.current !== null) {
        audio.currentTime = Math.max(0, Math.min(pendingSeekRef.current, audio.duration || pendingSeekRef.current))
        pendingSeekRef.current = null
      }
    }
    const onMetadata = () => {
      applyPendingSeek()
      updateClock()
    }
    const onPlay = () => {
      listenPositionRef.current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
      setPlaying(true)
      setBuffering(false)
      setError(null)
    }
    const onPause = () => {
      flushListenProgress()
      setPlaying(false)
      setBuffering(false)
      updateClock()
    }
    const onWaiting = () => {
      sampleListenProgress(true)
      setBuffering(true)
    }
    const onCanPlay = () => {
      listenPositionRef.current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
      setBuffering(false)
      applyPendingSeek()
    }
    const onError = () => {
      flushListenProgress()
      setBuffering(false)
      setPlaying(false)
      setError(audioErrorMessage(audio))
    }
    const onStalled = () => {
      if (!audio.paused) setBuffering(true)
    }
    const onEnded = () => {
      flushListenProgress()
      setPlaying(false)
      setBuffering(false)
      updateClock()
    }
    const onTimeUpdate = () => {
      sampleListenProgress()
      updateClock()
    }
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onMetadata)
    audio.addEventListener('durationchange', updateClock)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onError)
    audio.addEventListener('stalled', onStalled)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onMetadata)
      audio.removeEventListener('durationchange', updateClock)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('stalled', onStalled)
      audio.removeEventListener('ended', onEnded)
    }
  }, [audio, flushListenProgress, sampleListenProgress, updateClock])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let lastPaint = 0
    const tick = (now: number) => {
      const sentences = talkRef.current?.sentences
      const loopSentence = sentences?.[loopSentenceRef.current]
      if (loopRef.current !== 0 && loopSentence && getSubtitleTime() >= loopSentence.end) {
        if (loopRef.current === 999 || loopLeftRef.current > 0) {
          if (loopRef.current !== 999) loopLeftRef.current -= 1
          audio.currentTime = loopSentence.start + offsetRef.current
        } else {
          loopRef.current = 0
          loopSentenceRef.current = -1
          setLoopState(0)
        }
      }
      if (now - lastPaint >= 100) {
        lastPaint = now
        updateClock()
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [audio, getSubtitleTime, playing, updateClock])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      flushListenProgress()
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [flushListenProgress, playing])

  useEffect(() => () => {
    requestRef.current?.controller.abort()
    flushListenProgress()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }, [audio, flushListenProgress])

  const toggle = useCallback(() => {
    if (audio.paused) startPlayback()
    else audio.pause()
  }, [audio, startPlayback])

  const seek = useCallback((time: number) => {
    const requestedTime = Number.isFinite(time) ? time : 0
    const safeTime = Math.max(0, Math.min(requestedTime, audio.duration || requestedTime))
    const targetSentence = sentenceAt(safeTime - offsetRef.current)
    // 用户主动跳句/拖进度时，单句循环应跟随新的句子，不能下一帧跳回旧句。
    if (loopRef.current !== 0 && targetSentence >= 0 && targetSentence !== loopSentenceRef.current) {
      loopSentenceRef.current = targetSentence
      loopLeftRef.current = loopRef.current === 999 ? 0 : loopRef.current
    }
    if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) pendingSeekRef.current = safeTime
    else audio.currentTime = safeTime
    setClock(previous => ({ ...previous, time: safeTime, currentIdx: targetSentence }))
  }, [audio, sentenceAt])

  const skip = useCallback((delta: number) => seek(audio.currentTime + delta), [audio, seek])

  const stepSentence = useCallback((direction: 1 | -1) => {
    const sentences = talkRef.current?.sentences
    if (!sentences?.length) return
    const current = sentenceAt(getSubtitleTime())
    const target = Math.max(0, Math.min(sentences.length - 1, current + direction))
    seek(sentences[target].start + offsetRef.current)
  }, [getSubtitleTime, seek, sentenceAt])

  const setRate = useCallback((nextRate: number) => {
    audio.playbackRate = nextRate
    setRateState(nextRate)
  }, [audio])

  const setSubtitleOffset = useCallback((seconds: number) => {
    offsetRef.current = seconds
    setSubtitleOffsetState(seconds)
    saveSettings({ subtitleOffset: seconds })
    updateClock()
  }, [updateClock])

  const setLoop = useCallback((mode: LoopMode) => {
    loopRef.current = mode
    loopLeftRef.current = mode === 999 ? 0 : mode
    setLoopState(mode)
    if (mode === 0) {
      loopSentenceRef.current = -1
      return
    }
    const index = sentenceAt(getSubtitleTime())
    const sentence = talkRef.current?.sentences[index]
    loopSentenceRef.current = index
    if (sentence) {
      audio.currentTime = sentence.start + offsetRef.current
      updateClock()
    }
  }, [audio, getSubtitleTime, sentenceAt, updateClock])

  const cycleLoop = useCallback(() => {
    const order: LoopMode[] = [0, 1, 3, 999]
    setLoop(order[(order.indexOf(loopRef.current) + 1) % order.length])
  }, [setLoop])

  const setQuality = useCallback((nextQuality: AudioQuality) => {
    if (nextQuality === quality) return
    const currentSlug = slugRef.current
    if (!currentSlug) {
      setQualityState(nextQuality)
      saveSettings({ audioQuality: nextQuality })
      return
    }
    const meta = manifestBySlug.get(currentSlug)
    const source = meta?.audioUrls?.[nextQuality]
    if (!source) {
      setError(`这篇演讲缺少${nextQuality === 'high' ? '高' : '标准'}音质地址`)
      return
    }
    setQualityState(nextQuality)
    saveSettings({ audioQuality: nextQuality })
    const position = audio.currentTime
    const shouldResume = !audio.paused
    pendingSeekRef.current = position
    audio.pause()
    const resolvedOffline = offlineSourceForTalk(currentSlug, source, nextQuality)
    audio.src = resolvedOffline?.source ?? source
    if (resolvedOffline && resolvedOffline.quality !== nextQuality) {
      setNotice(`未找到${nextQuality === 'high' ? '高' : '标准'}音质的离线文件，已使用${resolvedOffline.quality === 'high' ? '高' : '标准'}音质`)
    } else {
      setNotice(null)
    }
    if (shouldResume) startPlayback()
  }, [audio, manifestBySlug, quality, startPlayback])

  const retry = useCallback(() => {
    const currentSlug = slugRef.current
    if (currentSlug) playTalk(currentSlug, audio.currentTime)
  }, [audio, playTalk])

  const value = useMemo<PlayerState>(() => ({
    manifest, manifestReady, manifestError, reloadManifest, slug, talk, loading, playing,
    buffering, error, notice, rate, loop, quality, playTalk, retry, toggle, seek, skip,
    stepSentence, setRate, cycleLoop, setLoop, setQuality, sentenceAt,
    subtitleOffset, setSubtitleOffset, getSubtitleTime,
  }), [
    manifest, manifestReady, manifestError, reloadManifest, slug, talk, loading, playing,
    buffering, error, notice, rate, loop, quality, playTalk, retry, toggle, seek, skip,
    stepSentence, setRate, cycleLoop, setLoop, setQuality, sentenceAt,
    subtitleOffset, setSubtitleOffset, getSubtitleTime,
  ])
  const actions = useMemo<PlayerActions>(() => ({ playTalk }), [playTalk])
  const catalog = useMemo<CatalogState>(() => ({
    manifest, manifestReady, manifestError, reloadManifest,
  }), [manifest, manifestReady, manifestError, reloadManifest])

  return (
    <CatalogContext.Provider value={catalog}>
      <PlayerContext.Provider value={value}>
        <PlayerActionsContext.Provider value={actions}>
          <PlayerClockContext.Provider value={clock}>
            {children}
          </PlayerClockContext.Provider>
        </PlayerActionsContext.Provider>
      </PlayerContext.Provider>
    </CatalogContext.Provider>
  )
}
