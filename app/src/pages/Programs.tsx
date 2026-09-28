import { useEffect, useMemo, useState } from 'react'
import { useCatalog } from '../store/PlayerContext'
import { useCards } from '../hooks/useCards'
import TalkCard from '../components/TalkCard'
import Cover from '../components/Cover'
import PageHeader from '../components/PageHeader'
import Segmented from '../components/Segmented'
import { isFinished, loadProgress } from '../lib/storage'
import { loadEpisodeWords, loadWordbook } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import { SERIES } from '../lib/types'
import type { Series } from '../lib/types'

type Filter = 'all' | 'unlistened' | 'finished'
const FILTERS: [Filter, string][] = [['all', '全部'], ['unlistened', '未听'], ['finished', '已听完']]
const TABS = SERIES.map(s => [s.key, s.tab] as const)

function syncUrl(tab: Series, filter: Filter) {
  const params = new URLSearchParams()
  if (tab !== 'bbc') params.set('tab', tab)
  if (filter !== 'all') params.set('filter', filter)
  const qs = params.toString()
  const hash = `/programs${qs ? `?${qs}` : ''}`
  if (location.hash.slice(1) !== hash) history.replaceState(null, '', `#${hash}`)
}

export default function Programs({ query }: { query?: URLSearchParams }) {
  const { manifest, manifestReady, manifestError, reloadManifest } = useCatalog()
  const { cards } = useCards()
  const initialTab = query?.get('tab') as Series
  const [tab, setTab] = useState<Series>(SERIES.some(s => s.key === initialTab) ? initialTab : 'bbc')
  const [filter, setFilter] = useState<Filter>((query?.get('filter') as Filter) || 'all')
  const [vocab, setVocab] = useState<{ words: BookWord[]; episodes: Record<string, number[]> } | null>(null)

  useEffect(() => {
    const t = query?.get('tab') as Series
    if (t && SERIES.some(s => s.key === t)) setTab(t)
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
  const all = manifest.filter(m => m.category === tab)
  const list = all.filter(m => filter === 'all'
    || (filter === 'finished' ? isFinished(progress[m.slug]) : !progress[m.slug]))
  const current = SERIES.find(s => s.key === tab)!
  const finishedCount = all.filter(m => isFinished(progress[m.slug])).length

  return (
    <div className="page programs-page">
      <PageHeader title="节目" search />

      <Segmented value={tab} options={TABS} label="节目" onChange={key => { setTab(key); syncUrl(key, filter) }} />

      {manifestError ? (
        <div className="page-status">
          <p>{manifestError}</p>
          <button className="pill-button is-soft is-small" onClick={reloadManifest}>重新加载</button>
        </div>
      ) : !manifestReady ? (
        <div aria-busy>
          <div className="skeleton show-head-skeleton" />
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton episode-row-skeleton" />)}
        </div>
      ) : (
        <>
          <section className="show-head">
            <div className="show-head-art" aria-hidden>
              {all.slice(0, 3).map(m => (
                <span key={m.slug} className="show-head-cover"><Cover src={m.cover} className="show-head-img" alt="" /></span>
              ))}
            </div>
            <div className="show-head-copy">
              <p className="show-head-name">{current.name}</p>
              <p className="show-head-desc">{current.desc}</p>
              <p className="show-head-stats">共 {all.length} 期 · 已听完 {finishedCount}</p>
            </div>
          </section>

          <div className="chips" role="group" aria-label="筛选">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                className="chip"
                aria-pressed={filter === key}
                onClick={() => { setFilter(key); syncUrl(tab, key) }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="episode-list">
            {list.map(item => <TalkCard key={item.slug} item={item} learningHits={hits[item.slug]} />)}
          </div>
          {list.length === 0 && <p className="page-status">没有符合条件的节目</p>}
        </>
      )}
    </div>
  )
}
