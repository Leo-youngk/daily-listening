import { useEffect, useMemo, useRef, useState } from 'react'
import { useCatalog } from '../store/PlayerContext'
import { useCards } from '../hooks/useCards'
import { isFinished, loadFavorites, loadProgress, loadStats, streakDays, saveSettings, loadSettings } from '../lib/storage'
import TalkCard from '../components/TalkCard'
import PageHeader from '../components/PageHeader'
import Segmented from '../components/Segmented'
import type { Settings } from '../lib/types'
import { fmtBytes } from '../lib/format'
import { isMastered, reviewStats } from '../lib/srs'
import type { ReviewStats } from '../lib/srs'
import { exportBackup, importBackup } from '../lib/backup'
import { localDateKey } from '../lib/date'
import {
  OFFLINE_EVENT,
  isPersistentCacheName,
  loadOfflineIndex,
  offlineBytes,
  removeAll,
  removeTalk,
  storageEstimate,
} from '../lib/offline'

const DAILY_NEW = ['10', '15', '20', '30'].map(n => [n, n] as const)
const RETENTION = ['0.85', '0.9', '0.95'].map(r => [r, `${Math.round(Number(r) * 100)}%`] as const)
const THEMES = [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const

export default function Me() {
  const { manifest } = useCatalog()
  const { cards } = useCards()
  const [, force] = useState(0)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [cacheStatus, setCacheStatus] = useState<'idle' | 'clearing' | 'done' | 'error'>('idle')
  const [offline, setOffline] = useState(loadOfflineIndex)
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [review, setReview] = useState<ReviewStats | null>(null)
  const [backupNote, setBackupNote] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const f = () => force(x => x + 1)
    window.addEventListener('dtl-storage', f)
    return () => window.removeEventListener('dtl-storage', f)
  }, [])

  useEffect(() => {
    reviewStats().then(setReview).catch(() => setReview(null))
  }, [cards])

  useEffect(() => {
    const sync = () => {
      setOffline(loadOfflineIndex())
      void storageEstimate().then(setEstimate)
    }
    sync()
    window.addEventListener(OFFLINE_EVENT, sync)
    return () => window.removeEventListener(OFFLINE_EVENT, sync)
  }, [])

  const stats = loadStats()
  const prog = loadProgress()
  const finished = Object.values(prog).filter(p => isFinished(p)).length
  const mastered = useMemo(() => [...cards.values()].filter(c => c.inBook && isMastered(c)).length, [cards])
  const favItems = loadFavorites().map(s => manifest.find(m => m.slug === s)).filter(m => m !== undefined)

  const offlineItems = useMemo(
    () => Object.values(offline)
      .sort((a, b) => b.at - a.at)
      .map(entry => ({
        ...entry,
        title: manifest.find(m => m.slug === entry.slug)?.title ?? entry.slug,
      })),
    [offline, manifest],
  )

  const update = (patch: Partial<Settings>) => {
    setSettings(s => ({ ...s, ...patch }))
    saveSettings(patch)
  }

  const doExport = async () => {
    try {
      const blob = await exportBackup()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `每日听力备份-${localDateKey()}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setBackupNote('已导出，请把文件存到"文件"App 或网盘')
    } catch (error) {
      setBackupNote(`导出失败：${error instanceof Error ? error.message : error}`)
    }
  }

  const doImport = async (file: File) => {
    try {
      const result = await importBackup(await file.text())
      setSettings(loadSettings())
      setBackupNote(`已导入 ${result.cards} 个单词、${result.reviews} 条复习记录`)
    } catch (error) {
      setBackupNote(`导入失败：${error instanceof Error ? error.message : error}`)
    }
  }

  const clearCache = async () => {
    setCacheStatus('clearing')
    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        // 离线音频是用户主动下载的，不能被"清除缓存"顺手删掉
        await Promise.all(keys.filter(key => !isPersistentCacheName(key)).map(key => caches.delete(key)))
      }
      setCacheStatus('done')
    } catch {
      setCacheStatus('error')
    }
  }

  return (
    <div className="page me-page">
      <PageHeader title="我的" />

      <div className="me-stats">
        {[
          [String(streakDays()), '连续打卡'],
          [String(Math.round(stats.seconds / 60)), '收听分钟'],
          [String(finished), '听完集数'],
          [String(mastered), '掌握单词'],
        ].map(([num, label]) => (
          <div key={label}>
            <strong>{num}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {review && (
        <p className="me-note">
          今天复习 {review.reviewsToday} 次 · 学习中 {review.learning} 个 · 标熟 {review.known} 个
          {review.retention !== null && ` · 近 30 天记住率 ${Math.round(review.retention * 100)}%`}
        </p>
      )}

      <h2 className="group-title">背词设置</h2>
      <div className="group">
        <div className="group-row">
          <span className="group-row-label">每天新词</span>
          <Segmented kind="choice" size="sm" label="每天新词" value={String(settings.dailyNew)} options={DAILY_NEW}
            onChange={v => update({ dailyNew: Number(v) })} />
        </div>
        <div className="group-row">
          <span className="group-row-label">目标记忆率</span>
          <Segmented kind="choice" size="sm" label="目标记忆率" value={String(settings.retention)} options={RETENTION}
            onChange={v => update({ retention: Number(v) })} />
        </div>
        <p className="group-foot">记忆率越高，复习越频繁、忘得越少。90% 是 Anki 的默认值，适合大多数人。</p>
      </div>

      <h2 className="group-title">我的收藏 · {favItems.length}</h2>
      {favItems.length === 0 ? (
        <p className="group group-empty">在播放页点 ♡ 收藏喜欢的节目</p>
      ) : (
        <div className="episode-list">
          {favItems.map(item => <TalkCard key={item.slug} item={item} />)}
        </div>
      )}

      <div className="group-title-row">
        <h2 className="group-title">离线音频 · {offlineItems.length}</h2>
        {offlineItems.length > 0 && (
          <button className="group-title-action" onClick={() => { void removeAll() }}>全部删除</button>
        )}
      </div>
      {offlineItems.length === 0 ? (
        <p className="group group-empty">在播放页右上角「···」里下载，断网也能听</p>
      ) : (
        <div className="group">
          {offlineItems.map(item => (
            <div key={item.slug} className="group-row">
              <div className="min-w-0 flex-1">
                <p className="group-row-label truncate">{item.title}</p>
                <p className="group-row-sub">
                  {fmtBytes(item.bytes)} · {item.quality === 'high' ? '高音质' : '标准音质'}
                </p>
              </div>
              <button className="row-button" onClick={() => { void removeTalk(item.slug) }}>删除</button>
            </div>
          ))}
          <p className="group-foot">
            共占用 {fmtBytes(offlineBytes())}
            {estimate && estimate.quota > 0 && ` · 本站可用 ${fmtBytes(estimate.quota - estimate.usage)}`}
          </p>
        </div>
      )}

      <h2 className="group-title">设置</h2>
      <div className="group">
        <div className="group-row">
          <span className="group-row-label">外观</span>
          <Segmented kind="choice" size="sm" label="外观" value={settings.theme} options={THEMES}
            onChange={v => update({ theme: v })} />
        </div>
        <div className="group-row">
          <span className="group-row-label">学习记录</span>
          <div className="flex gap-2">
            <button className="row-button" onClick={() => { void doExport() }}>导出</button>
            <button className="row-button" onClick={() => fileInput.current?.click()}>导入</button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = '' }} />
          </div>
        </div>
        {backupNote && <p className="group-foot">{backupNote}</p>}
        <div className="group-row">
          <span className="group-row-label">资源缓存</span>
          <button className="row-button" disabled={cacheStatus === 'clearing'} onClick={() => { void clearCache() }}>
            {cacheStatus === 'clearing' ? '清除中…' : cacheStatus === 'done' ? '已清除' : cacheStatus === 'error' ? '重试' : '清除缓存'}
          </button>
        </div>
      </div>

      <p className="me-foot">
        学习记录只存在本机，换手机或删除 App 前请先导出<br />
        节目来自 BBC Learning English、Leonardo English、Thinking in English，仅供个人学习<br />
        中文为 Gemini 机器翻译 · 词典与六级词表基于 ECDICT（MIT License）<br />
        <span className="tabular-nums">版本 {__BUILD_SHA__} · {__BUILD_TIME__}</span>
      </p>
    </div>
  )
}
