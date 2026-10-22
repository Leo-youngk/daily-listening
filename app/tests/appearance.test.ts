import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initTheme, initViewport, setThemeAndReload } from '../src/lib/appearance'
import { loadSettings, recordListen, saveProgress, saveSettings } from '../src/lib/storage'
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
  expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe('black')
  media.matches = true
  saveSettings({ theme: 'light' })
  media.dispatchEvent(new Event('change'))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(document.documentElement.classList.contains('dark')).toBe(false)
  expect(document.documentElement.style.backgroundColor).toBe('rgb(255, 255, 255)')
  expect(document.documentElement.style.colorScheme).toBe('light')
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#FFFFFF')
  expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('light')
  expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe('default')
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
  expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe(theme === 'dark' ? 'black' : 'default')
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
  expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe('black')
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

it('手动深浅往返先保存进度与新底色，等绘制后各刷新一次，连点不重复刷新', () => {
  saveSettings({ theme: 'light' })
  cleanup = initTheme()
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  const reload = vi.fn()
  const savePlayback = vi.fn(() => true)
  for (const theme of ['dark', 'light'] as const) {
    const previous = loadSettings().theme
    savePlayback.mockImplementationOnce(() => {
      expect(loadSettings().theme).toBe(previous)
      return true
    })
    expect(setThemeAndReload(theme, savePlayback, reload)).toBe(true)
    expect(loadSettings().theme).toBe(theme)
    expect(document.documentElement.style.colorScheme).toBe(theme)
    expect(document.documentElement.style.backgroundColor).toBe(theme === 'dark' ? 'rgb(11, 11, 12)' : 'rgb(255, 255, 255)')
    expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe(theme === 'dark' ? 'black' : 'default')
    const calls = reload.mock.calls.length
    expect(setThemeAndReload(previous, savePlayback, reload)).toBe(false)
    expect(loadSettings().theme).toBe(theme)
    frames.shift()!(16)
    expect(reload).toHaveBeenCalledTimes(calls)
    frames.shift()!(32)
    expect(reload).toHaveBeenCalledTimes(calls + 1)
    // 模拟刷新后的首屏及恢复前台，均不能再次安排刷新。
    new Function(bootstrap)()
    window.dispatchEvent(new Event('pageshow'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames).toHaveLength(0)
  }
  expect(savePlayback).toHaveBeenCalledTimes(2)
  expect(reload).toHaveBeenCalledTimes(2)
})

it('同一主题、其他设置更新和系统主题变化都不会触发刷新', () => {
  saveSettings({ theme: 'auto' })
  cleanup = initTheme()
  const frame = vi.fn()
  vi.stubGlobal('requestAnimationFrame', frame)
  const savePlayback = vi.fn(() => true)
  expect(setThemeAndReload('auto', savePlayback, vi.fn())).toBe(false)
  saveSettings({ rate: 1.2 })
  media.matches = true
  media.dispatchEvent(new Event('change'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(savePlayback).not.toHaveBeenCalled()
  expect(frame).not.toHaveBeenCalled()
})

it('播放进度或主题保存失败时不刷新，也不把界面当作保存成功', () => {
  saveSettings({ theme: 'light' })
  const frame = vi.fn()
  const reload = vi.fn()
  vi.stubGlobal('requestAnimationFrame', frame)
  expect(setThemeAndReload('dark', () => false, reload)).toBe(false)
  expect(loadSettings().theme).toBe('light')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
  expect(setThemeAndReload('dark', () => true, reload)).toBe(false)
  expect(loadSettings().theme).toBe('light')
  expect(frame).not.toHaveBeenCalled()
  expect(reload).not.toHaveBeenCalled()
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
