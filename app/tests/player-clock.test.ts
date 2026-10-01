import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlayerProvider, usePlayerActions, usePlayerClock, usePlayerPosition } from '../src/store/PlayerContext'

const episode = { slug: 'clock-test', duration: 100, audioUrls: { standard: '/test.mp3' }, sentences: [
  { i: 0, start: 0, end: 50, en: 'First sentence.', zh: '' },
  { i: 1, start: 50, end: 100, en: 'Second sentence.', zh: '' },
] }
vi.mock('../src/lib/http', () => ({ fetchJson: async (path: string) => path.includes('manifest') ? [episode] : episode }))
vi.mock('../src/lib/offline', () => ({
  cacheTalkForReplay() {}, setAudioCachePlayback() {}, offlineSourceForTalk: () => null, prepareOfflineSource: async () => {},
}))

class TestAudio extends EventTarget {
  currentTime = 0
  duration = 100
  readyState = 4
  paused = true
  ended = false
  seeking = false
  buffered = { length: 1, start: () => 0, end: () => 100 }
  error = null
  source = ''
  constructor() { super(); audios.push(this) }
  get src() { return this.source }
  set src(value: string) { this.source = value; this.dispatchEvent(new Event('loadedmetadata')) }
  async play() { this.paused = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')) }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')) } }
  removeAttribute() {}
  load() {}
}
const audios: TestAudio[] = []
let fastRenders = 0
let transcriptRenders = 0
let playTalk: (slug: string) => void
function Clock() {
  fastRenders++
  return createElement('div', { id: 'time' }, usePlayerClock().time)
}
function Position() {
  transcriptRenders++
  const position = usePlayerPosition()
  return createElement('div', { id: 'position' }, `${position.currentIdx}/${position.finished}`)
}
function Controls() {
  const actions = usePlayerActions()
  useEffect(() => { playTalk = actions.playTalk }, [actions.playTalk])
  return null
}

beforeEach(() => {
  localStorage.clear(); audios.length = 0; fastRenders = 0; transcriptRenders = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Audio', TestAudio)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

it('时钟推进只更新进度条；换句和播放结束才通知文稿', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(PlayerProvider, null,
      createElement(Clock, { key: 'clock' }), createElement(Position, { key: 'position' }), createElement(Controls, { key: 'controls' }),
    )))
    await act(async () => playTalk('clock-test'))
    const audio = audios.at(-1)!
    const before = { fast: fastRenders, transcript: transcriptRenders }
    for (const time of [1, 2, 3]) {
      await act(async () => { audio.currentTime = time; audio.dispatchEvent(new Event('timeupdate')) })
    }
    expect(fastRenders).toBe(before.fast + 3)
    expect(transcriptRenders).toBe(before.transcript)
    expect(host.querySelector('#time')?.textContent).toBe('3')
    await act(async () => { audio.currentTime = 55; audio.dispatchEvent(new Event('timeupdate')) })
    expect(transcriptRenders).toBe(before.transcript + 1)
    expect(host.querySelector('#position')?.textContent).toBe('1/false')
    await act(async () => { audio.currentTime = 100; audio.pause() })
    expect(host.querySelector('#position')?.textContent).toBe('1/true')
  } finally { await act(async () => root.unmount()); host.remove() }
})
