export type NavigationMotion = 'back' | 'next-word' | 'previous-word' | 'none'
type MotionKind = 'zoom-in' | 'zoom-out' | 'detail-in' | 'detail-out' | 'next-word' | 'previous-word' | 'tab'

interface Change {
  from: string
  to: string
  backwards: boolean
  source?: string
  motion?: NavigationMotion
  nativeTransition?: boolean
}

const overlay = (hash: string) => /^\/(talk|word|review)(\/|\?|$)/.test(hash)

function kindFor(change: Change): MotionKind {
  if (change.motion === 'next-word' || change.motion === 'previous-word') return change.motion
  if (!overlay(change.from) && overlay(change.to)) return 'zoom-in'
  if (overlay(change.from) && !overlay(change.to)) return 'zoom-out'
  if (overlay(change.from) && overlay(change.to)) return change.backwards ? 'detail-out' : 'detail-in'
  return 'tab'
}

function findSource(key?: string): HTMLElement | undefined {
  if (!key) return
  const elements = [...document.querySelectorAll<HTMLElement>('[data-motion-source]')]
  return elements.find(el => {
    if (el.dataset.motionSource !== key || el.closest('[inert]')) return false
    const rect = el.getBoundingClientRect()
    const scroller = el.closest('.app-main')?.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.bottom > (scroller?.top ?? 0) &&
      rect.top < (scroller?.bottom ?? innerHeight) && rect.right > 0 && rect.left < innerWidth
  })
}

function restoreFocus(kind: MotionKind, source?: string) {
  // Do not steal focus from someone who has already started another action.
  const focused = document.activeElement
  if (focused && focused !== document.body && !focused.closest('[inert], [aria-hidden="true"]')) return
  const target = kind === 'zoom-out'
    ? findSource(source) ?? document.querySelector<HTMLElement>('.app-tab[aria-current="page"]')
    : kind === 'next-word' || kind === 'previous-word'
      ? document.querySelector<HTMLElement>(`[data-word-nav="${kind === 'next-word' ? 'next' : 'previous'}"]:not(:disabled)`) ?? document.querySelector<HTMLElement>('.word-main h1')
      : document.querySelector<HTMLElement>('.app-overlay h1') ?? document.querySelector<HTMLElement>('.app-overlay button[aria-label="返回"]')
  target?.focus({ preventScroll: true })
}

/** Only snapshots animate: live playback, scrolling and controls keep running.
 * Revision guards are essential: skipTransition() does NOT cancel its update. */
export function createPageMotion() {
  let active: ViewTransition | undefined
  let revision = 0
  let cleanup = () => {}

  return {
    run(change: Change, commit: () => void) {
      const ticket = ++revision
      active?.skipTransition()
      cleanup()
      const kind = kindFor(change)
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const animate = change.motion !== 'none' && !reduced && !change.nativeTransition && document.visibilityState !== 'hidden'
      const root = document.documentElement
      const sources: HTMLElement[] = []
      const nameSource = () => {
        const source = findSource(change.source)
        if (source) { source.style.viewTransitionName = 'app-detail'; sources.push(source) }
      }
      cleanup = () => {
        for (const source of sources) source.style.removeProperty('view-transition-name')
        delete root.dataset.navigationMotion
        delete root.dataset.navigationFallback
      }
      const update = () => {
        if (ticket !== revision) return
        // Remove the old source name before the new full-screen element exists.
        for (const source of sources) source.style.removeProperty('view-transition-name')
        commit()
        if (kind === 'zoom-out') nameSource()
        restoreFocus(kind, change.source)
      }

      if (!animate) { update(); cleanup(); active = undefined; return }
      root.dataset.navigationMotion = kind
      if (!document.startViewTransition) {
        root.dataset.navigationFallback = 'true'
        update()
        // CSS entry/return motion for older browsers; navigation never waits.
        const fallbackCleanup = cleanup
        window.setTimeout(() => { if (ticket === revision) fallbackCleanup() }, 300)
        return
      }
      if (kind === 'zoom-in') nameSource()
      try {
        const transition = document.startViewTransition(update)
        active = transition
        // ready can reject on a duplicate name or an interrupted transition.
        void transition.ready.catch(() => {})
        void transition.finished.catch(() => {}).then(() => {
          if (ticket === revision) { cleanup(); active = undefined }
        })
      } catch {
        // A browser can refuse a transition; it must never refuse navigation.
        update(); cleanup(); active = undefined
      }
    },
    dispose() { ++revision; active?.skipTransition(); cleanup() },
  }
}
