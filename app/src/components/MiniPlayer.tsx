import { PauseIcon, PlayIcon } from 'lucide-react'
import { usePlayer, usePlayerClock } from '../store/PlayerContext'
import { navigate } from '../hooks/useHashRoute'
import Cover from './Cover'

/** 底部迷你播放条：封面 · 标题 + 进度 · 播放/暂停 */
export default function MiniPlayer() {
  const { slug, talk, playing, toggle } = usePlayer()
  const { time, duration } = usePlayerClock()
  if (!slug || !talk) return null

  const pct = duration ? Math.min(100, (time / duration) * 100) : 0
  const open = () => navigate(`/talk/${slug}`)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开播放页：${talk.title}`}
      onClick={open}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      className="mini-player"
    >
      <span className="mini-player-art">
        <Cover src={talk.cover} className="mini-player-cover" alt="" />
      </span>
      <span className="mini-player-copy">
        <span className="mini-player-title">{talk.title}</span>
        <span className="mini-player-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
      </span>
      <button
        className="mini-player-toggle"
        onClick={e => { e.stopPropagation(); toggle() }}
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
    </div>
  )
}
