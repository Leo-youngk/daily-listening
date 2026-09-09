import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCatalog } from '../store/PlayerContext'
import { loadProgress } from '../lib/storage'
import { ArrowDownUpIcon, SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import TalkCard from '../components/TalkCard'

type Tab = 'ted' | 'commencement' | 'bbc' | 'voa'
type Sort = 'hot' | 'duration'
type Filter = 'all' | 'listened' | 'unlistened'

const VALID_TABS = new Set<Tab>(['ted', 'commencement', 'bbc', 'voa'])
const VALID_SORTS = new Set<Sort>(['hot', 'duration'])
const VALID_FILTERS = new Set<Filter>(['all', 'listened', 'unlistened'])

function syncLibraryUrl(tab: string, sort: string, filter: string) {
  const params = new URLSearchParams()
  if (tab !== 'ted') params.set('tab', tab)
  if (sort !== 'hot') params.set('sort', sort)
  if (filter !== 'all') params.set('filter', filter)
  const qs = params.toString()
  const newHash = `/library${qs ? `?${qs}` : ''}`
  if (location.hash.slice(1) !== newHash) {
    history.replaceState(null, '', `#${newHash}`)
  }
}

export default function Library({ query }: { query?: URLSearchParams }) {
  const { manifest, manifestReady, manifestError, reloadManifest } = useCatalog()
  const [tab, setTab] = useState<Tab>(() => {
    const t = query?.get('tab') as Tab
    return t && VALID_TABS.has(t) ? t : 'ted'
  })
  const [sort, setSort] = useState<Sort>(() => {
    const s = query?.get('sort') as Sort
    return s && VALID_SORTS.has(s) ? s : 'hot'
  })
  const [filter, setFilter] = useState<Filter>(() => {
    const f = query?.get('filter') as Filter
    return f && VALID_FILTERS.has(f) ? f : 'all'
  })
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!query) return
    const t = query.get('tab') as Tab
    if (t && VALID_TABS.has(t)) setTab(t)
    const s = query.get('sort') as Sort
    if (s && VALID_SORTS.has(s)) setSort(s)
    const f = query.get('filter') as Filter
    if (f && VALID_FILTERS.has(f)) setFilter(f)
  }, [query])

  const updateTab = useCallback((t: Tab) => { setTab(t); syncLibraryUrl(t, sort, filter) }, [sort, filter])
  const updateSort = useCallback((s: Sort) => { setSort(s); syncLibraryUrl(tab, s, filter) }, [tab, filter])
  const updateFilter = useCallback((f: Filter) => { setFilter(f); syncLibraryUrl(tab, sort, f) }, [tab, sort])

  const list = useMemo(() => {
    let arr = manifest.filter(m => m.category === tab)
    if (q.trim()) {
      // 归一化：小写 + 去空格，支持「Sixth Sense」命中 SixthSense
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
      const kw = norm(q)
      arr = arr.filter(m => norm(`${m.title} ${m.speaker} ${m.school || ''}`).includes(kw))
    }
    const prog = loadProgress()
    if (filter === 'listened') arr = arr.filter(m => prog[m.slug])
    if (filter === 'unlistened') arr = arr.filter(m => !prog[m.slug])
    if (sort === 'duration') arr = [...arr].sort((a, b) => a.duration - b.duration)
    // hot: TED 按播放量，毕业演讲保持清单顺序（即著名程度）
    else if (tab === 'ted') arr = [...arr].sort((a, b) => (b.views || 0) - (a.views || 0))
    return arr
  }, [manifest, tab, q, sort, filter])

  if (!manifestReady) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载语料中…</div>
  }
  if (manifestError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive">{manifestError}</p>
        <button className="text-sm font-semibold text-primary" onClick={reloadManifest}>重新加载</button>
      </div>
    )
  }

  const tabs: [Tab, string][] = [['ted', 'TED'], ['commencement', '毕业演讲'], ['bbc', 'BBC'], ['voa', 'VOA']]
  const sortLabel = tab === 'ted' ? '最热' : tab === 'commencement' ? '经典排序' : '最新'
  const nextFilter: Filter = filter === 'all' ? 'unlistened' : filter === 'unlistened' ? 'listened' : 'all'

  return (
    <div className="library-page">
      <header className="library-header safe-top">
        <div>
          <p className="library-kicker">探索你的下一场听力</p>
          <h1>听力库</h1>
        </div>
        <span className="library-count">{manifest.length} 篇</span>
      </header>

      <div className="library-search">
        <SearchIcon />
        <Input
          id="library-search"
          name="library-search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜索标题、讲者或学校"
        />
      </div>

      <div className="library-tabs overflow-x-auto horizontal-scroll" role="tablist" aria-label="内容来源">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'is-active' : ''}
            onClick={() => updateTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="library-toolbar">
        <div>
          <span className="library-result-count">{list.length} 篇内容</span>
          {filter !== 'all' && <span className="library-filter-note"> · {filter === 'listened' ? '已听过' : '未听过'}</span>}
        </div>
        <div className="library-control-group">
          <button className={sort === 'duration' ? 'is-active' : ''} onClick={() => updateSort(sort === 'duration' ? 'hot' : 'duration')} aria-pressed={sort === 'duration'}>
            <ArrowDownUpIcon /> {sort === 'duration' ? '时长' : sortLabel}
          </button>
          <button className={filter !== 'all' ? 'is-active' : ''} onClick={() => updateFilter(nextFilter)} aria-pressed={filter !== 'all'}>
            {filter === 'all' ? '筛选' : filter === 'unlistened' ? '未听' : '已听'}
          </button>
        </div>
      </div>

      <div className="library-grid">
        {list.map(item => <TalkCard key={item.slug} item={item} variant="grid" />)}
      </div>
      {list.length === 0 && <p className="library-empty">没有匹配的演讲</p>}
    </div>
  )
}
