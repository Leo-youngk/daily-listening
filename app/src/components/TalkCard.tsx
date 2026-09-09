import type { ManifestItem } from '../lib/types'
import { loadProgress, loadFavorites } from '../lib/storage'
import { fmtDuration, fmtViews } from '../lib/format'
import { navigate } from '../hooks/useHashRoute'
import { HeartIcon } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import Cover from './Cover'
import { usePlayerActions } from '../store/PlayerContext'

interface Props {
  item: ManifestItem
  showProgress?: boolean
  variant?: 'list' | 'grid'
}

export default function TalkCard({ item, showProgress = true, variant = 'list' }: Props) {
  const { playTalk } = usePlayerActions()
  const progress = loadProgress()[item.slug]
  const fav = loadFavorites().includes(item.slug)
  const pct = progress && item.duration ? Math.min(100, (progress.pos / item.duration) * 100) : 0
  const sub = item.category === 'commencement'
    ? `${item.speaker} · ${item.school || ''}${item.year ? ' ' + item.year : ''}`
    : item.category === 'voa' || item.category === 'bbc'
      ? `${item.speaker}${item.year ? ' · ' + item.year : ''}`
      : `${item.speaker} · ${fmtViews(item.views)}`

  const fallback = item.category === 'ted' ? 'TED' : item.category === 'bbc' ? 'BBC' : item.category === 'voa' ? 'VOA' : '毕业'
  const open = () => {
    playTalk(item.slug)
    navigate(`/talk/${item.slug}`)
  }

  if (variant === 'grid') {
    return (
      <button onClick={open} className="talk-grid-card">
        <div className="talk-grid-cover">
          {item.cover ? <Cover src={item.cover} className="size-full object-cover" alt={item.title} /> : <span>{fallback}</span>}
          {fav && <HeartIcon className="talk-grid-favorite" aria-label="已收藏" />}
          {showProgress && pct > 0 && <Progress value={pct} className="talk-grid-progress" />}
        </div>
        <div className="talk-grid-body">
          <p className="talk-grid-title">{item.title}</p>
          <p className="talk-grid-meta">{item.speaker} · {fmtDuration(item.duration)}</p>
        </div>
      </button>
    )
  }

  return (
    <button onClick={open} className="talk-list-card">
      <div className="talk-list-cover">
        {item.cover ? <Cover src={item.cover} className="size-full object-cover" alt={item.title} /> : <span>{fallback}</span>}
      </div>
      <div className="talk-list-body">
        <div className="talk-list-title-row">
          <p className="talk-list-title">{item.title}</p>
          {fav && <HeartIcon className="talk-list-favorite" aria-label="已收藏" />}
        </div>
        <p className="talk-list-meta">{sub} · {fmtDuration(item.duration)}</p>
        {showProgress && pct > 0 && <Progress value={pct} className="talk-list-progress" />}
      </div>
    </button>
  )
}
