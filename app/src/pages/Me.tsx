import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import {
  BookOpenIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, DatabaseIcon, DownloadIcon, FileTextIcon, HeartIcon,
  InfoIcon, MoonIcon, TargetIcon,
} from 'lucide-react'
import { useCatalog } from '../store/PlayerContext'
import { useCards } from '../hooks/useCards'
import { navigate } from '../hooks/useHashRoute'
import { isFinished, loadFavorites, loadProgress, loadStats, streakDays, saveSettings, loadSettings } from '../lib/storage'
import TalkCard from '../components/TalkCard'
import type { Settings } from '../lib/types'
import { fmtBytes } from '../lib/format'
import { reviewStats } from '../lib/srs'
import type { ReviewStats } from '../lib/srs'
import { exportBackup, importBackup } from '../lib/backup'
import { localDateKey } from '../lib/date'
import { useStudySummary } from '../hooks/useStudySummary'
import {
  OFFLINE_EVENT,
  isPersistentCacheName,
  loadOfflineIndex,
  offlineBytes,
  removeAll,
  removeTalk,
  storageEstimate,
} from '../lib/offline'

type Sub = 'daily' | 'retention' | 'theme' | 'favorites' | 'offline' | 'about'
type Icon = ComponentType<SVGProps<SVGSVGElement>>

const DAILY_NEW = [10, 15, 20, 30]
const RETENTION = [0.85, 0.9, 0.95]
const THEMES: [Settings['theme'], string][] = [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']]
const pctLabel = (r: number) => `${Math.round(r * 100)}%`

/** 从"我的"点进二级页时记一笔，返回时走浏览器后退（保住滚动位置）；深链进来的直接回"我的" */
let enteredFromMe = false
function openSub(sub: Sub) {
  enteredFromMe = true
  navigate(`/me/${sub}`)
}
function closeSub() {
  if (enteredFromMe) {
    enteredFromMe = false
    history.back()
  } else {
    navigate('/me')
  }
}

function useOffline() {
  const [offline, setOffline] = useState(loadOfflineIndex)
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  useEffect(() => {
    const sync = () => {
      setOffline(loadOfflineIndex())
      void storageEstimate().then(setEstimate)
    }
    sync()
    window.addEventListener(OFFLINE_EVENT, sync)
    return () => window.removeEventListener(OFFLINE_EVENT, sync)
  }, [])
  return { offline, estimate }
}

function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const update = (patch: Partial<Settings>) => {
    setSettings(s => ({ ...s, ...patch }))
    saveSettings(patch)
  }
  return [settings, update, setSettings] as const
}

/** 分组里的一行：玫红线性图标 · 标题 · 右侧值/控件 · 可选 chevron */
function Row({ icon: RowIcon, label, value, onClick, children }: {
  icon: Icon
  label: string
  value?: ReactNode
  onClick?: () => void
  children?: ReactNode
}) {
  const body = (
    <>
      <RowIcon className="me-row-icon" aria-hidden />
      <span className="group-row-label me-row-label">{label}</span>
      {value !== undefined && <span className="me-row-value">{value}</span>}
      {children}
      {onClick && <ChevronRightIcon className="me-row-chevron" aria-hidden />}
    </>
  )
  return onClick
    ? <button type="button" className="group-row me-row" onClick={onClick}>{body}</button>
    : <div className="group-row me-row">{body}</div>
}

function SubPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page me-sub">
      <header className="sub-header safe-top">
        <button className="sub-back" onClick={closeSub} aria-label="返回">
          <ChevronLeftIcon />
        </button>
        <h1 className="sub-title">{title}</h1>
        <span aria-hidden />
      </header>
      {children}
    </div>
  )
}

