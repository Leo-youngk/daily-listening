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

/** Commit during the input event. Local transform/opacity animations never
 * capture the page, suspend painting, or queue navigation behind an animation. */
export function createPageMotion() {
  let timer: number | undefined
  const root = document.documentElement
  const cleanup = () => {
    window.clearTimeout(timer)
    timer = undefined
    delete root.dataset.navigationMotion
  }

  return {
    run(change: Change, commit: () => void) {
      cleanup()
      const kind = kindFor(change)
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const animate = change.motion !== 'none' && !reduced && !change.nativeTransition && document.visibilityState !== 'hidden'
      if (animate) root.dataset.navigationMotion = kind
      try {
        commit()
        restoreFocus(kind, change.source)
      } finally {
        if (animate) timer = window.setTimeout(cleanup, 240)
      }
    },
    dispose: cleanup,
  }
}
