import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPageMotion } from '../src/lib/page-motion'

function transition() {
  let finish!: () => void
  const finished = new Promise<void>(resolve => { finish = resolve })
  return { ready: Promise.resolve(), finished, updateCallbackDone: Promise.resolve(), types: new Set<string>(), skipTransition: vi.fn(), finish }
}
function source(key: string) {
  const button = document.createElement('button')
  button.dataset.motionSource = key
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 160, left: 20, right: 400, width: 380, height: 60 } as DOMRect)
  document.body.append(button)
  return button
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(document, 'startViewTransition', { value: () => transition(), writable: true, configurable: true })
})
afterEach(() => { document.body.replaceChildren(); delete document.documentElement.dataset.navigationMotion; vi.restoreAllMocks(); Reflect.deleteProperty(document, 'startViewTransition'); vi.unstubAllGlobals() })

it('打开前捕获来源，提交时移除旧名称；返回匹配当前单词而非最初的单词', async () => {
  const motion = createPageMotion()
  const old = source('word:alpha')
  const current = source('word:beta')
  let update!: () => void
  const first = transition()
  const start = vi.fn((callback?: Parameters<Document['startViewTransition']>[0]) => { update = callback as () => void; return first })
  vi.spyOn(document, 'startViewTransition').mockImplementation(start)
  motion.run({ from: '/words', to: '/word/alpha', backwards: false, source: 'word:alpha' }, () => {
    expect(old.style.viewTransitionName).toBe('')
    old.remove(); current.remove()
  })
  expect(old.style.viewTransitionName).toBe('app-detail')
  update(); first.finish(); await first.finished; await Promise.resolve()

  const second = transition()
  start.mockImplementation(callback => { update = callback as () => void; return second })
  motion.run({ from: '/word/beta', to: '/words', backwards: true, source: 'word:beta' }, () => document.body.append(old, current))
  update()
  expect(current.style.viewTransitionName).toBe('app-detail')
  expect(old.style.viewTransitionName).toBe('')
  expect(document.activeElement).toBe(current)
  second.finish(); await second.finished; await Promise.resolve()
  motion.dispose()
  expect(current.style.viewTransitionName).toBe('')
})

it('中断动画后旧的更新回调不能覆盖较新的页面，也不能清理新动画的状态', async () => {
  const motion = createPageMotion()
  const pending: (() => void)[] = []
  const transitions = [transition(), transition()]
  let index = 0
  vi.spyOn(document, 'startViewTransition').mockImplementation(callback => {
    pending.push(callback as () => void)
    return transitions[index++]
  })
  const oldCommit = vi.fn(), newCommit = vi.fn()
  motion.run({ from: '/words', to: '/word/a', backwards: false }, oldCommit)
  motion.run({ from: '/word/a', to: '/word/b', backwards: false, motion: 'next-word' }, newCommit)
  expect(transitions[0].skipTransition).toHaveBeenCalledOnce()
  pending[0](); pending[1]()
  expect(oldCommit).not.toHaveBeenCalled()
  expect(newCommit).toHaveBeenCalledOnce()
  transitions[0].finish(); await transitions[0].finished; await Promise.resolve()
  expect(document.documentElement.dataset.navigationMotion).toBe('next-word')
  motion.dispose()
})

it.each(['reduced', 'native', 'unsupported'] as const)('%s 时仍立即完成导航', mode => {
  const motion = createPageMotion()
  const start = vi.fn()
  if (mode !== 'unsupported') vi.spyOn(document, 'startViewTransition').mockImplementation(start)
  else Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true })
  vi.stubGlobal('matchMedia', () => ({ matches: mode === 'reduced' }))
  const commit = vi.fn()
  motion.run({ from: '/words', to: '/word/a', backwards: false, nativeTransition: mode === 'native' }, commit)
  expect(commit).toHaveBeenCalledOnce()
  expect(start).not.toHaveBeenCalled()
  motion.dispose()
})

it('来源已移出筛选结果或不在屏幕内时不强行滚动、不添加重复名称', () => {
  const motion = createPageMotion()
  const offscreen = source('word:a')
  vi.spyOn(offscreen, 'getBoundingClientRect').mockReturnValue({ top: -200, bottom: -140, left: 20, right: 400, width: 380, height: 60 } as DOMRect)
  const hidden = source('word:a')
  hidden.setAttribute('inert', '')
  const scroll = vi.spyOn(window, 'scrollTo')
  const t = transition()
  let update!: () => void
  vi.spyOn(document, 'startViewTransition').mockImplementation(callback => { update = callback as () => void; return t })
  motion.run({ from: '/word/a', to: '/words', backwards: true, source: 'word:a' }, () => {})
  update()
  expect(offscreen.style.viewTransitionName).toBe('')
  expect(hidden.style.viewTransitionName).toBe('')
  expect(scroll).not.toHaveBeenCalled()
  motion.dispose()
})
