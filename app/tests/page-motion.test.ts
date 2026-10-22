import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPageMotion } from '../src/lib/page-motion'

function source(key: string) {
  const button = document.createElement('button')
  button.dataset.motionSource = key
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 160, left: 20, right: 400, width: 380, height: 60 } as DOMRect)
  document.body.append(button)
  return button
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  // A supported but slow snapshot API must never hold up app navigation.
  Object.defineProperty(document, 'startViewTransition', { value: vi.fn(), writable: true, configurable: true })
})
afterEach(() => {
  document.body.replaceChildren()
  delete document.documentElement.dataset.navigationMotion
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'startViewTransition')
})

it.each([
  ['/programs', '/talk/episode', false],
  ['/words', '/word/alpha', false],
  ['/word/alpha', '/talk/episode', false],
  ['/talk/episode', '/programs', true],
] as const)('%s → %s 在点击任务内提交，不等待截图、计时器或动画', (from, to, backwards) => {
  const motion = createPageMotion()
  const commit = vi.fn()
  motion.run({ from, to, backwards }, commit)
  expect(commit).toHaveBeenCalledOnce()
  expect(document.startViewTransition).not.toHaveBeenCalled()
  vi.runAllTimers()
  expect(commit).toHaveBeenCalledOnce()
  motion.dispose()
})

it('返回匹配当前单词而非最初的单词，恢复焦点但不滚动列表', () => {
  const motion = createPageMotion()
  const old = source('word:alpha')
  const current = source('word:beta')
  const focus = vi.spyOn(current, 'focus')
  motion.run({ from: '/word/beta', to: '/words', backwards: true, source: 'word:beta' }, () => {})
  expect(document.activeElement).toBe(current)
  expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(old.style.viewTransitionName).toBe('')
  expect(current.style.viewTransitionName).toBe('')
  motion.dispose()
})

it('快速进入、返回、再进入都立即执行，旧清理任务不会结束新动画', () => {
  const motion = createPageMotion()
  const pages: string[] = []
  motion.run({ from: '/programs', to: '/talk/a', backwards: false }, () => pages.push('a'))
  vi.advanceTimersByTime(100)
  motion.run({ from: '/talk/a', to: '/programs', backwards: true }, () => pages.push('list'))
  vi.advanceTimersByTime(100)
  motion.run({ from: '/programs', to: '/talk/b', backwards: false }, () => pages.push('b'))
  expect(pages).toEqual(['a', 'list', 'b'])
  vi.advanceTimersByTime(50)
  expect(document.documentElement.dataset.navigationMotion).toBe('zoom-in')
  motion.dispose()
  expect(document.documentElement.dataset.navigationMotion).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['reduced', 'native', 'hidden', 'none'] as const)('%s 时立即导航且不添加动画', mode => {
  const motion = createPageMotion()
  vi.stubGlobal('matchMedia', () => ({ matches: mode === 'reduced' }))
  if (mode === 'hidden') vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  const commit = vi.fn()
  motion.run({ from: '/words', to: '/word/a', backwards: false, nativeTransition: mode === 'native', motion: mode === 'none' ? 'none' : undefined }, commit)
  expect(commit).toHaveBeenCalledOnce()
  expect(document.documentElement.dataset.navigationMotion).toBeUndefined()
  expect(document.startViewTransition).not.toHaveBeenCalled()
  motion.dispose()
})

it('来源离屏或隐藏时不强行聚焦或滚动', () => {
  const motion = createPageMotion()
  const offscreen = source('word:a')
  vi.spyOn(offscreen, 'getBoundingClientRect').mockReturnValue({ top: -200, bottom: -140, left: 20, right: 400, width: 380, height: 60 } as DOMRect)
  const hidden = source('word:a')
  hidden.setAttribute('inert', '')
  const scroll = vi.spyOn(window, 'scrollTo')
  motion.run({ from: '/word/a', to: '/words', backwards: true, source: 'word:a' }, () => {})
  expect(document.activeElement).toBe(document.body)
  expect(scroll).not.toHaveBeenCalled()
  motion.dispose()
})