/** 单选列表：iOS 设置里的勾选样式 */
function ChoiceList<T extends string | number>({ value, options, onChange }: {
  value: T
  options: [T, string][]
  onChange: (value: T) => void
}) {
  return (
    <div className="group" role="radiogroup">
      {options.map(([key, label]) => (
        <button
          key={String(key)}
          type="button"
          role="radio"
          aria-checked={value === key}
          className="group-row me-choice"
          onClick={() => onChange(key)}
        >
          <span className="group-row-label">{label}</span>
          {value === key && <CheckIcon className="me-choice-check" aria-hidden />}
        </button>
      ))}
    </div>
  )
}

function DailySub() {
  const [settings, update] = useSettings()
  return (
    <SubPage title="每天新词">
      <ChoiceList value={settings.dailyNew} options={DAILY_NEW.map(n => [n, `${n} 词`])} onChange={v => update({ dailyNew: v })} />
      <p className="me-sub-foot">每天从六级词表里新学的词数。复习量会随新词累积，刚开始建议 10~15 个。</p>
    </SubPage>
  )
}

function RetentionSub() {
  const [settings, update] = useSettings()
  const [review, setReview] = useState<ReviewStats | null>(null)
  useEffect(() => { reviewStats().then(setReview).catch(() => setReview(null)) }, [])
  return (
    <SubPage title="目标记忆率">
      <ChoiceList value={settings.retention} options={RETENTION.map(r => [r, pctLabel(r)])} onChange={v => update({ retention: v })} />
      <p className="me-sub-foot">
        记忆率越高，复习越频繁、忘得越少。90% 是 Anki 的默认值，适合大多数人。
        {review?.retention != null && <><br />你近 30 天的实际记住率是 {pctLabel(review.retention)}。</>}
      </p>
    </SubPage>
  )
}

function ThemeSub() {
  const [settings, update] = useSettings()
  return (
    <SubPage title="外观">
      <ChoiceList value={settings.theme} options={THEMES} onChange={v => update({ theme: v })} />
    </SubPage>
  )
}

function FavoritesSub() {
  const { manifest } = useCatalog()
  const items = loadFavorites().map(s => manifest.find(m => m.slug === s)).filter(m => m !== undefined)
  return (
    <SubPage title="我的收藏">
      {items.length === 0 ? (
        <p className="group group-empty">在播放页点 ♡ 收藏喜欢的节目</p>
      ) : (
        <div className="episode-list">
          {items.map(item => <TalkCard key={item.slug} item={item} showSeries />)}
        </div>
      )}
    </SubPage>
  )
}

