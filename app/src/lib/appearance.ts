import { loadSettings } from './storage'

/** 所有主题消费者（含 portal 和 Tailwind dark:）共用同一个已解析主题。 */
export function initTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const preference = loadSettings().theme
    const dark = preference === 'dark' || (preference !== 'light' && media.matches)
    const theme = dark ? 'dark' : 'light'
    const root = document.documentElement
    if (root.dataset.theme !== theme) root.dataset.theme = theme
    if (root.classList.contains('dark') !== dark) root.classList.toggle('dark', dark)
    const meta = document.querySelector('meta[name="theme-color"]')
    const color = dark ? '#0B0B0C' : '#FFFFFF'
    if (meta?.getAttribute('content') !== color) meta?.setAttribute('content', color)
    // Safari 的状态栏、回弹区会读取根画布；只给 fixed body 换色不够。
    // 在 CSS 加载前、恢复到前台时也提供一个不透明的确定值。
    if (root.style.backgroundColor !== (dark ? 'rgb(11, 11, 12)' : 'rgb(255, 255, 255)')) root.style.backgroundColor = color
    if (root.style.colorScheme !== theme) root.style.colorScheme = theme
    const scheme = document.querySelector('meta[name="color-scheme"]')
    if (scheme?.getAttribute('content') !== theme) scheme?.setAttribute('content', theme)
  }
  const onChange = (event: Event) => {
    if ((event as CustomEvent<string>).detail === 'dtl.settings') apply()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'dtl.settings' || event.key === null) apply()
  }
  const onVisible = () => { if (!document.hidden) apply() }
  apply()
  window.addEventListener('dtl-storage', onChange)
  window.addEventListener('storage', onStorage)
  media.addEventListener('change', apply)
  window.addEventListener('pageshow', apply)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.removeEventListener('dtl-storage', onChange)
    window.removeEventListener('storage', onStorage)
    media.removeEventListener('change', apply)
    window.removeEventListener('pageshow', apply)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** 键盘、地址栏改变可视区域时，外壳与底部面板使用同一份高度。 */
export function initViewport() {
  const viewport = window.visualViewport
  let frame = 0
  const apply = () => {
    frame = 0
    if (viewport && Math.abs(viewport.scale - 1) > 0.02) return
    const height = Math.round(viewport?.height ?? window.innerHeight)
    if (height <= 0) return
    const top = Math.round(viewport?.offsetTop ?? 0)
    const inset = Math.max(0, Math.round(window.innerHeight - height - top))
    const style = document.documentElement.style
    for (const [key, value] of Object.entries({ '--app-height': height, '--app-top': top, '--keyboard-inset': inset })) {
      if (style.getPropertyValue(key) !== `${value}px`) style.setProperty(key, `${value}px`)
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply) }
  apply()
  window.addEventListener('resize', schedule)
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', schedule)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
  }
}
