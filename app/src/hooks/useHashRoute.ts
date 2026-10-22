import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { createPageMotion } from '../lib/page-motion'
import type { NavigationMotion } from '../lib/page-motion'

const NAVIGATION_EVENT = 'app:navigate'
const STATE_KEY = 'dailyListeningNavigation'
interface Entry { index: number; hash: string; from?: string; source?: string }
interface Intent { motion?: NavigationMotion; previous?: Entry }
interface NavigateOptions { replace?: boolean; source?: string; motion?: NavigationMotion }
const currentHash = () => location.hash.slice(1) || '/'

function ownedEntry(): Entry | undefined {
  const entry = history.state?.[STATE_KEY] as Entry | undefined
  return entry && Number.isInteger(entry.index) && entry.index >= 0 && entry.hash === currentHash() ? entry : undefined
}
function ensureEntry(): Entry {
  const saved = ownedEntry()
  if (saved) return saved
  const entry = { index: 0, hash: currentHash() }
  history.replaceState({ ...history.state, [STATE_KEY]: entry }, '')
  return entry
}

/** Hash routes with owned history entries and interruptible, bidirectional motion. */
export function useHashRoute() {
  const [hash, setHash] = useState(currentHash)
  useEffect(() => {
    let previous = ensureEntry()
    const motion = createPageMotion()
    const onChange = (event: Event) => {
      const nextHash = currentHash()
      // Browsers dispatch both popstate and hashchange for a hash history move.
      if (previous.hash === nextHash) return
      const intent = event instanceof CustomEvent ? event.detail as Intent : undefined
      const next = ensureEntry()
      const from = intent?.previous ?? previous
      const backwards = intent?.motion === 'back' || next.index < from.index
      previous = next
      motion.run({
        from: from.hash, to: nextHash, backwards,
        source: backwards ? from.source : next.source,
        motion: intent?.motion,
        nativeTransition: 'hasUAVisualTransition' in event && event.hasUAVisualTransition === true,
      }, () => flushSync(() => setHash(nextHash)))
    }
    window.addEventListener('hashchange', onChange)
    window.addEventListener('popstate', onChange)
    window.addEventListener(NAVIGATION_EVENT, onChange)
    return () => {
      window.removeEventListener('hashchange', onChange)
      window.removeEventListener('popstate', onChange)
      window.removeEventListener(NAVIGATION_EVENT, onChange)
      motion.dispose()
    }
  }, [])
  return hash
}

export function navigate(path: string, params?: Record<string, string>, options: NavigateOptions = {}) {
  let hash = path
  if (params) {
    const qs = new URLSearchParams(params).toString()
    if (qs) hash += `${hash.includes('?') ? '&' : '?'}${qs}`
  }
  if (hash === currentHash()) return
  const previous = ensureEntry()
  const next: Entry = options.replace
    ? { ...previous, hash, source: options.source ?? previous.source }
    : { index: previous.index + 1, hash, from: previous.hash, source: options.source }
  history[options.replace ? 'replaceState' : 'pushState']({ [STATE_KEY]: next }, '', `#${hash}`)
  window.dispatchEvent(new CustomEvent<Intent>(NAVIGATION_EVENT, { detail: { previous, motion: options.motion } }))
}

/** Direct links must return inside the app, not leave for an unrelated site. */
export function goBack(fallback: string) {
  if (ownedEntry()?.index) history.back()
  else navigate(fallback, undefined, { replace: true, motion: 'back' })
}

export function parseRoute(hash: string): { page: string; param: string; query: URLSearchParams } {
  const [pathname, search] = hash.split('?')
  const parts = pathname.split('/').filter(Boolean)
  return {
    page: parts[0] || 'programs',
    param: parts.slice(1).join('/'),
    query: new URLSearchParams(search || ''),
  }
}
