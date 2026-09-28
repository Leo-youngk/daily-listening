import { useEffect, useMemo, useState } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import { useCatalog, usePlayer } from '../store/PlayerContext'
import { useCards } from '../hooks/useCards'
import TalkCard from '../components/TalkCard'
import UnderlineTabs from '../components/UnderlineTabs'
import { isFinished, loadProgress } from '../lib/storage'
import { loadEpisodeWords, loadWordbook } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import type { Series } from '../lib/types'

type Channel = 'all' | Series
type Filter = 'all' | 'unlistened' | 'finished'
const CHANNELS: [Channel, string][] = [['all', '全部'], ['bbc', 'BBC'], ['curious', 'Curious'], ['thinking', 'Thinking'], ['featured', '精选']]
const FILTERS: [Filter, string][] = [['all', '全部'], ['unlistened', '未听'], ['finished', '已听完']]
const PAGE = 40

function syncUrl(channel: Channel, filter: Filter) {
  const params = new URLSearchParams()
  if (channel !== 'all') params.set('tab', channel)
  if (filter !== 'all') params.set('filter', filter)
  const qs = params.toString()
  const hash = `/programs${qs ? `?${qs}` : ''}`
  if (location.hash.slice(1) !== hash) history.replaceState(null, '', `#${hash}`)
}

const parseChannel = (value?: string | null): Channel =>
  CHANNELS.some(([key]) => key === value) ? value as Channel : 'all'

export default function Programs({ query }: { query?: URLSearchParams }) {
  const { manifest, manifestReady, manifestError, reloadManifest } = useCatalog()
  const player = usePlayer()
  const { cards } = useCards()
  const [channel, setChannel] = useState<Channel>(parseChannel(query?.get('tab')))
  const [filter, setFilter] = useState<Filter>((query?.get('filter') as Filter) || 'all')
  const [keyword, setKeyword] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [vocab, setVocab] = useState<{ words: BookWord[]; episodes: Record<string, number[]> } | null>(null)

  useEffect(() => {
    const t = query?.get('tab')
    if (t) setChannel(parseChannel(t))
  }, [query])

  useEffect(() => {
    Promise.all([loadWordbook(), loadEpisodeWords()])
      .then(([words, episodes]) => setVocab({ words, episodes }))
      .catch(error => {
        console.error('wordbook load failed, hiding learning hits', error)
        setVocab(null)
      })
  }, [])

  // 每集含多少你在学的词
  const hits = useMemo(() => {
    const out: Record<string, number> = {}
    if (!vocab) return out
    const learning = new Set([...cards.values()].filter(c => c.status === 'learning').map(c => c.term))
    if (!learning.size) return out
    for (const [slug, indices] of Object.entries(vocab.episodes)) {
      out[slug] = indices.filter(k => learning.has(vocab.words[k]?.word)).length
    }
    return out
  }, [vocab, cards])

  const progress = loadProgress()
  const q = keyword.trim().toLowerCase()
  const list = manifest
    .filter(m => channel === 'all' || m.category === channel)
    .filter(m => filter === 'all'
      || (filter === 'finished' ? isFinished(progress[m.slug]) : !progress[m.slug]))
    .filter(m => !q || m.title.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date))

  const choose = (next: Channel, nextFilter: Filter) => {
    setChannel(next)
    setFilter(nextFilter)
    setLimit(PAGE)
    syncUrl(next, nextFilter)
  }

  return (
    <div className="page programs-page tab-top">
      <label className="search-field page-search">
        <SearchIcon aria-hidden />
        <input
          type="search"
          value={keyword}
          onChange={e => { setKeyword(e.target.value); setLimit(PAGE) }}
          placeholder="搜索节目标题"
          aria-label="搜索节目标题"
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

      <div className="chips programs-channels" role="group" aria-label="频道">
        {CHANNELS.map(([key, label]) => (
          <button key={key} className="chip" aria-pressed={channel === key} onClick={() => choose(key, filter)}>
            {label}
          </button>
        ))}
      </div>

      <UnderlineTabs
        className="programs-filters"
        value={filter}
        options={FILTERS}
        label="收听状态"
        onChange={key => choose(channel, key)}
        aside={manifestReady ? `${list.length} 期` : undefined}
      />

      {manifestError ? (
        <div className="page-status">
          <p>{manifestError}</p>
          <button className="pill-button is-soft is-small" onClick={reloadManifest}>重新加载</button>
        </div>
      ) : !manifestReady ? (
        <div aria-busy>
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton episode-row-skeleton" />)}
        </div>
      ) : (
        <>
          <div className="episode-list">
            {list.slice(0, limit).map(item => (
              <TalkCard
                key={item.slug}
                item={item}
                learningHits={hits[item.slug]}
                showSeries={channel === 'all' || channel === 'featured'}
                nowPlaying={player.slug === item.slug ? (player.playing ? 'playing' : 'paused') : undefined}
              />
            ))}
          </div>
          {list.length > limit && (
            <button className="words-more" onClick={() => setLimit(n => n + PAGE)}>
              再显示 {Math.min(PAGE, list.length - limit)} 期（共 {list.length}）
            </button>
          )}
          {list.length === 0 && <p className="page-status">{q ? '没有匹配的节目' : '没有符合条件的节目'}</p>}
        </>
      )}
    </div>
  )
}
