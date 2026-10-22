import type { UIPage, UIMetrics } from './ui-metrics'

/** 仅在交互/滚动期间采样；每 30 秒发送一份汇总，后台停止绘制。 */
export function initUIPerformance() {
  const page = (): UIPage => {
    const name = location.hash.slice(2).split(/[/?]/)[0]
    return ['words', 'me', 'talk', 'review', 'word'].includes(name) ? name as UIPage : 'programs'
  }
  const empty = (): UIMetrics => ({
    version: __BUILD_SHA__, page: page(), theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    inputs: 0, inputPaintMax: 0, eventDurationMax: 0, scrollFrames: 0, slowFrames: 0, frameMax: 0, longTasks: 0, longTaskMax: 0,
  })
  let metrics = empty()
  let scrollingUntil = 0
  let scrollFrame = 0
  let previousFrame = 0
  const inputFrames = new Set<number>()
  const flush = () => {
    if (!(metrics.inputs || metrics.scrollFrames || metrics.longTasks)) return
    const body = new Blob([JSON.stringify(metrics)], { type: 'application/json' })
    // 诊断发送失败不影响交互，不保留队列或抢占音频重试带宽。
    try { navigator.sendBeacon?.('/api/ui-metrics', body) } catch { /* 可离线使用 */ }
    metrics = empty()
  }
  const onInput = () => {
    if (document.hidden) return
    metrics.inputs++
    const start = performance.now()
    const first = requestAnimationFrame(() => {
      inputFrames.delete(first)
      const second = requestAnimationFrame(() => {
        inputFrames.delete(second)
        metrics.inputPaintMax = Math.max(metrics.inputPaintMax, performance.now() - start)
      })
      inputFrames.add(second)
    })
    inputFrames.add(first)
  }
  const tick = (now: number) => {
    scrollFrame = 0
    if (document.hidden) return
    if (previousFrame) {
      const gap = now - previousFrame
      metrics.scrollFrames++
      metrics.frameMax = Math.max(metrics.frameMax, gap)
      if (gap > 50) metrics.slowFrames++
    }
    previousFrame = now
    if (now < scrollingUntil) scrollFrame = requestAnimationFrame(tick)
    else previousFrame = 0
  }
  const onScroll = () => {
    if (document.hidden) return
    scrollingUntil = performance.now() + 200
    if (!scrollFrame) scrollFrame = requestAnimationFrame(tick)
  }
  const observers: PerformanceObserver[] = []
  const supported = typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes ?? []
  for (const type of ['event', 'longtask']) {
    if (!supported.includes(type)) continue
    const observer = new PerformanceObserver(list => {
      if (document.hidden) return
      for (const entry of list.getEntries()) {
        if (type === 'event') metrics.eventDurationMax = Math.max(metrics.eventDurationMax, entry.duration)
        else { metrics.longTasks++; metrics.longTaskMax = Math.max(metrics.longTaskMax, entry.duration) }
      }
    })
    try {
      observer.observe({ type, ...(type === 'event' ? { durationThreshold: 40 } : {}) })
      observers.push(observer)
    } catch { observer.disconnect() }
  }
  const onRoute = () => { flush(); metrics = empty() }
  const onTheme = (event: Event) => {
    if ((event as CustomEvent<string>).detail === 'dtl.settings' && metrics.theme !== document.documentElement.dataset.theme) onRoute()
  }
  const onHidden = () => {
    if (!document.hidden) return
    cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
    previousFrame = 0
    for (const frame of inputFrames) cancelAnimationFrame(frame)
    inputFrames.clear()
    flush()
  }
  document.addEventListener('pointerdown', onInput, { passive: true })
  document.addEventListener('keydown', onInput, { passive: true })
  document.addEventListener('scroll', onScroll, { passive: true, capture: true })
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('hashchange', onRoute)
  window.addEventListener('dtl-storage', onTheme)
  window.addEventListener('pagehide', flush)
  const timer = window.setInterval(flush, 30_000)
  return () => {
    onHidden()
    cancelAnimationFrame(scrollFrame)
    for (const frame of inputFrames) cancelAnimationFrame(frame)
    clearInterval(timer)
    for (const observer of observers) observer.disconnect()
    document.removeEventListener('pointerdown', onInput)
    document.removeEventListener('keydown', onInput)
    document.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('hashchange', onRoute)
    window.removeEventListener('dtl-storage', onTheme)
    window.removeEventListener('pagehide', flush)
  }
}
