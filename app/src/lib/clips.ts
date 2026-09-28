/**
 * 切句音频（复习卡、单词详情里的原声例句）。
 *
 * 与整集播放器分开，用自己的 <audio>：
 * - 预取：下载到 Cache Storage 并转成 blob: 地址，离线也能复习；
 * - 播放必须在点击回调里同步调用（iOS 手势限制），所以 playClip 只读内存表，
 *   没预取好就直接用网络地址播，不等待。
 */
const CACHE_NAME = 'clip-cache-v1'
export const CLIP_CACHE_NAME = CACHE_NAME

const blobs = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()
let audio: HTMLAudioElement | null = null
let onEndCallback: (() => void) | null = null

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
    audio.addEventListener('ended', () => onEndCallback?.())
  }
  return audio
}

async function load(url: string): Promise<string | null> {
  try {
    const cache = 'caches' in window ? await caches.open(CACHE_NAME) : null
    let response = cache ? await cache.match(url) : undefined
    if (!response) {
      const fresh = await fetch(url)
      if (!fresh.ok) throw new Error(`HTTP ${fresh.status}`)
      if (cache) await cache.put(url, fresh.clone())
      response = fresh
    }
    const objectUrl = URL.createObjectURL(await response.blob())
    blobs.set(url, objectUrl)
    return objectUrl
  } catch (error) {
    // 预取失败不影响播放：播放时退回网络地址
    console.warn('clip prefetch failed', url, error)
    return null
  } finally {
    inflight.delete(url)
  }
}

export function prefetchClip(url: string): Promise<string | null> {
  const ready = blobs.get(url)
  if (ready) return Promise.resolve(ready)
  let task = inflight.get(url)
  if (!task) {
    task = load(url)
    inflight.set(url, task)
  }
  return task
}

export function playClip(url: string, onEnd?: () => void): Promise<void> {
  const player = element()
  onEndCallback = onEnd ?? null
  player.src = blobs.get(url) ?? url
  return player.play()
}

export function stopClip() {
  if (!audio) return
  audio.pause()
  onEndCallback = null
}

/** 单词发音：系统 TTS。只读单词本身，句子一律用真人原声 */
export function speakWord(text: string) {
  if (!('speechSynthesis' in window)) return
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  speechSynthesis.speak(utterance)
}
