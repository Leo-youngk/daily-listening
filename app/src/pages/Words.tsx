import { useEffect, useMemo, useState } from 'react'
import { ChevronRightIcon, SearchIcon, XIcon } from 'lucide-react'
import { useCards } from '../hooks/useCards'
import { useStudySummary } from '../hooks/useStudySummary'
import { navigate } from '../hooks/useHashRoute'
import { formatInterval, isMastered } from '../lib/srs'
import { loadWordbook } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import type { CardRecord } from '../lib/db'
import Segmented from '../components/Segmented'

type Segment = 'learning' | 'mastered' | 'lookup' | 'book'
const SEGMENTS: [Segment, string][] = [['learning', '学习中'], ['mastered', '已掌握'], ['lookup', '词表外'], ['book', '六级词表']]
const isSegment = (value: string | null | undefined): value is Segment => SEGMENTS.some(([key]) => key === value)
const PAGE = 60

function dueLabel(card: CardRecord, now: number): string {
  if (card.status === 'known') return '已标熟'
  if (isMastered(card)) return '已掌握'
  if (card.due <= now) return '待复习'
  return `${formatInterval(card.due - now)}后`
}

/** 顶部概况：已掌握 / 学习中 / 未学 + 按真实比例的双色进度条 + 今日任务入口 */
function WordsSummary({ total }: { total: number }) {
  const s = useStudySummary()
  const untouched = Math.max(0, total - s.mastered - s.learning)
  const masteredPct = total ? Math.min(100, (s.mastered / total) * 100) : 0
  const learningPct = total ? Math.min(100 - masteredPct, (s.learning / total) * 100) : 0
  const action = !s.ready ? null
    : s.due > 0 ? `复习 ${s.due}`
      : s.fresh > 0 ? `学新词 ${s.fresh}` : null

  return (
    <section className="words-summary" aria-label="词表进度">
      <div className="words-summary-stats">
        {[
          [s.ready ? s.mastered : '–', '已掌握'],
          [s.ready ? s.learning : '–', '学习中'],
          [s.ready && total ? untouched : '–', '未学'],
        ].map(([num, label]) => (
          <div key={label}>
            <strong>{num}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div
        className="words-summary-meter"
        role="img"
        aria-label={total ? `已掌握 ${masteredPct.toFixed(1)}%，学习中 ${learningPct.toFixed(1)}%` : '词表加载中'}
      >
        <span className="is-mastered" style={{ width: `${masteredPct}%` }} />
        <span className="is-learning" style={{ width: `${learningPct}%` }} />
      </div>
      <div className="words-summary-row">
        <p>六级词表<span> · {total ? `${total}词` : '–'}</span></p>
        {action ? (
          <button className="pill-button is-compact" onClick={() => navigate('/review')}>{action}</button>
        ) : (
          <span className="pill-button is-compact is-soft is-static">{s.ready ? '今天背完了' : '加载中'}</span>
        )}
      </div>
    </section>
  )
}

export default function Words({ query }: { query?: URLSearchParams }) {
  const { cards, ready } = useCards()
  const initialSegment = query?.get('seg')
  const [segment, setSegment] = useState<Segment>(isSegment(initialSegment) ? initialSegment : 'learning')
  const [book, setBook] = useState<BookWord[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadWordbook().then(setBook).catch(() => setError('词表加载失败，请检查网络'))
  }, [])

  const now = Date.now()
  const kw = keyword.trim().toLowerCase()
  const rows = useMemo(() => {
    let out: { term: string; meaning: string; card?: CardRecord }[]
    if (segment === 'book') {
      out = book.map(w => ({ term: w.word, meaning: w.zh, card: cards.get(w.word) }))
    } else {
      const picked = [...cards.values()].filter(c =>
        segment === 'learning' ? c.status === 'learning' && !isMastered(c)
          : segment === 'mastered' ? isMastered(c)
            : !c.inBook)
      picked.sort((a, b) => (segment === 'learning' ? a.due - b.due : b.updatedAt - a.updatedAt))
      out = picked.map(c => ({ term: c.term, meaning: c.meaning, card: c }))
    }
    if (!kw) return out
    // 词头前缀匹配排在前面，其次是词中包含与中文释义
    const prefix = out.filter(r => r.term.startsWith(kw))
    const rest = out.filter(r => !r.term.startsWith(kw) && (r.term.includes(kw) || r.meaning.includes(kw)))
    return [...prefix, ...rest]
  }, [segment, book, cards, kw])

  const switchSegment = (key: Segment) => {
    setSegment(key)
    setLimit(PAGE)
  }

  return (
    <div className="page is-bare words-page">
      <WordsSummary total={book.length} />

      <label className="search-field page-search">
        <SearchIcon aria-hidden />
        <input
          type="search"
          value={keyword}
          onChange={e => { setKeyword(e.target.value); setLimit(PAGE) }}
          placeholder="搜索单词或释义"
          aria-label="搜索单词或释义"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {keyword && (
          <button type="button" className="search-clear" onClick={() => setKeyword('')} aria-label="清空">
            <XIcon />
          </button>
        )}
      </label>

      <Segmented
        className="words-segments"
        variant="underline"
        value={segment}
        options={SEGMENTS}
        label="单词分组"
        onChange={switchSegment}
      />

      {error && <p className="page-status">{error}</p>}
      {ready && rows.length === 0 && !error && (
        kw ? (
          <div className="page-status">
            <p>当前分组里没有“{keyword.trim()}”</p>
            {segment !== 'book' && (
              <button className="pill-button is-soft is-small" onClick={() => switchSegment('book')}>在六级词表里搜</button>
            )}
          </div>
        ) : (
          <p className="page-status">
            {segment === 'lookup' ? '查词加入的词组、六级词表以外的词会出现在这里'
              : segment === 'mastered' ? '复习间隔超过 21 天的词会出现在这里' : '这里还没有单词'}
          </p>
        )
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
                <ChevronRightIcon className="words-chevron" aria-hidden />
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
