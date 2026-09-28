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

type Icon = ComponentType<SVGProps<SVGSVGElement>>

const DAILY_NEW = [10, 15, 20, 30].map(n => [String(n), `${n} 词`] as const)
const RETENTION = [0.85, 0.9, 0.95].map(r => [String(r), `${Math.round(r * 100)}%`] as const)
const THEMES = [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const

/** 二级页：每天新词 / 目标记忆率 / 外观（单选），我的收藏 / 离线音频（列表），素材与版本信息 */
const SECTIONS = ['daily-new', 'retention', 'theme', 'favorites', 'offline', 'about'] as const
type Section = typeof SECTIONS[number]
const TITLES: Record<Section, string> = {
  'daily-new': '每天新词',
  retention: '目标记忆率',
  theme: '外观',
  favorites: '我的收藏',
  offline: '离线音频',
  about: '素材与版本信息',
}
const isSection = (value: string): value is Section => (SECTIONS as readonly string[]).includes(value)

const labelOf = (options: readonly (readonly [string, string])[], value: string) =>
  options.find(([key]) => key === value)?.[1] ?? value

/** 设置式分组里的一行：玫红线性图标 · 标题 · 右侧值或控件 · 可选 chevron */
function MeRow({ icon: RowIcon, label, value, onClick, children }: {
  icon: Icon
  label: string
  value?: ReactNode
  onClick?: () => void
  children?: ReactNode
}) {
  const body = (
    <>
      <RowIcon className="me-row-icon" aria-hidden />
      <span className="me-row-label">{label}</span>
      {value !== undefined && <span className="me-row-value">{value}</span>}
      {children}
      {onClick && <ChevronRightIcon className="me-row-chevron" aria-hidden />}
    </>
  )
  return onClick
    ? <button className="me-row" onClick={onClick}>{body}</button>
    : <div className="me-row">{body}</div>
}

/** 单选二级页的一组选项：选中项打勾 */
function ChoiceList<T extends string>({ options, value, onChange, label }: {
  options: readonly (readonly [T, string])[]
  value: string
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="group" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} className="group-row me-choice" role="radio" aria-checked={value === key} onClick={() => onChange(key)}>
          <span className="group-row-label">{text}</span>
          {value === key && <CheckIcon className="me-choice-check" aria-hidden />}
        </button>
      ))}
    </div>
  )
}

