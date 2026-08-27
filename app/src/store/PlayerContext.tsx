import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { TalkData, ManifestItem } from '../lib/types'
import { loadProgress, saveProgress, recordListen } from '../lib/storage'

export type LoopMode = 0 | 1 | 3 | 999 // 0=关, 999=无限

interface PlayerState {
  manifest: ManifestItem[]
  manifestReady: boolean
  slug: string | null
  talk: TalkData | null
  loading: boolean
  playing: boolean
  buffering: boolean
  time: number
  duration: number
  currentIdx: number
  rate: number
  loop: LoopMode
  playTalk: (slug: string, at?: number) => void
  toggle: () => void
  seek: (t: number) => void
  skip: (dt: number) => void
  stepSentence: (dir: 1 | -1) => void
  setRate: (r: number) => void
  cycleLoop: () => void
  setLoop: (m: LoopMode) => void
  sentenceAt: (t: number) => number
}

const Ctx = createContext<PlayerState | null>(null)

export function usePlayer() {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlayer outside provider')
  return v
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [manifest, setManifest] = useState<ManifestItem[]>([])
  const [manifestReady, setManifestReady] = useState(false)
  const [slug, setSlug] = useState<string | null>(null)
  const [talk, setTalk] = useState<TalkData | null>(null)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRateState] = useState(1)
  const [loop, setLoopState] = useState<LoopMode>(0)

  const loopLeftRef = useRef(0) // 剩余循环次数
  const talkRef = useRef<TalkData | null>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const statsAccRef = useRef(0)

  // 加载 manifest
  useEffect(() => {
    fetch('data/manifest.json')
      .then(r => r.json())
      .then(setManifest)
      .catch(() => setManifest([]))
      .finally(() => setManifestReady(true))
  }, [])

  const audio = useMemo(() => {
    if (!audioRef.current) {
      const a = new Audio()
      a.preload = 'auto'
      audioRef.current = a
    }
    return audioRef.current
  }, [])

  const sentenceAt = useCallback((t: number) => {
    const sents = talkRef.current?.sentences
    if (!sents || sents.length === 0) return -1
    // 二分
    let lo = 0, hi = sents.length - 1, ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (sents[mid].start <= t + 0.05) { ans = mid; lo = mid + 1 } else hi = mid - 1
    }
    if (ans >= 0) return ans
    return 0
  }, [])

  const [currentIdx, setCurrentIdx] = useState(-1)

  // 播放某篇：音频地址在 manifest 里就有，点击瞬间即开始缓冲；字幕并行加载，不阻塞起播
  const playTalk = useCallback((target: string, at?: number) => {
    const meta = manifest.find(m => m.slug === target)
    if (!meta) return
    setSlug(target)
    setLoading(true)
    setLoopState(0)
    if (meta.duration) setDuration(meta.duration)
    const saved = loadProgress()[target]
    const startAt = at ?? (saved && saved.pos > 3 && saved.pos < (meta.duration || saved.duration) - 10 ? saved.pos : 0)
    pendingSeekRef.current = startAt
    audio.src = meta.audioUrl
    audio.play().catch(() => { /* iOS 需手势，由点击触发所以一般没问题 */ })
    fetch(`data/${target}.json`)
      .then(r => r.json())
      .then((data: TalkData) => {
        talkRef.current = data
        setTalk(data)
      })
      .catch(() => { setTalk(null); talkRef.current = null })
      .finally(() => setLoading(false))
  }, [audio, manifest])

  // 音频事件（timeupdate 仅约 4Hz，用于暂停/缓冲时的兜底同步）
  useEffect(() => {
    const onTime = () => {
      const t = audio.currentTime
      setTime(t)
      setCurrentIdx(sentenceAt(t))
    }
    const onMeta = () => {
      setDuration(audio.duration || 0)
      if (pendingSeekRef.current !== null) {
        audio.currentTime = pendingSeekRef.current
        pendingSeekRef.current = null
      }
    }
    const onPlay = () => {
      setPlaying(true)
      setBuffering(false)
    }
    const onPause = () => setPlaying(false)
    const onEnd = () => setPlaying(false)
    const onWaiting = () => setBuffering(true)
    const onCanPlay = () => setBuffering(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnd)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('canplay', onCanPlay)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnd)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('canplay', onCanPlay)
    }
  }, [audio, sentenceAt])

  // 播放中用 rAF 逐帧驱动时间：timeupdate 太稀疏（约 4Hz），词级高亮会一顿一顿的
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const t = audio.currentTime
      setTime(t)
      setCurrentIdx(sentenceAt(t))
      // 单句循环（逐帧检测，比 timeupdate 更精准）
      const sents = talkRef.current?.sentences
      if (loop !== 0 && sents) {
        const idx = sentenceAt(t)
        const s = sents[idx]
        if (s && t >= s.end - 0.08) {
          if (loop !== 999) {
            if (loopLeftRef.current <= 0) { setLoopState(0); return }
            loopLeftRef.current -= 1
          }
          audio.currentTime = s.start
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, loop, audio, sentenceAt])

  // 播放时长统计 + 进度保存（每 5 秒）
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      statsAccRef.current += 5
      if (statsAccRef.current >= 30) {
        recordListen(statsAccRef.current)
        statsAccRef.current = 0
      }
      if (slug) saveProgress(slug, audio.currentTime, audio.duration || 0)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [playing, slug, audio])

  const toggle = useCallback(() => {
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [audio])

  const seek = useCallback((t: number) => {
    audio.currentTime = Math.max(0, Math.min(t, audio.duration || t))
    setTime(audio.currentTime)
    setCurrentIdx(sentenceAt(audio.currentTime))
  }, [audio, sentenceAt])

  const skip = useCallback((dt: number) => seek(audio.currentTime + dt), [audio, seek])

  const stepSentence = useCallback((dir: 1 | -1) => {
    const sents = talkRef.current?.sentences
    if (!sents || !sents.length) return
    const idx = sentenceAt(audio.currentTime)
    const target = Math.max(0, Math.min(sents.length - 1, idx + dir))
    seek(sents[target].start)
  }, [audio, seek, sentenceAt])

  const setRate = useCallback((r: number) => {
    audio.playbackRate = r
    setRateState(r)
  }, [audio])

  const setLoop = useCallback((m: LoopMode) => {
    loopLeftRef.current = m === 1 ? 0 : m === 3 ? 2 : 0
    setLoopState(m)
    if (m !== 0 && talkRef.current) {
      // 立即回到当前句首
      const idx = sentenceAt(audio.currentTime)
      const s = talkRef.current.sentences[idx]
      if (s) audio.currentTime = s.start
    }
  }, [audio, sentenceAt])

  const cycleLoop = useCallback(() => {
    const order: LoopMode[] = [0, 1, 3, 999]
    setLoop(order[(order.indexOf(loop) + 1) % order.length])
  }, [loop, setLoop])

  const value: PlayerState = {
    manifest, manifestReady, slug, talk, loading, playing, buffering, time, duration,
    currentIdx, rate, loop,
    playTalk, toggle, seek, skip, stepSentence, setRate, cycleLoop, setLoop, sentenceAt,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
