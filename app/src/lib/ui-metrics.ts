const PAGES = ['programs', 'words', 'me', 'talk', 'review', 'word'] as const
export type UIPage = typeof PAGES[number]
export interface UIMetrics {
  version: string
  page: UIPage
  theme: 'light' | 'dark'
  inputs: number
  inputPaintMax: number
  eventDurationMax: number
  scrollFrames: number
  slowFrames: number
  frameMax: number
  longTasks: number
  longTaskMax: number
}

/** 接口只接受汇总数字与枚举，不接受文本、完整地址或学习内容。 */
export function parseUIMetrics(value: unknown): UIMetrics | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.version !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(row.version)
    || !PAGES.includes(row.page as UIPage) || !['light', 'dark'].includes(row.theme as string)) return null
  const result = { version: row.version, page: row.page, theme: row.theme } as UIMetrics
  for (const key of ['inputs', 'inputPaintMax', 'eventDurationMax', 'scrollFrames', 'slowFrames', 'frameMax', 'longTasks', 'longTaskMax'] as const) {
    const n = row[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1_000_000) return null
    result[key] = Math.round(n)
  }
  return result
}