function OfflineSub() {
  const { manifest } = useCatalog()
  const { offline, estimate } = useOffline()
  const items = Object.values(offline)
    .sort((a, b) => b.at - a.at)
    .map(entry => ({ ...entry, title: manifest.find(m => m.slug === entry.slug)?.title ?? entry.slug }))
  return (
    <SubPage title="离线音频">
      {items.length === 0 ? (
        <p className="group group-empty">在播放页右上角「···」里下载，断网也能听</p>
      ) : (
        <>
          <div className="group">
            {items.map(item => (
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
          </div>
          <p className="me-sub-foot">
            共占用 {fmtBytes(offlineBytes())}
            {estimate && estimate.quota > 0 && ` · 本站还可用 ${fmtBytes(estimate.quota - estimate.usage)}`}
          </p>
          <button className="me-danger" onClick={() => { void removeAll() }}>全部删除</button>
        </>
      )}
    </SubPage>
  )
}

function AboutSub() {
  return (
    <SubPage title="素材与版本信息">
      <div className="group">
        <div className="group-row is-stacked">
          <p className="group-row-label">节目来源</p>
          <p className="group-row-sub">
            BBC Learning English《6 Minute English》、Leonardo English《English Learning for Curious Minds》、
            《Thinking in English》。音频与文稿版权归原作者，仅供个人学习。
          </p>
        </div>
        <div className="group-row is-stacked">
          <p className="group-row-label">中文翻译</p>
          <p className="group-row-sub">字幕中文全部为机器翻译（Gemini，少数几期由 Claude 补翻），可能有误，以英文原文为准。</p>
        </div>
        <div className="group-row is-stacked">
          <p className="group-row-label">词典与词表</p>
          <p className="group-row-sub">离线词典与六级词表基于 ECDICT（MIT License）。</p>
        </div>
        <div className="group-row">
          <span className="group-row-label">版本</span>
          <span className="me-row-value tabular-nums">{__BUILD_SHA__} · {__BUILD_TIME__}</span>
        </div>
      </div>
    </SubPage>
  )
}

function MeHome() {
  const { cards } = useCards()
  const summary = useStudySummary()
  const [, force] = useState(0)
  const [settings, , setSettings] = useSettings()
  const [cacheStatus, setCacheStatus] = useState<'idle' | 'clearing' | 'done' | 'error'>('idle')
  const { offline } = useOffline()
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

  const stats = loadStats()
  const finished = Object.values(loadProgress()).filter(p => isFinished(p)).length
  const favCount = loadFavorites().length
  const offlineCount = useMemo(() => Object.keys(offline).length, [offline])

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
    <div className="page me-page tab-top">
      <section className="me-card">
        <div className="me-stats">
          {[
            [String(streakDays()), '连续天数'],
            [String(Math.round(stats.seconds / 60)), '收听分钟'],
            [String(finished), '听完集数'],
            [summary.ready ? String(summary.mastered) : '–', '掌握单词'],
          ].map(([num, label]) => (
            <div key={label}>
              <strong>{num}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <p className="me-note">
          今天复习 {review ? review.reviewsToday : '–'} 次 · 学习中 {summary.ready ? summary.learning : '–'} 词
        </p>
      </section>

      <div className="group me-group">
        <Row icon={BookOpenIcon} label="每天新词" value={`${settings.dailyNew}词`} onClick={() => openSub('daily')} />
        <Row icon={TargetIcon} label="目标记忆率" value={pctLabel(settings.retention)} onClick={() => openSub('retention')} />
        <Row icon={MoonIcon} label="外观" value={THEMES.find(([k]) => k === settings.theme)?.[1]} onClick={() => openSub('theme')} />
      </div>

      <div className="group me-group">
        <Row icon={HeartIcon} label="我的收藏" value={favCount} onClick={() => openSub('favorites')} />
        <Row
          icon={DownloadIcon}
          label="离线音频"
          value={offlineCount ? `${offlineCount}集 · ${fmtBytes(offlineBytes())}` : '未下载'}
          onClick={() => openSub('offline')}
        />
      </div>

      <div className="group me-group">
        <Row icon={FileTextIcon} label="学习记录">
          <div className="flex gap-2">
            <button className="row-button" onClick={() => { void doExport() }}>导出</button>
            <button className="row-button" onClick={() => fileInput.current?.click()}>导入</button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = '' }} />
          </div>
        </Row>
        <Row icon={DatabaseIcon} label="资源缓存">
          <button className="me-text-button" disabled={cacheStatus === 'clearing'} onClick={() => { void clearCache() }}>
            {cacheStatus === 'clearing' ? '清除中…' : cacheStatus === 'done' ? '已清除' : cacheStatus === 'error' ? '重试' : '清除缓存'}
          </button>
        </Row>
        <p className="group-foot">{backupNote ?? '学习记录仅保存在本机，换设备前请先导出。'}</p>
      </div>

      <div className="group me-group">
        <Row icon={InfoIcon} label="素材与版本信息" onClick={() => openSub('about')} />
      </div>
    </div>
  )
}

const SUBS: Record<Sub, ComponentType> = {
  daily: DailySub,
  retention: RetentionSub,
  theme: ThemeSub,
  favorites: FavoritesSub,
  offline: OfflineSub,
  about: AboutSub,
}

export default function Me({ sub }: { sub?: string }) {
  const Page = sub ? SUBS[sub as Sub] : undefined
  return Page ? <Page /> : <MeHome />
}
