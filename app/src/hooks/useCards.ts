import { useEffect, useSyncExternalStore } from 'react'
import { db, CARDS_EVENT } from '../lib/db'
import type { CardRecord } from '../lib/db'

/**
 * 全部卡片的内存快照。卡片最多几千张，整表读进内存比逐条查询简单，
 * 词表页、字幕上色、首页计数共用一份，写库后由 CARDS_EVENT 触发重读。
 */
interface Snapshot {
  ready: boolean
  cards: Map<string, CardRecord>
}

let snapshot: Snapshot = { ready: false, cards: new Map() }
const listeners = new Set<() => void>()
let loading: Promise<void> | null = null

function reload() {
  loading = db.cards.toArray()
    .then(list => {
      snapshot = { ready: true, cards: new Map(list.map(card => [card.term, card])) }
    })
    .catch(error => {
      console.error('load cards failed', error)
      snapshot = { ready: true, cards: snapshot.cards }
    })
    .finally(() => {
      loading = null
      listeners.forEach(listener => listener())
    })
}

if (typeof window !== 'undefined') {
  window.addEventListener(CARDS_EVENT, reload)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCards(): Snapshot {
  const value = useSyncExternalStore(subscribe, () => snapshot)
  useEffect(() => {
    if (!snapshot.ready && !loading) reload()
  }, [])
  return value
}
