import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlaybackScrubber from '../src/components/PlaybackScrubber'

const player = vi.hoisted(() => ({
  clock: { time: 10, duration: 200, currentIdx: 0 },
  seek: vi.fn(),
}))
vi.mock('../src/store/PlayerContext', () => ({
  usePlayer: () => ({ seek: player.seek, loop: 0 }),
  usePlayerClock: () => player.clock,
}))

let root: Root
let host: HTMLDivElement
const committed = vi.fn()
function render() {
  root.render(createElement(PlaybackScrubber, { onLoopSettings: vi.fn(), onSeekCommit: committed }))
}
function thumb() { return host.querySelector('[role="slider"]')! }
function track() { return host.querySelector('[data-slot="slider"]')! }
async function pointer(type: string, x = 100) {
  await act(async () => { track().dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, button: 0 })) })
}

describe('进度条真实控件交互', () => {
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    class TestPointerEvent extends MouseEvent {
      pointerId: number
      constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1 }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    // jsdom 不提供浏览器指针捕获与布局，仅补这些平台 API；仍使用实际 Radix Slider。
    const captures = new WeakMap<Element, number>()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 44, width: 200, height: 44, toJSON() {},
    }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: { configurable: true, value(this: Element, id: number) { captures.set(this, id) } },
      hasPointerCapture: { configurable: true, value(this: Element, id: number) { return captures.get(this) === id } },
      releasePointerCapture: { configurable: true, value(this: Element) { captures.delete(this) } },
    })
    player.clock.time = 10
    player.seek.mockReset().mockImplementation((time: number) => { player.clock.time = time })
    committed.mockClear()
    host = document.createElement('div'); document.body.append(host)
    root = createRoot(host)
    await act(async () => render())
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
    for (const key of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
    }
  })

  it('连续拖动只预览，时钟更新不拉回滑块，松手只跳转一次', async () => {
    await pointer('pointerdown', 40)
    for (const x of [60, 80, 100, 120]) await pointer('pointermove', x)
    expect(player.seek).not.toHaveBeenCalled()
    expect(thumb().getAttribute('aria-valuenow')).toBe('120')
    player.clock.time = 11
    await act(async () => render())
    expect(thumb().getAttribute('aria-valuenow')).toBe('120')
    await pointer('pointerup', 120)
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(120)
    expect(committed).toHaveBeenCalledExactlyOnceWith(120)
    expect(thumb().getAttribute('aria-label')).toBe('播放进度')
    expect(thumb().getAttribute('aria-valuetext')).toContain('2:00')
  })

  it('取消手势恢复当前播放位置，不跳转音频', async () => {
    await pointer('pointerdown', 100)
    await pointer('pointermove', 150)
    await pointer('pointercancel', 150)
    expect(player.seek).not.toHaveBeenCalled()
    expect(thumb().getAttribute('aria-valuenow')).toBe('10')
  })

  it('拖动后回到按下时的位置仍提交一次，不被已经推进的音频时钟覆盖', async () => {
    await pointer('pointerdown', 10)
    await pointer('pointermove', 100)
    player.clock.time = 15
    await act(async () => render())
    await pointer('pointermove', 10)
    await pointer('pointerup', 10)
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(10)
  })

  it('点击轨道松手提交，键盘可连续调整且不会留下拖动预览', async () => {
    await pointer('pointerdown', 100)
    await pointer('pointerup', 100)
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(100)
    await act(async () => { thumb().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    await act(async () => render())
    expect(player.seek).toHaveBeenLastCalledWith(100.5)
    player.clock.time = 105
    await act(async () => render())
    expect(thumb().getAttribute('aria-valuenow')).toBe('105')
  })
})
