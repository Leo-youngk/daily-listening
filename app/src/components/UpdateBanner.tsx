import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { Button } from '@/components/ui/button'

const CHECK_INTERVAL = 1000 * 60 * 60

export default function UpdateBanner() {
  const [ready, setReady] = useState(false)
  const [apply, setApply] = useState<(() => void) | null>(null)

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setReady(true)
        setApply(() => () => void updateSW(true))
      },
      onRegisteredSW(_url, registration) {
        if (!registration) return
        setInterval(() => void registration.update(), CHECK_INTERVAL)
      },
    })
  }, [])

  if (!ready) return null

  return (
    <div className="safe-top pointer-events-auto fixed inset-x-0 top-0 z-50 mx-auto flex max-w-lg items-center gap-3 px-3 pb-2">
      <div className="glass flex w-full items-center gap-3 rounded-xl px-3 py-2 shadow-lg ring-1 ring-foreground/10">
        <p className="flex-1 text-[13px] leading-snug">新版本已就绪</p>
        <Button size="sm" className="rounded-full px-3" onClick={() => apply?.()}>
          立即更新
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full px-3 text-muted-foreground"
          onClick={() => setReady(false)}
        >
          稍后
        </Button>
      </div>
    </div>
  )
}
