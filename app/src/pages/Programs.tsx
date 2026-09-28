import { useEffect, useMemo, useState } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import { useCatalog } from '../store/PlayerContext'
import { useCards } from '../hooks/useCards'
import TalkCard from '../components/TalkCard'
import Segmented from '../components/Segmented'
import { isFinished, loadProgress } from '../lib/storage'
import { loadEpisodeWords, loadWordbook } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import { SERIES } from '../lib/types'
import type { Series } from '../lib/types'

type Channel = 'all' | Series
type Filter = 'all' | 'unlistened' | 'finished'
const FILTERS: [Filter, string][] = [['all', '全部'], ['unlistened', '未听'], ['finished', '已听完']]
const CHANNELS: [Channel, string][] = [['all', '全部'], ...SERIES.map(s => [s.key, s.tab] as [Channel, string])]
const isChannel = (value: string | null | undefined): value is Channel => CHANNELS.some(([key]) => key === value)
const isFilter = (value: string | null | undefined): value is Filter => FILTERS.some(([key]) => key === value)

function syncUrl(channel: Channel, filter: Filter) {
  const params = new URLSearchParams()
  if (channel !== 'all') params.set('tab', channel)
  if (filter !== 'all') params.set('filter', filter)
  const qs = params.toString()
  const hash = `/programs${qs ? `?${qs}` : ''}`
  if (location.hash.slice(1) !== hash) history.replaceState(null, '', `#${hash}`)
}

export default function Programs({ query }: { query?: URLSearchParams }) {
  const { manifest, manifestReady, manifestError, reloadManifest } = useCatalog()
  const { cards } = useCards()
  const initialTab = query?.get('tab')
  const initialFilter = query?.get('filter')
  const [channel, setChannel] = useState<Channel>(isChannel(initialTab) ? initialTab : 'all')
  const [filter, setFilter] = useState<Filter>(isFilter(initialFilter) ? initialFilter : 'all')
  const [keyword, setKeyword] = useState('')
  const [vocab, setVocab] = useState<{ words: BookWord[]; episodes: Record<string, number[]> } | null>(null)

  useEffect(() => {
    const t = query?.get('tab')
    if (isChannel(t)) setChannel(t)
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
  const kw = keyword.trim().toLowerCase()
  // 跨频道时按发布日期倒序；单个频道保持 manifest 里的顺序
  const list = manifest
    .filter(m => channel === 'all' || m.category === channel)
    .filter(m => filter === 'all'
      || (filter === 'finished' ? isFinished(progress[m.slug]) : !progress[m.slug]))
    .filter(m => !kw || m.title.toLowerCase().includes(kw))
  if (channel === 'all') list.sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="page is-bare programs-page">
      <label className="search-field page-search">
        <SearchIcon aria-hidden />
        <input
          type="search"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
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

      <div className="chips" role="tablist" aria-label="频道">
        {CHANNELS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            className="chip"
            aria-selected={channel === key}
            onClick={() => { setChannel(key); syncUrl(key, filter) }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="filter-row">
        <Segmented
          variant="underline"
          size="sm"
          value={filter}
          options={FILTERS}
          label="收听状态"
          onChange={key => { setFilter(key); syncUrl(channel, key) }}
        />
        {manifestReady && <span className="filter-row-count">{list.length} 期</span>}
      </div>

      {manifestError ? (
        <div className="page-status">
          <p>{manifestError}</p>
          <button className="pill-button is-soft is-small" onClick={reloadManifest}>重新加载</button>
        </div>
      ) : !manifestReady ? (
        <div aria-busy>
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton episode-row-skeleton" />)}
        </div>
      ) : (
        <>
          <div className="episode-list">
            {list.map(item => <TalkCard key={item.slug} item={item} learningHits={hits[item.slug]} />)}
          </div>
          {list.length === 0 && <p className="page-status">{kw ? '没有找到相关节目' : '没有符合条件的节目'}</p>}
        </>
      )}
    </div>
  )
}
