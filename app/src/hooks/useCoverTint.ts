import { useEffect, useState } from 'react'

const cache = new Map<string, string | null>()

/** 把封面缩到 24×24，按饱和度加权求主色相，返回一个柔和的同色相颜色；灰调封面返回 null */
async function extractTint(src: string): Promise<string | null> {
  const img = new Image()
  img.src = src
  await img.decode()
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  let x = 0
  let y = 0
  let weight = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const light = (max + min) / 2
    if (max === min || light < 0.12 || light > 0.92) continue
    const sat = (max - min) / (1 - Math.abs(2 * light - 1))
    const hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
    const angle = (hue / 6) * Math.PI * 2
    const w = sat * sat
    x += Math.cos(angle) * w
    y += Math.sin(angle) * w
    weight += w
  }
  // 彩色像素太少（黑白/灰调封面）就不取色，退回主题色
  if (weight < size * size * 0.04) return null
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  return `hsl(${Math.round(deg)} 72% 64%)`
}

/**
 * 播放页背景取封面主色（与 Apple Music 同思路）。纯装饰：取色失败时用主题色，不影响任何内容。
 * 结果按 src 缓存，只在异步回调里 setState。
 */
export function useCoverTint(src?: string | null): string | undefined {
  const [state, setState] = useState<{ src: string; tint: string | null } | null>(null)

  useEffect(() => {
    if (!src || cache.has(src)) return
    let alive = true
    extractTint(src)
      .then(tint => {
        cache.set(src, tint)
        if (alive) setState({ src, tint })
      })
      .catch(error => {
        console.warn('cover tint unavailable, using theme color', error)
        cache.set(src, null)
      })
    return () => { alive = false }
  }, [src])

  if (!src) return undefined
  const tint = cache.has(src) ? cache.get(src) : state?.src === src ? state.tint : null
  return tint ?? undefined
}
