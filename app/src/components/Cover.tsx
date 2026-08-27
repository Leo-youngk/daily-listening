/** 封面图：maxresdefault 404 时自动降级为 hqdefault */
export default function Cover({ src, className, alt = '' }: {
  src?: string | null
  className: string
  alt?: string
}) {
  if (!src) return null
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
          img.style.display = 'none'
        }
      }}
    />
  )
}
