export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return (h > 0 ? h + ':' : '') + mm + ':' + String(ss).padStart(2, '0')
}

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}

export function fmtViews(n?: number | null): string {
  if (!n) return ''
  if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿次播放'
  if (n >= 1e4) return Math.round(n / 1e4) + ' 万次播放'
  return n + ' 次播放'
}

export function fmtMinutes(sec: number): string {
  return (sec / 60).toFixed(0) + ' 分钟'
}

export function fmtBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return '0 MB'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
