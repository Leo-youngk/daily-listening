import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CardRecord } from '../src/lib/db'
import type { CardExample } from '../src/lib/wordbook'
import App from '../src/App'

const state = vi.hoisted(() => ({
  cards: new Map<string, CardRecord>(),
  book: Array.from({ length: 81 }, (_, index) => ({ word: `word-${index}`, zh: `释义${index}`, ph: '', tier: 6 as const, rank: index, index })),
  examples: vi.fn<(term: string) => Promise<CardExample[]>>(),
  speak: vi.fn(), stop: vi.fn(),
}))
vi.mock('../src/store/PlayerContext', () => ({
  useCatalog: () => ({ manifest: [], manifestReady: true }),
  usePlayer: () => ({ slug: null, playing: false }),
  usePlayerActions: () => ({ playTalk: vi.fn() }),
}))
vi.mock('../src/hooks/useCards', () => ({ useCards: () => ({ cards: state.cards, ready: true }) }))
vi.mock('../src/hooks/useStudySummary', () => ({ useStudySummary: () => ({ ready: true, due: 0, fresh: 20, mastered: 0, learning: 0 }) }))
vi.mock('../src/lib/wordbook', () => ({
  loadWordbook: async () => state.book,
  loadWordbookMap: async () => new Map(state.book.map(word => [word.word, word])),
  examplesFor: (term: string) => state.examples(term), loadExamples: async () => [],
  clipUrl: async () => 'https://audio.example/clip.m4a',
}))
vi.mock('../src/lib/clips', () => ({ speakWord: state.speak, stopWordAudio: state.stop, playClip: vi.fn(), prefetchClip: vi.fn() }))
vi.mock('../src/lib/srs', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/srs')>(),
  markKnown: async ({ term }: { term: string }) => {
    const card = state.cards.get(term)
    if (card) state.cards = new Map(state.cards).set(term, { ...card, status: 'known' })
  },
}))
vi.mock('../src/lib/migrate', () => ({ importLegacyVocab: async () => {} }))
vi.mock('../src/components/MiniPlayer', () => ({ default: () => null }))
vi.mock('../src/components/UpdateBanner', () => ({ default: () => null }))
vi.mock('../src/pages/Programs', () => ({ default: () => null }))
vi.mock('../src/pages/Me', () => ({ default: () => null }))
vi.mock('../src/pages/Player', () => ({ default: () => null }))
vi.mock('../src/pages/Review', () => ({ default: () => null }))

let root: Root, host: HTMLDivElement
const word = () => host.querySelector('h1')?.textContent
const control = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
async function click(button: HTMLButtonElement) { await act(async () => button.click()) }
async function render() { await act(async () => root.render(createElement(App))) }
async function start(path = '/words?seg=book') {
  history.replaceState(null, '', `#${path}`)
  await render()
}
async function back() {
  await act(async () => {
    const changed = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }))
    control('返回').click()
    await changed
  })
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  state.cards = new Map()
  state.examples.mockReset().mockResolvedValue([])
  state.speak.mockClear(); state.stop.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(document, 'startViewTransition'); vi.unstubAllGlobals() })

it('从第60个词继续越过分页，前后切换不增加返回层数，返回保留搜索、展开数和滚动位置', async () => {
  await start()
  const page = host.querySelector<HTMLElement>('[data-tab-page="words"]')!
  const search = page.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'word-')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const rows = page.querySelectorAll<HTMLButtonElement>('.words-row')
  expect(rows).toHaveLength(60)
  page.scrollTop = 900
  await act(async () => page.dispatchEvent(new Event('scroll', { bubbles: true })))
  const depth = history.length
  await click(rows[59])
  expect(word()).toBe('word-59')
  await click(control('下一个单词'))
  await click(control('下一个单词'))
  expect(word()).toBe('word-61')
  expect(history.length).toBe(depth + 1)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
  expect(word()).toBe('word-60')
  expect(history.length).toBe(depth + 1)
  await back()
  expect(host.querySelector('.app-overlay')).toBeNull()
  expect(search.value).toBe('word-')
  expect(page.querySelectorAll('.words-row')).toHaveLength(60)
  expect(page.scrollTop).toBe(900)
})

