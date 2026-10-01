import { useRef, useState } from 'react'
import { RepeatIcon } from 'lucide-react'
import { Slider } from './ui/slider'
import { usePlayer, usePlayerClock } from '../store/PlayerContext'
import { fmtTime } from '../lib/format'

/** 拖动只更新本组件的预览，松手才 seek；音频时钟不会覆盖正在拖动的位置。 */
export default function PlaybackScrubber({ onLoopSettings, onSeekCommit }: {
  onLoopSettings: () => void
  onSeekCommit: (time: number) => void
}) {
  const { seek, loop } = usePlayer()
  const { time, duration } = usePlayerClock()
  const [preview, setPreview] = useState<number | null>(null)
  const dragging = useRef(false)
  const pointerInteraction = useRef(false)
  const moved = useRef(false)
  const target = useRef(time)
  const displayed = preview ?? time
  const endPreview = () => { dragging.current = false; setPreview(null) }
  const commit = (value: number) => { seek(value); onSeekCommit(value) }

  return (
    <div className="player-scrubber">
      <Slider
        className="player-scrub"
        min={0}
        max={duration || 100}
        step={0.5}
        value={[displayed]}
        onPointerDown={() => {
          dragging.current = true
          pointerInteraction.current = true
          moved.current = false
          target.current = time
          setPreview(time)
        }}
        onPointerUp={() => {
          // 拖出去又回到原位置时 Radix 不触发 onValueCommit，但音频已向前播放，仍需提交。
          if (dragging.current && moved.current) commit(target.current)
          endPreview()
        }}
        onPointerCancel={endPreview}
        onLostPointerCapture={endPreview}
        onKeyDown={() => { pointerInteraction.current = false; endPreview() }}
        onValueChange={values => {
          // Radix 的键盘提交可能先于 onValueChange；键盘直接 seek，不留下悬空预览。
          if (dragging.current) {
            moved.current = true
            target.current = values[0]
            setPreview(values[0])
          }
        }}
        onValueCommit={values => {
          // 指针由 pointerup 提交，键盘由 Radix 提交，避免一次松手 seek 两次。
          if (!pointerInteraction.current) commit(values[0])
        }}
        aria-label="播放进度"
        aria-valuetext={`${fmtTime(displayed)} / ${fmtTime(duration)}`}
      />
      <div className="player-times">
        <span>{fmtTime(displayed)}</span>
        {loop !== 0 && (
          <button className="player-loop-tag" onClick={onLoopSettings}>
            <RepeatIcon />单句循环{loop === 999 ? '' : ` ×${loop}`}
          </button>
        )}
        <span>-{fmtTime(Math.max(0, duration - displayed))}</span>
      </div>
    </div>
  )
}
