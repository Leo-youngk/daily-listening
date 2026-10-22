import { Activity, useEffect, useMemo, useState } from 'react'
import { useHashRoute, parseRoute } from './hooks/useHashRoute'
import { pruneEpisodes } from './lib/storage'
import { importLegacyVocab } from './lib/migrate'
import { useCatalog } from './store/PlayerContext'
import TabBar from './components/TabBar'
import MiniPlayer from './components/MiniPlayer'
import UpdateBanner from './components/UpdateBanner'
import StorageAlert from './components/StorageAlert'
import Programs from './pages/Programs'
import Player from './pages/Player'
import Words from './pages/Words'
import WordDetail from './pages/WordDetail'
import Review from './pages/Review'
import Me from './pages/Me'
import TabPage from './components/TabPage'

const TAB_PAGES = new Set(['programs', 'words', 'me'])
/** 全屏页盖在 Tab 页上面（导航栈）：下面的列表不卸载，返回时位置、已展开条数、筛选与搜索词都还在 */
const OVERLAY_PAGES = new Set(['talk', 'review', 'word'])
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
  const tab = TAB_PAGES.has(shell.page) ? shell.page : 'programs'

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
        <Activity mode={tab === 'programs' && !overlay ? 'visible' : 'hidden'}>
          <TabPage pageKey="programs" active={tab === 'programs' && !overlay}>
            <Programs query={tab === 'programs' ? shell.query : undefined} />
          </TabPage>
        </Activity>
        <Activity mode={tab === 'words' && !overlay ? 'visible' : 'hidden'}>
          <TabPage pageKey="words" active={tab === 'words' && !overlay}>
            <Words query={tab === 'words' ? shell.query : undefined} />
          </TabPage>
        </Activity>
        <Activity mode={tab === 'me' && !overlay ? 'visible' : 'hidden'}>
          <TabPage pageKey={`me/${shell.param}`} active={tab === 'me' && !overlay}>
            <Me sub={shell.param || undefined} />
          </TabPage>
        </Activity>
        {/* 迷你播放器与底栏悬浮在内容上方，列表从毛玻璃下面滚过去 */}
        <Activity mode={overlay ? 'hidden' : 'visible'}>
          <div className="app-dock">
            {!overlay && <MiniPlayer />}
            <TabBar page={tab} />
          </div>
        </Activity>
      </div>
      {overlay && (
        <div className="app-overlay">
          {route.page === 'talk' ? (
            <Player key={route.param} slug={route.param} />
          ) : route.page === 'review' ? (
            <Review />
          ) : (
            <WordDetail key={route.param} term={decodeURIComponent(route.param)} browseId={route.query.get('browse') ?? undefined} />
          )}
        </div>
      )}
    </>
  )
}
