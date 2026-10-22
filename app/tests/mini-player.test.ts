import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MiniPlayer from '../src/components/MiniPlayer'

const state = vi.hoisted(() => ({ toggle: vi.fn() }))
vi.mock('../src/store/PlayerContext', () => ({
  usePlayer: () => ({ slug: 'demo', talk: { title: 'Demo', cover: '', series: 'BBC' }, playing: false, toggle: state.toggle }),
  usePlayerClock: () => ({ time: 10, duration: 100 }),
}))

let root: Root
let host: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.toggle.mockClear()
  history.replaceState(null, '', '/#/programs')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(MiniPlayer)))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('播放控制是独立的原生按钮，键盘事件不会冒泡成打开播放页', async () => {
  const toggle = host.querySelector<HTMLButtonElement>('[aria-label="播放"]')!
  await act(async () => {
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    toggle.click()
  })
  expect(state.toggle).toHaveBeenCalledOnce()
  expect(location.hash).toBe('#/programs')
  expect(toggle.parentElement?.closest('button, [role="button"]')).toBeNull()
})

it('封面和标题打开播放页，不改变播放状态', async () => {
  const open = host.querySelector<HTMLButtonElement>('[aria-label="打开播放页：Demo"]')!
  expect(open.tagName).toBe('BUTTON')
  await act(async () => open.click())
  expect(location.hash).toBe('#/talk/demo')
  expect(state.toggle).not.toHaveBeenCalled()
})
