import { useEffect } from 'react'
import { useHashRoute, parseRoute } from './hooks/useHashRoute'
import { loadSettings } from './lib/storage'
import TabBar from './components/TabBar'
import MiniPlayer from './components/MiniPlayer'
import UpdateBanner from './components/UpdateBanner'
import StorageAlert from './components/StorageAlert'
import Discover from './pages/Discover'
import Library from './pages/Library'
import Player from './pages/Player'
import Vocab from './pages/Vocab'
import Me from './pages/Me'

export default function App() {
  const hash = useHashRoute()
  const { page, param } = parseRoute(hash)

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

  return (
    <>
      <UpdateBanner />
      <StorageAlert />
      {page === 'talk' ? (
        <Player slug={param} />
      ) : (
        <div className="mx-auto flex h-full max-w-lg flex-col">
          <main className="min-h-0 flex-1 overflow-y-auto no-scrollbar vertical-scroll">
            {page === 'library' && <Library />}
            {page === 'vocab' && <Vocab />}
            {page === 'me' && <Me />}
            {page === 'discover' && <Discover />}
          </main>
          <MiniPlayer />
          <TabBar page={page} />
        </div>
      )}
    </>
  )
}
