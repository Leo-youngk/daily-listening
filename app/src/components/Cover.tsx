import { useState } from 'react'

/** 封面图：maxresdefault 404 时自动降级为 hqdefault；其他失败显示占位 */
export default function Cover({ src, className, alt = '' }: {
  src?: string | null
  className: string
  alt?: string
}) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={e => {
        const img = e.currentTarget
        if (img.src.includes('maxresdefault')) {
          img.src = img.src.replace('maxresdefault', 'hqdefault')
        } else {
          setFailed(true)
        }
      }}
    />
  )
}
