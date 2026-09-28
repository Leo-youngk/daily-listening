/** 播放时间：00:34、06:22；超过一小时 1:02:03 */
export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return (h > 0 ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0')
}

/** 发布日期：今年的只写月日 */
export function fmtDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return y === new Date().getFullYear() ? `${m}月${d}日` : `${y}年${m}月${d}日`
}

export function fmtBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return '0 MB'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
