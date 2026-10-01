import { useEffect, useRef, useState } from 'react'
import { fmtBytes } from '../lib/format'
import {
  OFFLINE_EVENT,
  AUDIO_DOWNLOAD_EVENT,
  audioDownloadStatus,
  cancelAudioDownload,
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
  const [status, setStatus] = useState(() => audioDownloadStatus(slug))
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const entry: OfflineEntry | null = index[slug] ?? null

  useEffect(() => {
    const sync = () => setIndex(loadOfflineIndex())
    const syncDownload = () => setStatus(audioDownloadStatus(slug))
    syncDownload()
    window.addEventListener(OFFLINE_EVENT, sync)
    window.addEventListener(AUDIO_DOWNLOAD_EVENT, syncDownload)
    return () => {
      window.removeEventListener(OFFLINE_EVENT, sync)
      window.removeEventListener(AUDIO_DOWNLOAD_EVENT, syncDownload)
    }
  }, [slug])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // 切换篇目时中止上一篇没下完的请求。关闭播放设置不会取消下载，
  // 这样用户可以把下载放到后台继续，重新打开面板时从索引恢复状态。
  const slugRef = useRef(slug)
  useEffect(() => {
    if (slugRef.current !== slug) {
      abortRef.current?.abort()
      slugRef.current = slug
    }
  }, [slug])

  const start = async () => {
    if (!url) return
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await downloadTalk(
        slug,
        quality,
        url,
        undefined,
        controller.signal,
      )
    } catch (downloadError) {
      if (mountedRef.current && !controller.signal.aborted) {
        setError(downloadError instanceof Error ? downloadError.message : '下载失败')
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const cancel = () => { abortRef.current?.abort(); cancelAudioDownload(slug) }

  const downloading = status !== null && ['queued', 'downloading', 'paused'].includes(status.state)
  const percent = status && status.total > 0
    ? Math.min(100, Math.round((status.received / status.total) * 100))
    : null

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="group-row-label">本地音频</p>
          <p className="group-row-sub">
            {entry
              ? `已存本地 · ${fmtBytes(entry.bytes)} · ${entry.quality === 'high' ? '高音质' : '标准音质'}`
              : downloading
                ? status.state === 'paused' ? '优先播放，稍后继续保存' : percent === null ? '正在保存到本地…' : `自动保存 ${percent}% · ${fmtBytes(status.received)}`
                : status?.state === 'error' ? '自动保存未完成，点下载继续' : '收听时自动保存，下次直接听'}
          </p>
        </div>
        {entry ? (
          <div className="flex shrink-0 gap-2">
            {entry.pinned === false && <button className="row-button" onClick={() => { void start() }}>保留</button>}
            <button className="row-button" onClick={() => { void removeTalk(slug).catch(() => setError('删除失败，请重试')) }}>删除</button>
          </div>
        ) : downloading ? (
          <button className="row-button" onClick={cancel}>取消</button>
        ) : (
          <button className="row-button is-accent" disabled={!url} onClick={() => { void start() }}>下载</button>
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
