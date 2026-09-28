import { useEffect, useMemo, useState } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import { navigate } from '../hooks/useHashRoute'
import { useCatalog } from '../store/PlayerContext'
import { useCards } from '../hooks/useCards'
import { isMastered } from '../lib/srs'
import { loadWordbook } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import TalkCard from '../components/TalkCard'

const LIMIT = 30

/** 全局搜索：节目标题 + 单词（六级词表与自己加入的词组），英文或中文释义都能搜 */
export default function Search() {
  const { manifest } = useCatalog()
  const { cards } = useCards()
  const [q, setQ] = useState('')
  const [book, setBook] = useState<BookWord[] | null>(null)
  const [bookError, setBookError] = useState(false)

  useEffect(() => {
    loadWordbook().then(setBook).catch(() => setBookError(true))
  }, [])

  const kw = q.trim().toLowerCase()
  const episodes = useMemo(
    () => (kw ? manifest.filter(m => m.title.toLowerCase().includes(kw)).slice(0, LIMIT) : []),
    [manifest, kw],
  )
  const words = useMemo(() => {
    if (!kw) return []
    const seen = new Set<string>()
    const rows: { term: string; meaning: string }[] = []
    const push = (term: string, meaning: string) => {
      if (seen.has(term)) return
      seen.add(term)
      rows.push({ term, meaning })
    }
    // 词头前缀匹配优先，其次是包含与中文释义
    const pool = [
      ...[...cards.values()].map(c => ({ term: c.term, meaning: c.meaning })),
      ...(book ?? []).map(w => ({ term: w.word, meaning: w.zh })),
    ]
    for (const w of pool) if (w.term.startsWith(kw)) push(w.term, w.meaning)
    for (const w of pool) if (w.term.includes(kw) || w.meaning.includes(kw)) push(w.term, w.meaning)
    return rows.slice(0, LIMIT)
  }, [kw, cards, book])

  const close = () => (history.length > 1 ? history.back() : navigate('/'))

  return (
    <div className="search-page">
      <header className="search-header safe-top">
        <label className="search-field">
          <SearchIcon aria-hidden />
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="节目标题、单词或中文释义"
            aria-label="搜索"
            autoFocus
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {q && (
            <button type="button" className="search-clear" onClick={() => setQ('')} aria-label="清空">
              <XIcon />
            </button>
          )}
        </label>
        <button className="search-cancel" onClick={close}>取消</button>
      </header>

      <main className="search-results min-h-0 flex-1 overflow-y-auto no-scrollbar vertical-scroll">
        {!kw && <p className="page-status">搜索节目标题，或者英文单词、中文释义</p>}
        {kw && episodes.length === 0 && words.length === 0 && (
          <p className="page-status">{book || bookError ? '没有找到相关的节目或单词' : '正在加载词表…'}</p>
        )}

        {episodes.length > 0 && (
          <section>
            <h2 className="group-title">节目</h2>
            <div className="episode-list">
              {episodes.map(item => <TalkCard key={item.slug} item={item} />)}
            </div>
          </section>
        )}

        {words.length > 0 && (
          <section>
            <h2 className="group-title">单词</h2>
            <ul className="words-list">
              {words.map(row => {
                const card = cards.get(row.term)
                return (
                  <li key={row.term}>
                    <button className="words-row" onClick={() => navigate(`/word/${encodeURIComponent(row.term)}`)}>
                      <span className="words-term">{row.term}</span>
                      <span className="words-meaning">{row.meaning}</span>
                      <span className="words-state">{!card ? '未学' : isMastered(card) ? '已掌握' : '学习中'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        {bookError && kw && <p className="page-status">词表加载失败，只搜索了节目和你加入的词</p>}
      </main>
    </div>
  )
}
