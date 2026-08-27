import type { ManifestItem } from '../lib/types'
import { loadProgress, loadFavorites } from '../lib/storage'
import { fmtViews } from '../lib/format'
import { navigate } from '../hooks/useHashRoute'
import { HeartIcon } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import Cover from './Cover'

interface Props {
  item: ManifestItem
  showProgress?: boolean
}

export default function TalkCard({ item, showProgress = true }: Props) {
  const progress = loadProgress()[item.slug]
  const fav = loadFavorites().includes(item.slug)
  const pct = progress && item.duration ? Math.min(100, (progress.pos / item.duration) * 100) : 0
  const sub = item.category === 'commencement'
    ? `${item.speaker} · ${item.school || ''}${item.year ? ' ' + item.year : ''}`
    : `${item.speaker} · ${fmtViews(item.views)}`

  return (
    <button
      onClick={() => navigate(`/talk/${item.slug}`)}
      className="flex w-full items-center gap-3 rounded-xl bg-card p-3 text-left shadow-xs ring-1 ring-foreground/5 transition active:scale-[0.99]"
    >
      {item.cover ? (
        <Cover src={item.cover} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
          {item.category === 'ted' ? 'TED' : '🎓'}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1">
          <p className="line-clamp-2 flex-1 text-[14px] font-medium leading-snug">{item.title}</p>
          {fav && <HeartIcon className="mt-0.5 size-3.5 shrink-0 fill-brand text-brand" />}
        </div>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{sub}</p>
        {showProgress && pct > 0 && <Progress value={pct} className="mt-1.5 h-1" />}
      </div>
    </button>
  )
}
