import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Player from '../src/pages/Player'
import { saveSettings } from '../src/lib/storage'

const state = vi.hoisted(() => {
  const sentences = Array.from({ length: 4 }, (_, index) => ({
    i: index, start: index * 10, end: (index + 1) * 10, en: `Sentence number ${index}.`, zh: `第${index}句`, w: [index * 10, index * 10 + 1],
  }))
  return {
    time: 1, currentIdx: 0, visible: [0], playing: true, loading: false,
    sentences, scrollToIndex: vi.fn(), seek: vi.fn(),
    talk: { slug: 'ui-test', title: 'UI test', sentences, category: 'bbc6min' },
  }
})
vi.mock('../src/store/PlayerContext', () => ({
  usePlayer: () => ({
    talk: state.loading ? null : state.talk, slug: 'ui-test', manifestReady: true, playing: state.playing, subtitleOffset: 0,
    manifest: [{ slug: 'ui-test', title: 'UI test', category: 'bbc6min', cover: '/cover-test.jpg' }],
    getSubtitleTime: () => state.time, sentenceAt: (time: number) => Math.min(3, Math.floor(time / 10)),
    setRate: () => {}, seek: state.seek, toggle: () => {}, loop: 0,
  }),
  usePlayerPosition: () => ({ currentIdx: state.currentIdx, finished: false }),
  usePlayerClock: () => ({ time: state.time, duration: 40 }),
}))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    scrollToIndex: state.scrollToIndex, measure: () => {}, measureElement: () => {}, containerRef: () => {},
    getVirtualItemForOffset: () => undefined,
    getVirtualItems: () => state.visible.map(index => ({ index, key: index })),
  }),
}))
vi.mock('../src/hooks/useCards', () => ({ useCards: () => ({ cards: new Map(), ready: true }) }))
vi.mock('../src/lib/wordbook', () => ({ loadWordbookMap: async () => new Map() }))
vi.mock('../src/hooks/useCoverTint', () => ({ useCoverTint: () => undefined }))
vi.mock('../src/components/OfflineControl', () => ({ default: () => null }))
vi.mock('../src/components/EpisodeWords', () => ({ default: () => null }))
vi.mock('../src/components/DictPanel', () => ({ default: () => null }))
vi.mock('../src/lib/dict', () => ({ prefetchLookup: () => {} }))

let root: Root
let host: HTMLDivElement
let now = 0
let nextFrame = 0
const frames = new Map<number, FrameRequestCallback>()
async function paint() {
  now += 40
  const callbacks = [...frames.values()]; frames.clear()
  await act(async () => { for (const callback of callbacks) callback(now) })
}
async function render() { await act(async () => root.render(createElement(Player, { slug: 'ui-test' }))) }
beforeEach(async () => {
  localStorage.clear()
  saveSettings({ playerView: 'text', autoScroll: true })
  state.time = 1; state.currentIdx = 0; state.visible = [0]; state.playing = true; state.loading = false
  state.scrollToIndex.mockClear(); state.seek.mockClear(); frames.clear(); now = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render()
  await paint()
  state.scrollToIndex.mockClear()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('手动回看跨过等待时间和换句后仍保持位置，点击回到当前句才恢复', async () => {
  const box = host.querySelector('.subtitle-scroll')!
  await act(async () => box.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 200 })))
  state.visible = [3]
  state.time = 25; state.currentIdx = 2; now = 60_000
  await render(); await paint()
  expect(state.scrollToIndex).not.toHaveBeenCalled()
  const follow = host.querySelector<HTMLButtonElement>('.player-follow')!
  expect(follow.textContent).toBe('回到当前句')
  await act(async () => follow.click())
  expect(state.scrollToIndex).toHaveBeenCalledWith(2, { align: 'center', behavior: 'auto' })
  expect(host.querySelector('.player-follow')).toBeNull()
})

it('播放与文稿之间切换时始终只挂载一个进度条', async () => {
  expect(host.querySelectorAll('[role="slider"]')).toHaveLength(1)
  const play = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '播放')!
  await act(async () => play.click())
  expect(host.querySelectorAll('[role="slider"]')).toHaveLength(1)
  expect(host.querySelector('.subtitle-list')).toBeNull()
  expect(host.querySelector('.player-now')).not.toBeNull()
})

it('字幕仍在下载时，播放页直接显示列表已有的标题和封面', async () => {
  state.loading = true
  await render()
  const play = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '播放')!
  await act(async () => play.click())
  expect(host.querySelector('h1')?.textContent).toBe('UI test')
  expect(host.querySelector('.player-now-cover')?.getAttribute('src')).toBe('/cover-test.jpg')
  expect(host.querySelectorAll('[role="slider"]')).toHaveLength(1)
})

it('单击字幕不会当作手动滚动，跳句会恢复跟随', async () => {
  const box = host.querySelector('.subtitle-scroll')!
  await act(async () => box.dispatchEvent(new Event('touchstart', { bubbles: true })))
  await act(async () => box.dispatchEvent(new Event('touchend', { bubbles: true })))
  expect(host.querySelector('.player-follow')).toBeNull()
  await act(async () => box.dispatchEvent(new WheelEvent('wheel', { bubbles: true })))
  const next = host.querySelector<HTMLButtonElement>('[aria-label="下一句"]')!
  await act(async () => next.click())
  expect(state.seek).toHaveBeenCalledWith(10)
  expect(host.querySelector('.player-follow')).toBeNull()
})

it('进入后台停止字幕绘制，返回前台恢复绘制', async () => {
  let hidden = true
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(frames.size).toBe(0)
  hidden = false
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(frames.size).toBeGreaterThan(0)
})
