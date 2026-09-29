import { useMemo } from 'react'
import { useCards } from './useCards'
import { isMastered, startOfToday } from '../lib/srs'
import { loadSettings } from '../lib/storage'

/** 今天的背词任务与词表进度：底栏角标、单词页共用 */
export function useStudySummary() {
  const { cards, ready } = useCards()
  return useMemo(() => {
    const list = [...cards.values()]
    const now = Date.now()
    const today = startOfToday()
    const due = list.filter(c => c.status === 'learning' && c.due <= now).length
    const started = list.filter(c => c.inBook && c.status === 'learning' && c.addedAt >= today).length
    const fresh = Math.max(0, loadSettings().dailyNew - started)
    const book = list.filter(c => c.inBook)
    const mastered = book.filter(isMastered).length
    return { ready, due, fresh, mastered, learning: book.length - mastered }
  }, [cards, ready])
}
