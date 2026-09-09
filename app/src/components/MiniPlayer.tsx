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
      className="mini-player"
    >
      <div className="mini-player-row">
        {talk.cover ? (
          <Cover src={talk.cover} className="mini-player-cover" alt={talk.title} />
        ) : (
          <div className="mini-player-cover mini-player-fallback">♪</div>
        )}
        <div className="mini-player-copy">
          <p>{talk.title}</p>
          <small>{talk.speaker} · {fmtTime(time)}</small>
        </div>
        <Button
          size="icon"
          className="mini-player-button"
          onClick={e => { e.stopPropagation(); toggle() }}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
        </Button>
      </div>
      <Progress value={pct} className="mini-player-progress" />
    </div>
  )
}