function SubPage({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const back = () => (history.length > 1 ? history.back() : navigate('/me'))
  return (
    <div className="page is-sub me-page">
      <header className="sub-header safe-top">
        <button className="sub-back" onClick={back} aria-label="返回我的">
          <ChevronLeftIcon />
        </button>
        <h1 className="sub-title">{title}</h1>
        <div className="sub-action">{action}</div>
      </header>
      {children}
    </div>
  )
}

export default function Me({ section = '' }: { section?: string }) {
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

  if (isSection(section)) {
    const title = TITLES[section]
    switch (section) {
      case 'daily-new':
        return (
          <SubPage title={title}>
            <ChoiceList label={title} options={DAILY_NEW} value={String(settings.dailyNew)}
              onChange={v => update({ dailyNew: Number(v) })} />
            <p className="me-hint">每天从六级词表里新学的词数。复习量会随新词累积，刚开始建议 10~15 个。</p>
          </SubPage>
        )
      case 'retention':
        return (
          <SubPage title={title}>
            <ChoiceList label={title} options={RETENTION} value={String(settings.retention)}
              onChange={v => update({ retention: Number(v) })} />
            <p className="me-hint">
              记忆率越高，复习越频繁、忘得越少。90% 是 Anki 的默认值，适合大多数人。
              {review?.retention != null && ` 你近 30 天的实际记住率是 ${Math.round(review.retention * 100)}%。`}
            </p>
          </SubPage>
        )
      case 'theme':
        return (
          <SubPage title={title}>
            <ChoiceList label={title} options={THEMES} value={settings.theme} onChange={v => update({ theme: v })} />
          </SubPage>
        )
      case 'favorites':
        return (
          <SubPage title={title}>
            {favItems.length === 0 ? (
              <p className="page-status">在播放页点 ♡ 收藏喜欢的节目</p>
            ) : (
              <div className="episode-list">
                {favItems.map(item => <TalkCard key={item.slug} item={item} />)}
              </div>
            )}
          </SubPage>
        )
      case 'offline':
        return (
          <SubPage
            title={title}
            action={offlineItems.length > 0 && (
              <button className="sub-action-button" onClick={() => { void removeAll() }}>全部删除</button>
            )}
          >
            {offlineItems.length === 0 ? (
              <p className="page-status">在播放页右上角「···」里下载，断网也能听</p>
            ) : (
              <>
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
                </div>
                <p className="me-hint">
                  共占用 {fmtBytes(offlineBytes())}
                  {estimate && estimate.quota > 0 && ` · 本站可用 ${fmtBytes(estimate.quota - estimate.usage)}`}
                </p>
              </>
            )}
          </SubPage>
        )
      case 'about':
        return (
          <SubPage title={title}>
            <div className="group">
              <div className="group-row is-stacked">
                <p className="group-row-label">节目来源</p>
                <p className="group-row-sub">BBC Learning English（6 Minute English）、Leonardo English（Curious Minds）、Thinking in English。音频与文稿版权归原作者，仅供个人学习。</p>
              </div>
              <div className="group-row is-stacked">
                <p className="group-row-label">中文译文</p>
                <p className="group-row-sub">全部为 Gemini 机器翻译，仅供理解参考。</p>
              </div>
              <div className="group-row is-stacked">
                <p className="group-row-label">词典与六级词表</p>
                <p className="group-row-sub">基于 ECDICT（MIT License）。</p>
              </div>
              <div className="group-row">
                <span className="group-row-label">版本</span>
                <span className="me-row-value tabular-nums">{__BUILD_SHA__} · {__BUILD_TIME__}</span>
              </div>
            </div>
          </SubPage>
        )
    }
  }

  const offlineValue = offlineItems.length ? `${offlineItems.length}集 · ${fmtBytes(offlineBytes())}` : '未下载'

  return (
    <div className="page is-bare me-page">
      <section className="me-summary" aria-label="学习统计">
        <div className="me-stats">
          {[
            [String(streakDays()), '连续天数'],
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
          <p className="me-note">今天复习 {review.reviewsToday} 次 · 学习中 {review.learning} 词</p>
        )}
      </section>

      <div className="group me-group">
        <MeRow icon={BookOpenIcon} label="每天新词" value={`${settings.dailyNew}词`} onClick={() => navigate('/me/daily-new')} />
        <MeRow icon={TargetIcon} label="目标记忆率" value={labelOf(RETENTION, String(settings.retention))}
          onClick={() => navigate('/me/retention')} />
        <MeRow icon={MoonIcon} label="外观" value={labelOf(THEMES, settings.theme)} onClick={() => navigate('/me/theme')} />
      </div>

      <div className="group me-group">
        <MeRow icon={HeartIcon} label="我的收藏" value={favItems.length} onClick={() => navigate('/me/favorites')} />
        <MeRow icon={DownloadIcon} label="离线音频" value={offlineValue} onClick={() => navigate('/me/offline')} />
      </div>

      <div className="group me-group">
        <MeRow icon={FileTextIcon} label="学习记录">
          <div className="me-row-buttons">
            <button className="row-button" onClick={() => { void doExport() }}>导出</button>
            <button className="row-button" onClick={() => fileInput.current?.click()}>导入</button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = '' }} />
          </div>
        </MeRow>
        <MeRow icon={DatabaseIcon} label="资源缓存">
          <button className="me-row-link" disabled={cacheStatus === 'clearing'} onClick={() => { void clearCache() }}>
            {cacheStatus === 'clearing' ? '清除中…' : cacheStatus === 'done' ? '已清除' : cacheStatus === 'error' ? '重试' : '清除缓存'}
          </button>
        </MeRow>
        <p className="group-foot">{backupNote ?? '学习记录仅保存在本机，换设备前请先导出。'}</p>
      </div>

      <div className="group me-group">
        <MeRow icon={InfoIcon} label="素材与版本信息" onClick={() => navigate('/me/about')} />
      </div>
    </div>
  )
}
