/** A browsing round keeps the order the user opened, even when marking a word
 * removes it from the live list. Keep a few rounds for browser back/forward. */
export interface WordBrowse {
  id: string
  terms: string[]
  label: string
  returnTo: string
}

const STORAGE_KEY = 'word-browse-v1'
const MAX_ROUNDS = 4
let memory: WordBrowse[] = []
let hydrated = false

function rounds(): WordBrowse[] {
  if (hydrated) return memory
  hydrated = true
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]')
    if (Array.isArray(saved)) {
      memory = saved.filter((item): item is WordBrowse =>
        !!item && typeof item.id === 'string' && typeof item.label === 'string' &&
        typeof item.returnTo === 'string' && item.returnTo.startsWith('/words') &&
        Array.isArray(item.terms) && item.terms.length <= 10_000 &&
        item.terms.every((term: unknown) => typeof term === 'string' && term.length <= 200),
      ).slice(-MAX_ROUNDS)
    }
  } catch { /* Private mode / storage full: the current round still works. */ }
  return memory
}

export function createWordBrowse(terms: string[], label: string, returnTo: string): WordBrowse {
  const round: WordBrowse = {
    id: crypto.randomUUID(), terms: [...new Set(terms)], label, returnTo,
  }
  memory = [...rounds(), round].slice(-MAX_ROUNDS)
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory)) } catch { /* memory fallback */ }
  return round
}

export function getWordBrowse(id: string | undefined, term: string) {
  if (!id) return null
  const round = rounds().find(item => item.id === id)
  if (!round) return null
  const index = round.terms.indexOf(term)
  if (index < 0) return null
  return {
    ...round, index, total: round.terms.length,
    previous: round.terms[index - 1], next: round.terms[index + 1],
  }
}
