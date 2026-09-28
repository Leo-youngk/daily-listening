import { useEffect, useMemo, useState } from 'react'
import { ChevronRightIcon, SearchIcon, XIcon } from 'lucide-react'
import { useCards } from '../hooks/useCards'
import { useStudySummary } from '../hooks/useStudySummary'
import { navigate } from '../hooks/useHashRoute'
import { formatInterval, isMastered } from '../lib/srs'
import { loadWordbook } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import type { CardRecord } from '../lib/db'
import UnderlineTabs from '../components/UnderlineTabs'

type Segment = 'learning' | 'mastered' | 'lookup' | 'book'
const SEGMENTS: [Segment, string][] = [['learning', '学习中'], ['mastered', '已掌握'], ['lookup', '词表外'], ['book', '六级词表']]
const PAGE = 60

function dueLabel(card: CardRecord, now: number): string {
  if (card.status === 'known') return '已标熟'
  if (isMastered(card)) return '已掌握'
  if (card.due <= now) return '待复习'
  return `${formatInterval(card.due - now)}后`
}

/** 顶部概况：已掌握 / 学习中 / 未学 + 按真实比例画的进度条 + 今天的背词入口 */
function Summary({ total }: { total: number }) {
  const s = useStudySummary()
  const untouched = Math.max(0, total - s.mastered - s.learning)
  // 有进度就至少露出一点，否则几个词在 5000 多词里看不见
  const pct = (n: number) => (total && n > 0 ? Math.max(1, Math.min(100, (n / total) * 100)) : 0)
  const allDone = s.ready && s.due === 0 && s.fresh === 0

  return (
    <section className="words-summary" aria-label="六级词表进度">
      <div className="words-stats">
        <div><strong>{s.ready ? s.mastered : '–'}</strong><span>已掌握</span></div>
        <div><strong>{s.ready ? s.learning : '–'}</strong><span>学习中</span></div>
        <div><strong>{total && s.ready ? untouched : '–'}</strong><span>未学</span></div>
      </div>
      <div className="words-meter" aria-hidden>
        <span className="is-mastered" style={{ width: `${pct(s.mastered)}%` }} />
        <span className="is-learning" style={{ width: `${pct(s.learning)}%` }} />
      </div>
      <div className="words-book-row">
        <p>六级词表<span> · {total ? `${total}词` : '–'}</span></p>
        {allDone ? (
          <span className="pill-button is-soft is-static">今天背完了</span>
        ) : (
          <button className="pill-button" onClick={() => navigate('/review')} disabled={!s.ready}>
            {s.due > 0 ? `复习 ${s.due}` : `学新词 ${s.fresh}`}
          </button>
        )}
      </div>
    </section>
  )
}

export default function Words({ query }: { query?: URLSearchParams }) {
  const { cards, ready } = useCards()
  const [segment, setSegment] = useState<Segment>((query?.get('seg') as Segment) || 'learning')
  const [book, setBook] = useState<BookWord[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadWordbook().then(setBook).catch(() => setError('词表加载失败，请检查网络'))
  }, [])

  const now = Date.now()
  const rows = useMemo(() => {
    let list: { term: string; meaning: string; card?: CardRecord }[]
    if (segment === 'book') {
      list = book.map(w => ({ term: w.word, meaning: w.zh, card: cards.get(w.word) }))
    } else {
      const picked = [...cards.values()].filter(c =>
        segment === 'learning' ? c.status === 'learning' && !isMastered(c)
          : segment === 'mastered' ? isMastered(c)
            : !c.inBook)
      picked.sort((a, b) => (segment === 'learning' ? a.due - b.due : b.updatedAt - a.updatedAt))
      list = picked.map(c => ({ term: c.term, meaning: c.meaning, card: c }))
    }
    const q = keyword.trim().toLowerCase()
    return q ? list.filter(r => r.term.toLowerCase().includes(q) || r.meaning.includes(q)) : list
  }, [segment, book, cards, keyword])

  return (
    <div className="page words-page tab-top">
      <Summary total={book.length} />

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

      <UnderlineTabs
        className="words-segments"
        value={segment}
        options={SEGMENTS}
        label="单词分组"
        onChange={key => { setSegment(key); setLimit(PAGE) }}
      />

      {error && <p className="page-status">{error}</p>}
      {ready && rows.length === 0 && !error && (
        <p className="page-status">
          {keyword ? '没有匹配的单词'
            : segment === 'lookup' ? '查词加入的词组、六级词表以外的词会出现在这里'
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
