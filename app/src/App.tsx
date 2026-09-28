import { useEffect } from 'react'
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

export default function App() {
  const hash = useHashRoute()
  const { page, param, query } = parseRoute(hash)
  const { manifest } = useCatalog()

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

  const tab = TAB_PAGES.has(page) ? page : 'today'

  return (
    <>
      <UpdateBanner />
      <StorageAlert />
      {page === 'talk' ? (
        <Player slug={param} />
      ) : page === 'review' ? (
        <Review />
      ) : page === 'word' ? (
        <WordDetail term={decodeURIComponent(param)} />
      ) : page === 'search' ? (
        <Search />
      ) : (
        <div className="app-shell">
          <main className="app-main min-h-0 flex-1 overflow-y-auto no-scrollbar vertical-scroll">
            {tab === 'today' && <Today />}
            {tab === 'programs' && <Programs query={query} />}
            {tab === 'words' && <Words query={query} />}
            {tab === 'me' && <Me />}
          </main>
          <MiniPlayer />
          <TabBar page={tab} />
        </div>
      )}
    </>
  )
}
