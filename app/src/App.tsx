import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useHashRoute, parseRoute } from './hooks/useHashRoute'
import { loadSettings, pruneEpisodes } from './lib/storage'
import { importLegacyVocab } from './lib/migrate'
import { useCatalog } from './store/PlayerContext'
import TabBar from './components/TabBar'
import MiniPlayer from './components/MiniPlayer'
import UpdateBanner from './components/UpdateBanner'
import StorageAlert from './components/StorageAlert'
import Today from './pages/Today'
import Programs from './pages/Programs'
import Player from './pages/Player'
import Words from './pages/Words'
import WordDetail from './pages/WordDetail'
import Review from './pages/Review'
import Me from './pages/Me'
import Search from './pages/Search'

const TAB_PAGES = new Set(['today', 'programs', 'words', 'me'])
/** 全屏页盖在 Tab 页上面（导航栈）：下面的列表不卸载，返回时位置、已展开条数、筛选与搜索词都还在 */
const OVERLAY_PAGES = new Set(['talk', 'review', 'word', 'search'])
const HOME = parseRoute('/')

export default function App() {
  const hash = useHashRoute()
  const route = useMemo(() => parseRoute(hash), [hash])
  const { manifest } = useCatalog()
  const overlay = OVERLAY_PAGES.has(route.page)

  // 全屏页打开期间，下面继续显示进入前的那个 Tab 页
  const [lastTabRoute, setLastTabRoute] = useState(() => (overlay ? HOME : route))
  if (!overlay && lastTabRoute !== route) setLastTabRoute(route)
  const shell = overlay ? lastTabRoute : route
  const tab = TAB_PAGES.has(shell.page) ? shell.page : 'today'

  // 四个 Tab 共用一个滚动容器：各自记住自己的位置，切回来时还原（我的 · 二级页各算一页）
  const mainRef = useRef<HTMLElement>(null)
  const scrollByPage = useRef<Record<string, number>>({})
  const pageKey = tab === 'me' ? `me/${shell.param}` : tab
  useLayoutEffect(() => {
    const main = mainRef.current
    if (!main) return
    const target = scrollByPage.current[pageKey] ?? 0
    main.scrollTop = target
    if (main.scrollTop >= target - 1) return
    // 列表内容异步加载（词表等）时第一帧还不够高，等几帧再还原
    let tries = 0
    let frame = requestAnimationFrame(function retry() {
      main.scrollTop = target
      if (main.scrollTop < target - 1 && ++tries < 30) frame = requestAnimationFrame(retry)
    })
    return () => cancelAnimationFrame(frame)
  }, [pageKey])

  // 主题
  useEffect(() => {
    const apply = () => {
      const t = loadSettings().theme
      document.documentElement.setAttribute('data-theme', t === 'auto' ? '' : t)
    }
    apply()
    const onStorage = () => apply()
    window.addEventListener('dtl-storage', onStorage)
    return () => window.removeEventListener('dtl-storage', onStorage)
  }, [])

  // 旧版生词本一次性导入 IndexedDB
  useEffect(() => {
    importLegacyVocab().catch(error => console.error('legacy vocab import failed', error))
  }, [])

  // 节目换代：清掉已下架节目的进度与收藏
  useEffect(() => {
    if (manifest.length) pruneEpisodes(new Set(manifest.map(item => item.slug)))
  }, [manifest])

  return (
    <>
      <UpdateBanner />
      <StorageAlert />
      <div className="app-shell" inert={overlay} aria-hidden={overlay || undefined}>
        <main
          ref={mainRef}
          onScroll={e => { scrollByPage.current[pageKey] = e.currentTarget.scrollTop }}
          className="app-main min-h-0 flex-1 overflow-y-auto no-scrollbar vertical-scroll"
        >
          {tab === 'today' && <Today />}
          {tab === 'programs' && <Programs query={shell.query} />}
          {tab === 'words' && <Words query={shell.query} />}
          {tab === 'me' && <Me sub={shell.param || undefined} />}
        </main>
        <MiniPlayer />
        <TabBar page={tab} />
      </div>
      {overlay && (
        <div className="app-overlay">
          {route.page === 'talk' ? (
            <Player slug={route.param} />
          ) : route.page === 'review' ? (
            <Review />
          ) : route.page === 'word' ? (
            <WordDetail term={decodeURIComponent(route.param)} />
          ) : (
            <Search />
          )}
        </div>
      )}
    </>
  )
}
