import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../src/App'

const state = vi.hoisted(() => ({
  manifest: Array.from({ length: 90 }, (_, index) => ({
    slug: `episode-${index}`, title: `Nuclear episode ${index}`, category: 'bbc6min',
    series: 'BBC', date: '2026-10-01', duration: 360, cover: '',
  })),
  playTalk: vi.fn(),
}))
vi.mock('../src/store/PlayerContext', () => ({
  useCatalog: () => ({ manifest: state.manifest, manifestReady: true }),
  usePlayer: () => ({ slug: null, playing: false }),
  usePlayerActions: () => ({ playTalk: state.playTalk }),
}))
vi.mock('../src/hooks/useCards', () => ({ useCards: () => ({ cards: new Map(), ready: true }) }))
vi.mock('../src/hooks/useStudySummary', () => ({ useStudySummary: () => ({ ready: true, due: 0 }) }))
vi.mock('../src/lib/wordbook', () => ({ loadWordbook: async () => [], loadEpisodeWords: async () => ({}) }))
vi.mock('../src/lib/migrate', () => ({ importLegacyVocab: async () => {} }))
vi.mock('../src/components/MiniPlayer', () => ({ default: () => null }))
vi.mock('../src/components/UpdateBanner', () => ({ default: () => null }))
vi.mock('../src/pages/Me', () => ({ default: () => createElement('p', null, '我的设置') }))
vi.mock('../src/pages/Words', () => ({ default: () => createElement('p', null, '词表') }))
vi.mock('../src/pages/Player', () => ({ default: () => createElement('p', null, '播放器') }))
vi.mock('../src/pages/Review', () => ({ default: () => null }))
vi.mock('../src/pages/WordDetail', () => ({ default: () => null }))

let root: Root
let host: HTMLDivElement
const panel = () => host.querySelector<HTMLElement>('[data-tab-page="programs"]')!
const search = () => panel().querySelector<HTMLInputElement>('input')!
async function route(path: string) {
  await act(async () => {
    window.location.hash = path
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}
beforeEach(async () => {
  localStorage.clear()
  history.replaceState(null, '', '/#/programs')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(App)))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, 'startViewTransition') })

it('首页点节目在事件返回前显示播放器，不等待浏览器转场回调', async () => {
  const snapshot = vi.fn()
  Object.defineProperty(document, 'startViewTransition', { value: snapshot, configurable: true })
  const row = panel().querySelector<HTMLButtonElement>('.episode-row')!
  await act(async () => {
    row.click()
    expect(host.querySelector('.app-overlay')?.textContent).toBe('播放器')
    expect(location.hash).toBe('#/talk/episode-0')
  })
  expect(snapshot).not.toHaveBeenCalled()
  expect(state.playTalk).toHaveBeenCalledWith('episode-0')
})

it('节目搜索跨标签页与播放器往返后保留，隐藏页不会叠在当前页面上', async () => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search(), 'episode 12')
    search().dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(panel().querySelectorAll('.episode-row')).toHaveLength(1)
  await route('/me')
  expect(panel().style.display).toBe('none')
  await route('/programs')
  expect(search().value).toBe('episode 12')
  expect(panel().style.display).not.toBe('none')
  await route('/talk/episode-12')
  expect(panel().style.display).toBe('none')
  await route('/programs')
  expect(search().value).toBe('episode 12')
})

it('展开条数和各页滚动位置一起保留', async () => {
  const more = panel().querySelector<HTMLButtonElement>('.list-more')!
  await act(async () => more.click())
  expect(panel().querySelectorAll('.episode-row')).toHaveLength(80)
  panel().scrollTop = 1200
  await act(async () => panel().dispatchEvent(new Event('scroll', { bubbles: true })))
  await route('/words')
  await route('/programs')
  expect(panel().querySelectorAll('.episode-row')).toHaveLength(80)
  expect(panel().scrollTop).toBe(1200)
})
