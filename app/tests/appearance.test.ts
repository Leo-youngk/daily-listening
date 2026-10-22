import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initTheme, initViewport } from '../src/lib/appearance'
import { recordListen, saveProgress, saveSettings } from '../src/lib/storage'
import { readFileSync } from 'node:fs'

const bootstrap = readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]

let cleanup: () => void
let media: EventTarget & { matches: boolean }
beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
  document.head.innerHTML = '<meta name="theme-color" content="#FFFFFF"><meta name="color-scheme" content="light"><meta name="apple-mobile-web-app-status-bar-style" content="default">'
  media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => media)
})
afterEach(() => { cleanup?.(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('手动主题、系统主题和跨窗口设置始终同步根节点、控件 dark 类与状态栏', () => {
  saveSettings({ theme: 'dark' })
  cleanup = initTheme()
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(document.querySelector('meta')?.getAttribute('content')).toBe('#0B0B0C')
  media.matches = true
  saveSettings({ theme: 'light' })
  media.dispatchEvent(new Event('change'))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(document.documentElement.classList.contains('dark')).toBe(false)
  expect(document.documentElement.style.backgroundColor).toBe('rgb(255, 255, 255)')
  expect(document.documentElement.style.colorScheme).toBe('light')
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#FFFFFF')
  expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('light')
  saveSettings({ theme: 'auto' })
  expect(document.documentElement.dataset.theme).toBe('dark')
  localStorage.setItem('dtl.settings', JSON.stringify({ theme: 'light' }))
  window.dispatchEvent(new StorageEvent('storage', { key: 'dtl.settings' }))
  expect(document.documentElement.dataset.theme).toBe('light')
})

it.each([
  ['{"theme":"dark"}', false, 'dark', 'rgb(11, 11, 12)', '#0B0B0C'],
  ['{"theme":"light"}', true, 'light', 'rgb(255, 255, 255)', '#FFFFFF'],
  ['{bad json', true, 'dark', 'rgb(11, 11, 12)', '#0B0B0C'],
  ['null', true, 'dark', 'rgb(11, 11, 12)', '#0B0B0C'],
] as const)('首帧画布先恢复主题，再由运行时接管：%s', (stored, systemDark, theme, color, meta) => {
  localStorage.setItem('dtl.settings', stored)
  media.matches = systemDark
  new Function(bootstrap)()
  expect(document.documentElement.dataset.theme).toBe(theme)
  expect(document.documentElement.style.backgroundColor).toBe(color)
  expect(document.documentElement.style.colorScheme).toBe(theme)
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(meta)
  expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(theme)
  cleanup = initTheme()
  expect(document.documentElement.style.backgroundColor).toBe(color)
  expect(document.documentElement.style.colorScheme).toBe(theme)
})

it('从后台或页面缓存恢复时，把浏览器画布重新对齐当前设置，并保持状态栏布局不变', () => {
  saveSettings({ theme: 'dark' })
  cleanup = initTheme()
  localStorage.setItem('dtl.settings', '{"theme":"light"}')
  window.dispatchEvent(new Event('pageshow'))
  expect(document.documentElement.style.backgroundColor).toBe('rgb(255, 255, 255)')
  localStorage.setItem('dtl.settings', '{"theme":"dark"}')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(document.documentElement.style.colorScheme).toBe('dark')
  expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe('default')
})

it('累计听力和保存进度不触碰主题，不触发强制读取样式', () => {
  cleanup = initTheme()
  const attributes = vi.spyOn(Element.prototype, 'setAttribute')
  const styles = vi.spyOn(window, 'getComputedStyle')
  recordListen(5)
  saveProgress('demo', 25, 100)
  expect(attributes).not.toHaveBeenCalled()
  expect(styles).not.toHaveBeenCalled()
})

it('键盘改变可视高度时更新外壳和弹层，重复事件合并到一帧', () => {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 })
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('innerHeight', 800)
  let frame: FrameRequestCallback | undefined
  const schedule = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('requestAnimationFrame', schedule)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  cleanup = initViewport()
  expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px')
  viewport.height = 480
  viewport.offsetTop = 12
  viewport.dispatchEvent(new Event('resize'))
  viewport.dispatchEvent(new Event('scroll'))
  expect(schedule).toHaveBeenCalledTimes(1)
  frame!(16)
  expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('480px')
  expect(document.documentElement.style.getPropertyValue('--app-top')).toBe('12px')
  expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('308px')
})