it('学习中标熟后即使当前词移出列表，下一词仍正确；首尾明确，不循环、不强制跳词', async () => {
  for (let i = 0; i < 3; i++) {
    const term = `word-${i}`
    state.cards.set(term, { term, status: 'learning', due: i, contexts: [], inBook: true, scheduled_days: 0 } as unknown as CardRecord)
  }
  await start('/words?seg=learning')
  await click(host.querySelector<HTMLButtonElement>('.words-row')!)
  expect(control('上一个单词').disabled).toBe(true)
  const known = [...host.querySelectorAll<HTMLButtonElement>('.word-actions button')].find(button => button.textContent === '标熟')!
  await click(known); await render()
  expect(word()).toBe('word-0')
  expect(host.querySelector('.word-status')?.textContent).toContain('已标熟')
  await click(control('下一个单词'))
  expect(word()).toBe('word-1')
  await click(control('下一个单词'))
  expect(word()).toBe('word-2')
  expect(control('下一个单词')).toBeNull()
  const end = [...host.querySelectorAll<HTMLButtonElement>('.word-nav')].find(button => button.textContent === '返回列表')!
  expect(end).toBeDefined()
  await back()
  expect(host.querySelectorAll('.words-row')).toHaveLength(2)
})

it('切词停止旧音频；迟到的释义/例句不能出现在新词下面，失败可重试', async () => {
  let resolveOld!: (value: CardExample[]) => void
  state.examples.mockImplementation(term => term === 'word-0' ? new Promise(resolve => { resolveOld = resolve }) : Promise.reject(new Error('offline')))
  await start()
  await click(host.querySelector<HTMLButtonElement>('.words-row')!)
  await click(control('单词发音'))
  expect(state.speak).toHaveBeenCalledWith('word-0')
  const stops = state.stop.mock.calls.length
  await click(control('下一个单词'))
  expect(state.stop.mock.calls.length).toBeGreaterThan(stops)
  await act(async () => resolveOld([{ slug: 'old', i: 0, en: 'stale example', start: 0, own: false }]))
  expect(word()).toBe('word-1')
  expect(host.textContent).not.toContain('stale example')
  expect(host.textContent).not.toContain('还没有出现过这个词')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('暂时没加载好')
  state.examples.mockResolvedValue([])
  await click(host.querySelector<HTMLButtonElement>('.word-retry')!)
  expect(host.querySelector('.word-retry')).toBeNull()
  expect(host.textContent).toContain('还没有出现过这个词')
})

it('外部直达详情的返回留在应用中，不依赖可能属于其他网站的 history.length', async () => {
  await start('/word/word-5')
  const depth = history.length
  expect(word()).toBe('word-5')
  expect(host.querySelector('.word-browser')).toBeNull()
  await click(control('返回'))
  expect(location.hash).toBe('#/words')
  expect(host.querySelector('.app-overlay')).toBeNull()
  expect(history.length).toBe(depth)
})

it('连续点三次立即推进三词，切词不用会短暂冻结输入的页面快照', async () => {
  await start()
  await click(host.querySelector<HTMLButtonElement>('.words-row')!)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const updates: (() => void)[] = []
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: (update: () => void) => {
    updates.push(update)
    return { skipTransition: vi.fn(), ready: Promise.resolve(), finished: new Promise(() => {}) }
  } })
  const depth = history.length
  await click(control('下一个单词'))
  await click(control('下一个单词'))
  await click(control('下一个单词'))
  expect(location.hash).toContain('/word/word-3?')
  expect(word()).toBe('word-3')
  expect(updates).toHaveLength(0)
  expect(history.length).toBe(depth)
})
