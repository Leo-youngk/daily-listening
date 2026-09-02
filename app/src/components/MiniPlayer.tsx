import { usePlayer, usePlayerClock } from '../store/PlayerContext'
import { navigate } from '../hooks/useHashRoute'
import { fmtTime } from '../lib/format'
import { PauseIcon, PlayIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import Cover from './Cover'

export default function MiniPlayer() {
  const { slug, talk, playing, toggle } = usePlayer()
  const { time, duration } = usePlayerClock()
  if (!slug || !talk) return null

  const pct = duration ? (time / duration) * 100 : 0
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开播放页：${talk.title}`}
      onClick={() => navigate(`/talk/${slug}`)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/talk/${slug}`)
        }
      }}
      className="glass border-t border-line px-3 py-2"
    >
      <div className="flex items-center gap-3">
        {talk.cover ? (
          <Cover src={talk.cover} className="h-10 w-10 rounded-lg object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">♪</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{talk.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{talk.speaker} · {fmtTime(time)}</p>
        </div>
        <Button
          size="icon"
          className="size-9 rounded-full shadow-sm"
          onClick={e => { e.stopPropagation(); toggle() }}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
        </Button>
      </div>
      <Progress value={pct} className="mt-1.5 h-0.5 rounded-none" />
    </div>
  )
}
