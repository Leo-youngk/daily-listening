import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { fmtBytes } from '../lib/format'
import {
  OFFLINE_EVENT,
  downloadTalk,
  loadOfflineIndex,
  removeTalk,
} from '../lib/offline'
import type { OfflineEntry, OfflineIndex } from '../lib/offline'
import type { AudioQuality } from '../lib/types'

/**
 * 单篇离线下载开关。
 * 放在播放设置里而不是列表页：下载是低频动作，给列表每一行都挂个按钮只会增加噪音。
 */
export default function OfflineControl({ slug, quality, url }: {
  slug: string
  quality: AudioQuality
  url?: string
}) {
  // 整份索引进 state、当前篇目在渲染时取：
  // 这样切换篇目不需要在 effect 里补一次 setState
  const [index, setIndex] = useState<OfflineIndex>(loadOfflineIndex)
  const [received, setReceived] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const entry: OfflineEntry | null = index[slug] ?? null

  useEffect(() => {
    const sync = () => setIndex(loadOfflineIndex())
    window.addEventListener(OFFLINE_EVENT, sync)
    return () => window.removeEventListener(OFFLINE_EVENT, sync)
  }, [])

  // 切换篇目时中止上一篇没下完的请求
  useEffect(() => () => abortRef.current?.abort(), [slug])

  const start = async () => {
    if (!url) return
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    setReceived({ done: 0, total: 0 })
    try {
      await downloadTalk(slug, quality, url, (done, total) => setReceived({ done, total }), controller.signal)
    } catch (downloadError) {
      if (!controller.signal.aborted) {
        setError(downloadError instanceof Error ? downloadError.message : '下载失败')
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setReceived(null)
    }
  }

  const cancel = () => abortRef.current?.abort()

  const downloading = received !== null
  const percent = received && received.total > 0
    ? Math.min(100, Math.round((received.done / received.total) * 100))
    : null

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">离线下载</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">
            {entry
              ? `已存本地 · ${fmtBytes(entry.bytes)} · ${entry.quality === 'high' ? '高音质' : '标准音质'}`
              : downloading
                ? percent === null ? `已下载 ${fmtBytes(received.done)}` : `${percent}% · ${fmtBytes(received.done)}`
                : '存到本地后断网也能听'}
          </p>
        </div>
        {entry ? (
          <Button
            variant="secondary"
            size="xs"
            className="rounded-full px-3 text-muted-foreground"
            onClick={() => { void removeTalk(slug) }}
          >
            删除
          </Button>
        ) : downloading ? (
          <Button variant="secondary" size="xs" className="rounded-full px-3 text-muted-foreground" onClick={cancel}>
            取消
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="xs"
            className="rounded-full px-3"
            disabled={!url}
            onClick={() => { void start() }}
          >
            下载
          </Button>
        )}
      </div>

      {downloading && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={percent === null ? 'h-full w-1/3 animate-pulse bg-primary' : 'h-full bg-primary transition-[width] duration-200'}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
