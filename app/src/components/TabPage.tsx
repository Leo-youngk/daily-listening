import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/** Activity 保留内容状态；每页独立滚动，异步内容就绪后再恢复位置。 */
export default function TabPage({ pageKey, active, children }: { pageKey: string; active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const positions = useRef<Record<string, number>>({})
  const restoring = useRef(false)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box || !active) return
    const target = positions.current[pageKey] ?? 0
    restoring.current = true
    let observer: ResizeObserver | undefined
    const stop = () => { restoring.current = false; observer?.disconnect() }
    const restore = () => {
      box.scrollTop = target
      if (Math.abs(box.scrollTop - target) < 1) stop()
    }
    restore()
    if (restoring.current && box.firstElementChild) {
      observer = new ResizeObserver(restore)
      observer.observe(box.firstElementChild)
    }
    // 用户开始操作就交还滚动权，迟到的数据不能把页面拉回旧位置。
    for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown']) box.addEventListener(event, stop, { passive: true })
    return () => {
      stop()
      for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown']) box.removeEventListener(event, stop)
    }
  }, [active, pageKey])
  return (
    <main ref={ref} data-tab-page={pageKey}
      onScroll={event => { if (active && !restoring.current) positions.current[pageKey] = event.currentTarget.scrollTop }}
      className="app-main min-h-0 flex-1 overflow-y-auto no-scrollbar vertical-scroll">
      {children}
    </main>
  )
}
