import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCatalog } from '../store/PlayerContext'
import { loadProgress } from '../lib/storage'
import { SearchIcon } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
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

/** 可点击的筛选胶囊 */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <Badge
      asChild
      variant={active ? 'default' : 'secondary'}
      className={cn('h-7 cursor-pointer rounded-full px-3 text-xs', !active && 'text-muted-foreground')}
    >
      <button onClick={onClick}>{children}</button>
    </Badge>
  )
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

  return (
    <div className="px-3 pb-4">
      <h1 className="safe-top pb-2 pt-3 text-xl font-bold">听力库</h1>

      {/* 分类 */}
      <Tabs value={tab} onValueChange={v => updateTab(v as Tab)} className="gap-0">
        <TabsList className="grid h-10 w-full grid-cols-4 rounded-xl">
          <TabsTrigger value="ted" className="rounded-lg">TED 演讲</TabsTrigger>
          <TabsTrigger value="commencement" className="rounded-lg">毕业演讲</TabsTrigger>
          <TabsTrigger value="bbc" className="rounded-lg">BBC</TabsTrigger>
          <TabsTrigger value="voa" className="rounded-lg">VOA</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 搜索 */}
      <div className="relative mt-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="library-search"
          name="library-search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="搜索标题 / 讲者 / 学校"
          className="h-10 rounded-xl border-transparent bg-card pl-10 shadow-xs ring-1 ring-foreground/5"
        />
      </div>

      {/* 排序与筛选 */}
      <div className="mt-2.5 flex gap-2 overflow-x-auto no-scrollbar horizontal-scroll">
        {([['hot', tab === 'ted' ? '最热' : tab === 'commencement' ? '经典排序' : '最新'], ['duration', '按时长']] as [Sort, string][]).map(([k, label]) => (
          <Chip key={k} active={sort === k} onClick={() => updateSort(k)}>{label}</Chip>
        ))}
        <span className="w-1 shrink-0" />
        {([['all', '全部'], ['unlistened', '未听过'], ['listened', '听过']] as [Filter, string][]).map(([k, label]) => (
          <Chip key={k} active={filter === k} onClick={() => updateFilter(k)}>{label}</Chip>
        ))}
      </div>

      <p className="mt-3 mb-2 text-xs text-muted-foreground">{list.length} 篇</p>
      <div className="space-y-2">
        {list.map(item => <TalkCard key={item.slug} item={item} />)}
        {list.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的演讲</p>}
      </div>
    </div>
  )
}
