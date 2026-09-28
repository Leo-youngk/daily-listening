import { useEffect, useMemo, useState } from 'react'
import { useCards } from '../hooks/useCards'
import { navigate } from '../hooks/useHashRoute'
import { formatInterval, isMastered } from '../lib/srs'
import { loadWordbook } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import type { CardRecord } from '../lib/db'
import PageHeader from '../components/PageHeader'
import Segmented from '../components/Segmented'
import StudyCard from '../components/StudyCard'

type Segment = 'learning' | 'mastered' | 'lookup' | 'book'
const SEGMENTS: [Segment, string][] = [['learning', '学习中'], ['mastered', '已掌握'], ['lookup', '词表外'], ['book', '六级词表']]
const PAGE = 60

function dueLabel(card: CardRecord, now: number): string {
  if (card.status === 'known') return '已标熟'
  if (isMastered(card)) return '已掌握'
  if (card.due <= now) return '待复习'
  return `${formatInterval(card.due - now)}后`
}

export default function Words({ query }: { query?: URLSearchParams }) {
  const { cards, ready } = useCards()
  const [segment, setSegment] = useState<Segment>((query?.get('seg') as Segment) || 'learning')
  const [book, setBook] = useState<BookWord[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadWordbook().then(setBook).catch(() => setError('词表加载失败，请检查网络'))
  }, [])

  const now = Date.now()
  const rows = useMemo(() => {
    if (segment === 'book') {
      return book.map(w => ({ term: w.word, meaning: w.zh, card: cards.get(w.word) }))
    }
    const picked = [...cards.values()].filter(c =>
      segment === 'learning' ? c.status === 'learning' && !isMastered(c)
        : segment === 'mastered' ? isMastered(c)
          : !c.inBook)
    picked.sort((a, b) => (segment === 'learning' ? a.due - b.due : b.updatedAt - a.updatedAt))
    return picked.map(c => ({ term: c.term, meaning: c.meaning, card: c }))
  }, [segment, book, cards])

  return (
    <div className="page words-page">
      <PageHeader title="单词" search />
      <StudyCard detailed total={book.length} />

      <Segmented
        className="words-segments"
        value={segment}
        options={SEGMENTS}
        label="单词分组"
        onChange={key => { setSegment(key); setLimit(PAGE) }}
      />

      {error && <p className="page-status">{error}</p>}
      {ready && rows.length === 0 && !error && (
        <p className="page-status">
          {segment === 'lookup' ? '查词加入的词组、六级词表以外的词会出现在这里'
            : segment === 'mastered' ? '复习间隔超过 21 天的词会出现在这里' : '这里还没有单词'}
        </p>
      )}

      <ul className="words-list">
        {rows.slice(0, limit).map(row => {
          const state = row.card ? dueLabel(row.card, now) : '未学'
          return (
            <li key={row.term}>
              <button onClick={() => navigate(`/word/${encodeURIComponent(row.term)}`)} className="words-row">
                <span className="words-term">{row.term}</span>
                <span className="words-meaning">{row.meaning}</span>
                <span className={`words-state ${state === '待复习' ? 'is-due' : ''}`}>{state}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {rows.length > limit && (
        <button className="words-more" onClick={() => setLimit(n => n + PAGE)}>
          再显示 {Math.min(PAGE, rows.length - limit)} 个（共 {rows.length}）
        </button>
      )}
    </div>
  )
}
