import { PauseIcon, PlayIcon } from 'lucide-react'
import { usePlayer, usePlayerClock } from '../store/PlayerContext'
import { navigate } from '../hooks/useHashRoute'
import { showName } from '../lib/types'
import Cover from './Cover'

/** 底部悬浮迷你播放器：封面 · 标题与节目名 · 播放/暂停，底边是收听进度 */
export default function MiniPlayer() {
  const { slug, talk, playing, toggle } = usePlayer()
  const { time, duration } = usePlayerClock()
  if (!slug || !talk) return null

  const pct = duration ? Math.min(100, (time / duration) * 100) : 0
  const open = () => navigate(`/talk/${slug}`, undefined, { source: `mini:${slug}` })
  return (
    <div className="mini-player">
      <button type="button" className="mini-player-open" data-motion-source={`mini:${slug}`} onClick={open} aria-label={`打开播放页：${talk.title}`}>
        <span className="mini-player-art">
          <Cover src={talk.cover} className="mini-player-cover" alt="" />
        </span>
        <span className="mini-player-copy">
          <span className="mini-player-title">{talk.title}</span>
          <span className="mini-player-series">{showName(talk)}</span>
        </span>
      </button>
      <button
        type="button"
        className="mini-player-toggle"
        onClick={toggle}
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="mini-player-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
    </div>
  )
}
